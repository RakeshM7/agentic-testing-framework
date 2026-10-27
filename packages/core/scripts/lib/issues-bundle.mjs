// Framework issues leave a client's workspace only as a redacted bundle a human has seen (docs/packaging.md §3.9, Q6,
// draft P-8). Agents record them during a run (D-083, lib/framework-issues.mjs) and `run.mjs end` keeps them in the
// run's results/<run>/framework-issues.json; this module is behind `atf issues export` and `atf issues import`.
//
// export (any workspace; a source checkout too, so maintainers can try it on their own runs):
//   - collects framework-issues.json from every product's ended runs, every environment (state/history/), or one run
//     (--run), or those ended on or after a UTC date (--since); a run still active is left out and named;
//   - redacts every text field (Redactor below): each distinct value gets a stable placeholder for the whole bundle
//     (<host-1>, <email-2>, <secret-1>, <product-1>), and the manifest lists each placeholder's kind, count and where it
//     occurred, never the value. Left as they are: the client name, agent names, issue ids, kinds and severities,
//     dates, versions, config sources and digests, and an issue's target when it names a file the framework has;
//   - per run, the package, contract and Node versions, the host the run started on, and which config files were
//     overlaid or ejected (sources and digests only, never their content, D-088);
//   - evidence files an issue names under artifacts/, playwright-tests/ or k6-tests/ (never .auth/, .env*, config/ or
//     atf/): small text files go in redacted; binary, large (over 64 KiB) and network bodies are left out and listed by
//     name and size, unless --include-evidence, which adds them too: text redacted, binary as it is, with a warning;
//   - prints the preview (every entry, the issue ids, the redactions, what is left out), then writes only after the human
//     types `yes` on a terminal, or with --yes; non-interactive without --yes refuses; --dry-run writes nothing.
//   The zip (lib/zip.mjs): manifest.json, runs/run-<n>.json, issues/run-<n>/<FI-id>.json, evidence/run-<n>/e<k>.<ext>.
//   Runs are numbered in the bundle, since a run id holds the product slug; entry names carry no client value. It goes
//   to the workspace root (or --out) as atf-issues-<client>-<YYYY-MM-DD>.zip, with -2, -3 … when that exists: an
//   export never overwrites.
//
// import (the framework's own source checkout only: a client has no use for it): verifies the bundle (every CRC, the
// format and its version, every entry listed by the manifest and every issue well-formed), then writes one feedback
// file per issue in today's format (lib/framework-issues.mjs renderFeedback) to feedback/client-<client>-<date>/ (or
// --out), with the included evidence beside them. It refuses a target folder that exists: importing the same bundle
// twice would hand the implementor every finding twice.
import { isUtf8 } from "node:buffer";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { CONTRACT_VERSION, DEFAULT_ENV, SLUG_RE } from "./contract.mjs";
import { ISSUES_FILE, ISSUE_KINDS, SEVERITIES, renderFeedback } from "./framework-issues.mjs";
import { packageOf } from "./provenance.mjs";
import { isInstalled, isWithin, readMarker, realOrSelf } from "./roots.mjs";
import { readZip, writeZip } from "./zip.mjs";

export const FORMAT = "atf-issues";
export const FORMAT_VERSION = 1;
export const LARGE = 64 * 1024; // text evidence above this is left out unless --include-evidence
const MAX_EVIDENCE = 20 * 1024 * 1024; // never bundled, even with --include-evidence
const EVIDENCE_AREAS = new Set(["artifacts", "playwright-tests", "k6-tests"]);
const BINARY_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "tif", "tiff", "pdf", "zip", "gz", "tgz", "br", "mp4", "webm", "mov", "wasm", "woff", "woff2", "ttf", "otf"]);
// network bodies and inventories, by a path word: network-inventory.json, responses/, login.body.json, trace.har
const NETWORK = /(^|[/_.-])(network|requests?|responses?|bod(y|ies)|har)([/_.-]|$)/i;
const FI_ID = /^FI-[0-9a-f]{8}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLIENT_RE = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

// ---- redaction -------------------------------------------------------------------------------------------------------

// The order kinds are listed in the manifest and the preview.
export const REDACTION_KINDS = ["path", "secret", "url", "email", "ip", "id", "host", "product", "module"];

// Top-level domains the bare-host rule accepts: the common generic ones, the reserved test names, and country codes
// that rarely end a code identifier (.it, .in, .at, .is, .no, .to, .sh are left out: `issue.at`, `res.to`). Hosts the
// run-config names are seeded and redacted whatever their TLD; this rule is the net for the rest.
const TLDS = new Set(
  "com net org edu gov mil int info biz app dev io ai co me tv ly gg cc cloud tech online site xyz test example invalid local localhost internal corp lan intranet arpa us uk de fr nl eu au ca jp cn ch se es br ru pl dk fi ie nz sg hk kr tw za mx ar cl".split(" ")
);
const ID_CHARS = "A-Za-z0-9";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NOT_HELD = "\\uE000\\uE001"; // the sentinels a replaced value is held behind until the end of text()

// One Redactor per bundle, so a value has one placeholder across every run, issue and evidence file.
//   seeds: workspace (its absolute path, both as given and resolved), home (the user's home folder), hosts (from the
//   runs' targets), products and modules (slugs, from every product of the workspace): matched literally, whatever the
//   heuristics below would say.
// text(s, where) -> s with every match replaced; summary() -> the manifest's list, values never included.
export class Redactor {
  constructor({ workspace, home = os.homedir(), hosts = [], products = [], modules = [] } = {}) {
    this.values = new Map();
    this.next = {};
    const literal = (list) => [...new Set(list.filter(Boolean).flatMap((p) => [p, p.replaceAll("\\", "/"), p.replaceAll("/", "\\"), p.replaceAll("\\", "\\\\")]))].sort((a, b) => b.length - a.length);
    const workspaces = workspace ? literal([workspace, realOrSelf(workspace)]) : [];
    const homes = home && home.length > 3 ? literal([home, realOrSelf(home)]) : [];
    const slugs = [...[...new Set(products)].map((s) => [s, "product"]), ...[...new Set(modules)].filter((m) => !products.includes(m)).map((s) => [s, "module"])].filter(([s]) => SLUG_RE.test(s)).sort(([a], [b]) => b.length - a.length);
    const seededHosts = [...new Set(hosts.map((h) => h.toLowerCase()))].sort((a, b) => b.length - a.length);
    this.rules = [
      // PEM private keys, whole
      [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, (h, m) => h("secret", m)],
      // the workspace and the home folder: one fixed placeholder each, so the rest of the path stays readable
      ...workspaces.map((w) => [new RegExp(esc(w), "g"), (h) => h("path", workspace, "<workspace>")]),
      ...homes.map((w) => [new RegExp(esc(w), "g"), (h) => h("path", home, "<home>")]),
      // any other user folder: /Users/<name>, /home/<name>, C:\Users\<name>
      [/(?:\/Users|\/home|[A-Za-z]:(?:\\\\|\\|\/)Users)(?:\\\\|\\|\/)[^\\/\s"'<>:\uE000\uE001]+/g, (h, m) => h("path", m)],
      // JWTs, then the credential after an auth scheme, then the value of a secret-looking key
      [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, (h, m) => h("secret", m)],
      [/\b(Bearer|Basic|Token|Digest)(\s+)([A-Za-z0-9\-._~+/]{8,}=*)/g, (h, m, scheme, sp, cred) => `${scheme}${sp}${h("secret", cred)}`],
      [
        /\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential|authorization|cookie|session[_-]?id|signature|key)s?)("?\s*[:=]\s*"?)(?!(?:Bearer|Basic|Token|Digest)\s)([^\s"'&,;)}\]\uE000\uE001]+)/gi,
        (h, m, key, sep, value) => `${key}${sep}${h("secret", value)}`,
      ],
      // URLs whole (scheme://…), trailing punctuation kept out
      [/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>`\uE000\uE001]+/g, (h, m) => {
        const tail = /[.,;:!?)\]}]+$/.exec(m)?.[0] ?? "";
        const url = tail ? m.slice(0, -tail.length) : m;
        return url.length > url.indexOf("://") + 3 ? `${h("url", url)}${tail}` : m;
      }],
      [/(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g, (h, m) => h("email", m.toLowerCase())],
      ...seededHosts.map((host) => [new RegExp(`(?<![A-Za-z0-9.-])${esc(host)}(?![A-Za-z0-9-]|\\.[A-Za-z0-9])`, "gi"), (h) => h("host", host)]),
      [/(?<![0-9.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![0-9]|\.\d)/g, (h, m) => h("ip", m)],
      [/(?<![A-Za-z0-9:.])(?:(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|(?:[0-9a-fA-F]{1,4}:){1,7}:(?:[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})?|::[0-9a-fA-F]{1,4}(?::[0-9a-fA-F]{1,4}){0,6})(?![A-Za-z0-9:])/g, (h, m) => h("ip", m.toLowerCase())],
      [/(?<![A-Za-z0-9])[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?![A-Za-z0-9])/g, (h, m) => h("id", m.toLowerCase())],
      // bare host names: dotted labels ending in a known TLD, not a path segment, not a call
      [/(?<![A-Za-z0-9._@/\\-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+([A-Za-z]{2,24})(?![A-Za-z0-9_-]|\.[A-Za-z0-9]|\()/g, (h, m, tld) => (TLDS.has(tld.toLowerCase()) ? h("host", m.toLowerCase()) : m)],
      // long hex (32+) and long base64 or base64url (32+) with upper, lower and digit; a `/` path needs a 24+ run of
      // its own, a `+` or trailing `=` to count
      [/(?<![A-Za-z0-9])[0-9a-fA-F]{32,}(?![A-Za-z0-9])/g, (h, m) => h("secret", m)],
      [/(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/_-]{32,}={0,2}(?![A-Za-z0-9+/=_-])/g, (h, m) => (looksSecret(m) ? h("secret", m) : m)],
      // the product and module slugs, as kebab (or snake) words, and inside PascalCase or camelCase names
      ...slugs.flatMap(([slug, kind]) => slugRules(slug).map((re) => [re, (h) => h(kind, slug)])),
    ];
  }

  // -> the placeholder for a value of a kind, counting the occurrence at `where`
  hold(kind, value, where, fixed) {
    const key = `${kind}\u0000${value}`;
    let v = this.values.get(key);
    if (!v) {
      const placeholder = fixed ?? `<${kind}-${(this.next[kind] = (this.next[kind] ?? 0) + 1)}>`;
      v = { kind, placeholder, count: 0, where: new Set() };
      this.values.set(key, v);
    }
    v.count++;
    if (where) v.where.add(where);
    return v.placeholder;
  }

  text(s, where) {
    if (typeof s !== "string" || !s) return s;
    const held = [];
    let t = s.replace(/[\uE000\uE001]/g, "\uFFFD");
    const h = (kind, value, fixed) => `\uE000${held.push(this.hold(kind, value, where, fixed)) - 1}\uE001`;
    // a replacer's arguments are the match, its groups, then the offset and the whole string (no rule has named groups)
    for (const [re, fn] of this.rules) t = t.replace(re, (...m) => fn(h, ...m.slice(0, -2)));
    return t.replace(/\uE000(\d+)\uE001/g, (_, i) => held[Number(i)]);
  }

  // every string in a JSON value, keys left as they are
  json(v, where) {
    if (typeof v === "string") return this.text(v, where);
    if (Array.isArray(v)) return v.map((x) => this.json(x, where));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, this.json(x, where)]));
    return v;
  }

  // -> { total, byKind: {kind: occurrences}, values: [{kind, placeholder, count, where}] }: never the values
  summary() {
    const list = [...this.values.values()].sort((a, b) => REDACTION_KINDS.indexOf(a.kind) - REDACTION_KINDS.indexOf(b.kind) || num(a.placeholder) - num(b.placeholder));
    const byKind = {};
    for (const v of list) byKind[v.kind] = (byKind[v.kind] ?? 0) + v.count;
    return { total: list.reduce((n, v) => n + v.count, 0), byKind, values: list.map((v) => ({ kind: v.kind, placeholder: v.placeholder, count: v.count, where: [...v.where].sort() })) };
  }
}

const num = (p) => Number(/-(\d+)>$/.exec(p)?.[1] ?? 0);

function looksSecret(s) {
  const mixed = (x) => /[0-9]/.test(x) && /[A-Z]/.test(x) && /[a-z]/.test(x);
  if (!mixed(s)) return false;
  if (!s.includes("/")) return true;
  return s.includes("+") || s.endsWith("=") || s.split("/").some((seg) => seg.length >= 24 && mixed(seg));
}

function slugRules(slug) {
  const words = slug.split("-");
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const kebab = words.map(esc).join("[-_]");
  const pascal = words.map(cap).join("");
  const camel = words[0] + words.slice(1).map(cap).join("");
  return [
    new RegExp(`(?<![${ID_CHARS}])${kebab}(?![${ID_CHARS}])`, "gi"),
    new RegExp(`${esc(pascal)}(?![a-z0-9])`, "g"),
    new RegExp(`(?<![${ID_CHARS}])${esc(camel)}(?=[A-Z])`, "g"),
  ];
}

// ---- the client and the runs -----------------------------------------------------------------------------------------

// A file-name-safe client name: lowercase letters, digits, `.`, `_` and `-`, at most 64. "" when nothing is left.
export function sanitizeClient(s) {
  return String(s ?? "").toLowerCase().replace(/^@/, "").replace(/[^a-z0-9._-]+/g, "-").replace(/[-._]{2,}/g, "-").replace(/^[-._]+/, "").slice(0, 64).replace(/[-._]+$/, "");
}

// The bundle's client name: --client, else atf/atf.json "client", else the workspace package.json's name.
// -> { name, from } | { error }
export function clientName(workspace, override) {
  if (override !== undefined) {
    const name = sanitizeClient(override);
    return name ? { name, from: "--client" } : { error: `--client '${override}' has no letter or digit to name the bundle with` };
  }
  const { cfg, error } = readMarker(workspace);
  if (error) return { error };
  if (cfg?.client !== undefined) {
    const name = typeof cfg.client === "string" ? sanitizeClient(cfg.client) : "";
    return name ? { name, from: 'atf/atf.json "client"' } : { error: 'atf/atf.json "client" must be a name with a letter or digit' };
  }
  try {
    const name = sanitizeClient(JSON.parse(readFileSync(path.join(workspace, "package.json"), "utf8").replace(/^\uFEFF/, "")).name);
    if (name) return { name, from: "package.json name" };
  } catch {}
  return { error: 'no client name: set "client" in atf/atf.json, or pass --client <name>' };
}

const readJsonFile = (f) => JSON.parse(readFileSync(f, "utf8").replace(/^\uFEFF/, ""));
const dirs = (d) => (existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : []);

// Each product's state folders: [{environment, state}] (state/ for the default, envs/<e>/state/ for the others, D-081).
const stateDirs = (productDir) => [{ environment: DEFAULT_ENV, state: path.join(productDir, "state") }, ...dirs(path.join(productDir, "envs")).map((e) => ({ environment: e, state: path.join(productDir, "envs", e, "state") }))];

// The ended runs that match the filter, oldest first, with their issues file read; the active runs are named apart.
// -> { runs: [{product, environment, runId, createdAt, endedAt, outcome, data}], active: [runId], problems } | { error }
export function collectRuns(workspace, { run, since } = {}) {
  const artifacts = path.join(workspace, "artifacts");
  const ended = [];
  const active = [];
  const problems = [];
  for (const product of dirs(artifacts).filter((d) => SLUG_RE.test(d))) {
    const productDir = path.join(artifacts, product);
    for (const { environment, state } of stateDirs(productDir)) {
      try {
        if (existsSync(path.join(state, "lock.json"))) active.push(readJsonFile(path.join(state, "lock.json")).runId);
      } catch {}
      const history = path.join(state, "history");
      if (!existsSync(history)) continue;
      for (const f of readdirSync(history).filter((n) => n.endsWith(".json")).sort()) {
        let h;
        try {
          h = readJsonFile(path.join(history, f));
        } catch (e) {
          problems.push(`${path.relative(workspace, path.join(history, f)).replaceAll("\\", "/")} can't be read (${e.message}); skipped`);
          continue;
        }
        if (typeof h?.runId !== "string" || !SLUG_RE.test(h.runId)) continue;
        ended.push({ product, environment, runId: h.runId, createdAt: h.createdAt ?? null, endedAt: h.endedAt ?? null, outcome: h.outcome ?? null, file: path.join(productDir, "results", h.runId, ISSUES_FILE) });
      }
    }
  }
  let chosen = ended;
  if (run !== undefined) {
    chosen = ended.filter((r) => r.runId === run);
    if (!chosen.length) return { error: active.includes(run) ? `run ${run} is still active: end it first (its issues are exported once it has ended)` : `no ended run ${run} in ${artifacts}` };
  } else if (since !== undefined) chosen = ended.filter((r) => String(r.endedAt ?? "") >= `${since}T00:00:00.000Z`);
  const runs = [];
  for (const r of chosen.sort((a, b) => String(a.endedAt).localeCompare(String(b.endedAt)) || a.runId.localeCompare(b.runId))) {
    let data = { issues: [] };
    try {
      if (existsSync(r.file)) data = readJsonFile(r.file);
    } catch (e) {
      problems.push(`${path.relative(workspace, r.file).replaceAll("\\", "/")} can't be read (${e.message}); run ${r.runId} skipped`);
      continue;
    }
    const { file, ...rest } = r;
    runs.push({ ...rest, data: { ...data, issues: Array.isArray(data.issues) ? data.issues : [] } });
  }
  return { runs, active: active.filter(Boolean), problems };
}

// What the redactor must catch literally, from everything the workspace knows about its products: slugs, modules
// (folders, run.json, the frozen config, each run's stamp) and target hosts. Seeding more only redacts more.
function seeds(workspace, runs) {
  const products = new Set();
  const modules = new Set();
  const hosts = new Set();
  const addTarget = (t) => {
    for (const u of [t?.url, ...(Array.isArray(t?.api_urls) ? t.api_urls : [])]) {
      try {
        if (u) hosts.add(new URL(u).hostname);
      } catch {}
    }
  };
  const addModules = (list) => {
    for (const m of Array.isArray(list) ? list : []) {
      const slug = typeof m === "string" ? m : m?.slug;
      if (typeof slug === "string") modules.add(slug);
    }
  };
  const artifacts = path.join(workspace, "artifacts");
  for (const product of dirs(artifacts).filter((d) => SLUG_RE.test(d))) {
    products.add(product);
    const productDir = path.join(artifacts, product);
    for (const m of dirs(path.join(productDir, "modules"))) modules.add(m);
    for (const { state } of stateDirs(productDir)) {
      for (const f of ["run.json", "config.json"]) {
        try {
          const d = readJsonFile(path.join(state, f));
          addModules(d.modules);
          addTarget(d.target);
        } catch {}
      }
    }
  }
  for (const r of runs) {
    products.add(r.product);
    addModules(r.data.run?.modules);
    addTarget(r.data.run?.target);
  }
  return { products: [...products], modules: [...modules], hosts: [...hosts].filter(Boolean) };
}

// ---- evidence --------------------------------------------------------------------------------------------------------

const PATH_TOKEN = /(?:[A-Za-z]:)?[\w.@\\/-]*[\\/][\w.@-]*\.[A-Za-z0-9]{1,8}/g;

// The files an issue's text names that may go in a bundle: inside the workspace, under artifacts/, playwright-tests/ or
// k6-tests/, never in .auth/, .git/ or node_modules/ and never a .env file. -> [workspace-relative paths with `/`]
export function evidenceRefs(workspace, texts) {
  const ws = realOrSelf(path.resolve(workspace));
  const out = new Set();
  for (const text of texts) {
    for (const [token] of String(text ?? "").matchAll(PATH_TOKEN)) {
      const abs = realOrSelf(path.isAbsolute(token) || /^[A-Za-z]:/.test(token) ? path.resolve(token) : path.resolve(ws, token));
      if (!isWithin(abs, ws)) continue;
      const rel = path.relative(ws, abs).replaceAll("\\", "/");
      const segs = rel.split("/");
      if (!rel || segs[0] === ".." || !EVIDENCE_AREAS.has(segs[0]) || segs.some((s) => [".auth", ".git", "node_modules"].includes(s)) || /^\.env/i.test(segs.at(-1))) continue;
      try {
        if (statSync(abs).isFile()) out.add(rel);
      } catch {}
    }
  }
  return [...out];
}

// -> { binary, network, size, buf }
function readEvidence(workspace, rel) {
  const buf = readFileSync(path.join(workspace, ...rel.split("/")));
  const ext = path.extname(rel).slice(1).toLowerCase();
  const binary = BINARY_EXT.has(ext) || buf.subarray(0, 8192).includes(0) || !isUtf8(buf);
  return { buf, size: buf.length, binary, network: NETWORK.test(rel) };
}

// ---- the bundle ------------------------------------------------------------------------------------------------------

// A framework file an issue is about is the framework's, not the client's: left unredacted when the framework has it.
function frameworkFile(framework, target) {
  if (typeof target !== "string" || !target || path.isAbsolute(target) || target.includes("..")) return false;
  const rel = target.replace(/^packages\/core\//, "");
  try {
    return statSync(path.join(framework, ...rel.split("/"))).isFile();
  } catch {
    return false;
  }
}

// A provenance config file as the bundle shows it: the framework's own as {fw}/…, the workspace's relative.
function configFile(f, workspace, framework) {
  if (typeof f !== "string" || !path.isAbsolute(f)) return f;
  if (isWithin(f, framework)) return `{fw}/${path.relative(realOrSelf(framework), realOrSelf(f)).replaceAll("\\", "/")}`;
  if (isWithin(f, workspace)) return path.relative(realOrSelf(workspace), realOrSelf(f)).replaceAll("\\", "/");
  return f;
}

// -> { entries: [{name, data, note}], manifest, preview: {issues, leftOut, binaryIncluded} }
export function buildBundle({ workspace, framework, runs, includeEvidence = false, client, filter = {}, now = new Date(), home }) {
  const red = new Redactor({ workspace, home, ...seeds(workspace, runs) });
  const body = [];
  const manifestRuns = [];
  const manifestIssues = [];
  const included = [];
  const leftOut = [];
  const previewIssues = [];
  runs.forEach((r, n) => {
    const alias = `run-${n + 1}`;
    const runEntry = `runs/${alias}.json`;
    const meta = r.data.run ?? {};
    const prov = meta.provenance ?? null;
    const evidence = new Map(); // workspace-relative path -> its record
    const evidenceRecord = (rel, where) => {
      if (evidence.has(rel)) return evidence.get(rel);
      let e;
      try {
        e = readEvidence(workspace, rel);
      } catch {
        return null;
      }
      const name = red.text(rel, where);
      const reason = e.size > MAX_EVIDENCE ? "over 20 MiB" : includeEvidence ? null : e.binary ? "binary" : e.network ? "network body" : e.size > LARGE ? "large (over 64 KiB)" : null;
      const rec = { name, size: e.size };
      if (reason) {
        rec.leftOut = reason;
        leftOut.push({ run: alias, name, size: e.size, reason });
      } else {
        const ext = /^[a-z0-9]{1,8}$/.test(path.extname(rel).slice(1).toLowerCase()) ? path.extname(rel).slice(1).toLowerCase() : "bin";
        rec.entry = `evidence/${alias}/e${evidence.size + 1}.${ext}`;
        rec.redacted = !e.binary;
        const data = e.binary ? e.buf : Buffer.from(red.text(e.buf.toString("utf8"), rec.entry), "utf8");
        body.push({ name: rec.entry, data, note: e.binary ? "binary, NOT redacted" : "text, redacted" });
        included.push({ entry: rec.entry, name, size: data.length, redacted: !e.binary });
      }
      evidence.set(rel, rec);
      return rec;
    };
    const ids = [];
    for (const i of r.data.issues) {
      if (!FI_ID.test(i?.id ?? "") || ids.includes(i.id)) continue; // never an entry name from an unchecked value
      const entry = `issues/${alias}/${i.id}.json`;
      const at = (field) => `${entry} (${field})`;
      const files = evidenceRefs(workspace, [i.summary, i.evidence, i.fix]).map((rel) => evidenceRecord(rel, at("evidenceFiles"))).filter(Boolean);
      const slug = (s) => (typeof s === "string" && SLUG_RE.test(s) ? s : "unnamed");
      const issue = {
        id: i.id,
        kind: ISSUE_KINDS.includes(i.kind) ? i.kind : "other",
        target: frameworkFile(framework, i.target) ? i.target : red.text(String(i.target ?? ""), at("target")),
        summary: red.text(String(i.summary ?? ""), at("summary")),
        evidence: red.text(String(i.evidence ?? ""), at("evidence")),
        ...(i.fix ? { fix: red.text(String(i.fix), at("fix")) } : {}),
        severity: SEVERITIES.includes(i.severity) ? i.severity : "medium",
        from: slug(i.from),
        reporters: (Array.isArray(i.reporters) ? i.reporters : [i.from]).map(slug),
        at: typeof i.at === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(i.at) ? i.at : null,
        evidenceFiles: files.map(({ name, size, entry: e, leftOut: why }) => ({ name, size, ...(e ? { entry: e } : { leftOut: why }) })),
      };
      ids.push(i.id);
      body.push({ name: entry, data: `${JSON.stringify(issue, null, 2)}\n`, note: `${issue.severity} ${issue.kind}` });
      manifestIssues.push({ id: i.id, run: alias, entry, kind: issue.kind, severity: issue.severity });
      previewIssues.push({ run: alias, ...issue });
    }
    if (!ids.length) return;
    const runId = red.text(r.runId, `${runEntry} (runId)`);
    const runMeta = {
      run: alias,
      runId,
      product: red.text(r.product, `${runEntry} (product)`),
      environment: red.text(r.environment, `${runEntry} (environment)`),
      createdAt: r.createdAt,
      endedAt: r.endedAt,
      outcome: r.outcome,
      // false: the run ended before end stamped its metadata (P-8), so its versions and config are unknown here
      recorded: Boolean(r.data.run),
      host: meta.startedOnHost ?? null,
      package: prov?.package ?? null,
      contract: meta.contract ?? null,
      node: prov?.node ?? null,
      framework: prov?.framework ?? null,
      packageChanges: meta.packageChanges ?? [],
      // which framework config files the workspace overlaid or ejected: sources and digests, never the content (D-088)
      config: (Array.isArray(prov?.config) ? prov.config : []).map((c) => ({ name: c.name, source: c.source, files: (c.files ?? []).map((f) => red.text(configFile(f, workspace, framework), `${runEntry} (config)`)), digest: c.digest ?? null })),
      issues: ids,
    };
    body.push({ name: runEntry, data: `${JSON.stringify(runMeta, null, 2)}\n`, note: "run metadata" });
    manifestRuns.push({ run: alias, entry: runEntry, runId, endedAt: r.endedAt, issues: ids });
  });
  const manifest = {
    format: FORMAT,
    formatVersion: FORMAT_VERSION,
    createdAt: now.toISOString(),
    client,
    tool: { package: packageOf(framework), contract: CONTRACT_VERSION, node: process.version },
    filter: { run: filter.run ? red.text(filter.run, "manifest.json (filter)") : null, since: filter.since ?? null },
    includeEvidence,
    runs: manifestRuns,
    issues: manifestIssues,
    evidence: { included, leftOut },
    notRedacted: "the client name, agent names, issue ids, kinds, severities and dates, versions, config sources and digests, an issue's target when the framework has that file, and binary evidence",
    redactions: red.summary(),
  };
  const entries = [{ name: "manifest.json", data: `${JSON.stringify(manifest, null, 2)}\n`, note: "what the bundle holds and every redaction" }, ...body];
  return { entries, manifest, preview: { issues: previewIssues, leftOut, binaryIncluded: included.filter((e) => !e.redacted) } };
}

const size = (n) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const pad = (s, n) => (s.length >= n ? `${s} ` : s.padEnd(n));

// The preview the human confirms: every entry, the issue ids, every redaction, what is left out, and the warning for
// binary files. -> [lines]
export function previewLines({ entries, manifest, preview }, file) {
  const lines = [`atf issues export: ${manifest.issues.length} framework issue(s) from ${manifest.runs.length} ended run(s), for client ${manifest.client}`, ""];
  lines.push("Issues:");
  for (const i of preview.issues) lines.push(`  ${i.run}  ${i.id}  [${i.severity}] ${i.kind} ${i.target}: ${i.summary}`);
  lines.push("", `${path.basename(file)} will hold:`);
  for (const e of entries) lines.push(`  ${pad(e.name, 44)}${pad(size(Buffer.byteLength(e.data)), 10)}${e.note}`);
  const r = manifest.redactions;
  lines.push("", r.total ? `Redacted: ${r.total} occurrence(s) of ${r.values.length} value(s) (${Object.entries(r.byKind).map(([k, n]) => `${k} ${n}`).join(", ")}); the original values are not in the bundle:` : "Redacted: nothing matched.");
  for (const v of r.values) lines.push(`  ${pad(v.kind, 9)}${pad(v.placeholder, 14)}x${pad(String(v.count), 5)}${v.where.join(", ")}`);
  if (preview.leftOut.length) {
    lines.push("", "Left out of the bundle (listed by name and size only):");
    for (const e of preview.leftOut) lines.push(`  ${e.run}  ${e.name}  ${size(e.size)}  ${e.reason}`);
    if (!manifest.includeEvidence) lines.push("  --include-evidence adds the binary, large and network-body files (binary ones as they are, not redacted).");
  }
  if (preview.binaryIncluded.length) lines.push("", `WARNING: ${preview.binaryIncluded.length} binary evidence file(s) go in as they are, NOT redacted (screenshots can show hosts, names and data): ${preview.binaryIncluded.map((e) => `${e.entry} (${e.name})`).join(", ")}`);
  lines.push("", `Not redacted: ${manifest.notRedacted}.`);
  return lines;
}

// A file name that doesn't exist yet: <base>.zip, else <base>-2.zip, -3 …
function freshName(dir, base) {
  for (let n = 1; ; n++) {
    const f = path.join(dir, `${base}${n === 1 ? "" : `-${n}`}.zip`);
    if (!existsSync(f)) return f;
  }
}

// atf issues export. ask(question) -> the human's answer (a terminal prompt); interactive: whether there is a terminal
// to ask. -> exit code (0 written, dry run or nothing to export; 1 refused or not confirmed)
export async function exportIssues({ workspace, framework, run, since, includeEvidence = false, client, out, yes = false, dryRun = false, interactive = false, ask, log = console, now = new Date(), home }) {
  const fail = (m) => (log.error(`atf issues export: ${m}`), 1);
  const who = clientName(workspace, client);
  if (who.error) return fail(who.error);
  const c = collectRuns(workspace, { run, since });
  if (c.error) return fail(c.error);
  for (const p of c.problems) log.error(`atf issues export: warning: ${p}`);
  if (c.active.length) log.log(`atf issues export: ${c.active.length} run(s) still active, left out until they end: ${c.active.join(", ")}`);
  const runs = c.runs.filter((r) => r.data.issues.length);
  if (!runs.length) {
    log.log(`atf issues export: no framework issues in ${c.runs.length} ended run(s)${run ? ` (run ${run})` : since ? ` since ${since}` : ""}: nothing to export.`);
    return 0;
  }
  const bundle = buildBundle({ workspace, framework, runs, includeEvidence, client: who.name, filter: { run, since }, now, home });
  const dir = path.resolve(out ?? workspace);
  const file = freshName(dir, `atf-issues-${who.name}-${now.toISOString().slice(0, 10)}`);
  for (const l of previewLines(bundle, file)) log.log(l);
  log.log("");
  if (dryRun) return log.log(`Dry run: nothing written (it would go to ${file}).`), 0;
  if (!yes) {
    if (!interactive || !ask) return fail(`not written: confirm on a terminal by typing yes, or pass --yes once you have reviewed the preview (--dry-run shows it without writing).`);
    const answer = await ask(`Type yes to write ${file}: `);
    if (String(answer ?? "").trim() !== "yes") return log.log("Not written."), 1;
  }
  const zip = writeZip(bundle.entries, { date: now });
  const back = readZip(zip); // what is written is what was previewed, byte for byte
  if (back.error || back.entries.length !== bundle.entries.length) return fail(`the bundle failed its own read-back (${back.error ?? "entry count"}); nothing written`);
  mkdirSync(dir, { recursive: true });
  try {
    writeFileSync(file, zip, { flag: "wx" });
  } catch (e) {
    return fail(e.code === "EEXIST" ? `${file} appeared meanwhile; nothing overwritten, run it again` : e.message);
  }
  log.log(`Wrote ${file} (${size(zip.length)}). Send it to the framework's maintainers as you agreed with them.`);
  return 0;
}

// ---- import (the framework's source checkout) ------------------------------------------------------------------------

// Reads and checks a bundle. -> { manifest, runs: Map alias -> metadata, issues: [{run, issue}], evidence: Map entry ->
// Buffer } | { error }
export function readBundle(buf) {
  const z = readZip(buf);
  if (z.error) return { error: `not a valid bundle: ${z.error}` };
  const files = new Map(z.entries.map((e) => [e.name, e.data]));
  const json = (name) => {
    if (!files.has(name)) throw new Error(`${name} is missing`);
    try {
      return JSON.parse(files.get(name).toString("utf8"));
    } catch (e) {
      throw new Error(`${name} is not JSON (${e.message})`);
    }
  };
  try {
    const m = json("manifest.json");
    if (m?.format !== FORMAT) throw new Error(`manifest.json is not an ${FORMAT} manifest`);
    if (m.formatVersion !== FORMAT_VERSION) throw new Error(`bundle format version ${m.formatVersion}, this framework reads ${FORMAT_VERSION}${m.formatVersion > FORMAT_VERSION ? ": update this checkout" : ""}`);
    if (typeof m.client !== "string" || !CLIENT_RE.test(m.client) || m.client.includes("..")) throw new Error("manifest.json names no valid client");
    if (typeof m.createdAt !== "string" || !DATE_RE.test(m.createdAt.slice(0, 10)) || Number.isNaN(Date.parse(m.createdAt))) throw new Error("manifest.json has no valid createdAt");
    const listed = new Set(["manifest.json"]);
    const runs = new Map();
    for (const r of Array.isArray(m.runs) ? m.runs : []) {
      if (!/^run-\d+$/.test(r?.run ?? "") || r.entry !== `runs/${r.run}.json`) throw new Error("manifest.json lists a malformed run");
      runs.set(r.run, json(r.entry));
      listed.add(r.entry);
    }
    const issues = [];
    for (const x of Array.isArray(m.issues) ? m.issues : []) {
      if (!FI_ID.test(x?.id ?? "") || !runs.has(x.run) || x.entry !== `issues/${x.run}/${x.id}.json`) throw new Error("manifest.json lists a malformed issue");
      const i = json(x.entry);
      const bad = i?.id !== x.id ? "its id" : !ISSUE_KINDS.includes(i.kind) ? "kind" : !SEVERITIES.includes(i.severity) ? "severity" : !SLUG_RE.test(i.from ?? "") ? "from" : !Array.isArray(i.reporters) || !i.reporters.every((a) => SLUG_RE.test(a)) ? "reporters" : ["target", "summary", "evidence"].find((k) => typeof i[k] !== "string" || !i[k].trim()) ?? (i.fix !== undefined && typeof i.fix !== "string" ? "fix" : null);
      if (bad) throw new Error(`${x.entry}: ${bad} is missing or invalid`);
      issues.push({ run: x.run, issue: i });
      listed.add(x.entry);
    }
    if (!issues.length) throw new Error("the bundle holds no issue");
    const evidence = new Map();
    for (const e of m.evidence?.included ?? []) {
      if (!/^evidence\/run-\d+\/e\d+\.[a-z0-9]{1,8}$/.test(e?.entry ?? "") || !files.has(e.entry)) throw new Error("manifest.json lists a malformed or missing evidence file");
      evidence.set(e.entry, { data: files.get(e.entry), redacted: e.redacted === true });
      listed.add(e.entry);
    }
    const extra = [...files.keys()].filter((n) => !listed.has(n));
    if (extra.length) throw new Error(`entries the manifest doesn't list: ${extra.slice(0, 5).join(", ")}`);
    return { manifest: m, runs, issues, evidence };
  } catch (e) {
    return { error: `not a valid bundle: ${e.message}` };
  }
}

const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").replace(/--+>/g, "->").trim();

// The run line every imported finding carries: the versions, host and customized config the client ran.
function runContext(m, meta) {
  const custom = (meta.config ?? []).filter((c) => c.source && c.source !== "framework").map((c) => `${c.name} (${c.source})`);
  return [
    `client ${m.client}, run ${meta.runId} (${meta.environment}, ended ${meta.endedAt ?? "?"}, ${meta.outcome ?? "?"})`,
    meta.recorded === false ? "versions not recorded (the run ended before they were stamped)" : `${meta.package ? `${meta.package.name} ${meta.package.version}` : "package unknown"}, contract ${meta.contract ?? "?"}, Node ${meta.node ?? "?"}, host ${meta.host ?? "not recorded"}`,
    `config: ${custom.length ? custom.join(", ") : "the package's own"}`,
  ].join("; ");
}

// atf issues import. -> exit code
export function importBundle({ workspace, framework, zip, out, log = console }) {
  const fail = (m) => (log.error(`atf issues import: ${m}`), 1);
  if (isInstalled(framework)) return fail("it runs only in the framework's own source checkout, where its maintainers turn client bundles into feedback; in this workspace, atf issues export makes the bundle you send them");
  let buf;
  try {
    buf = readFileSync(zip);
  } catch (e) {
    return fail(`can't read ${zip} (${e.code ?? e.message})`);
  }
  const b = readBundle(buf);
  if (b.error) return fail(`${zip}: ${b.error}; nothing written`);
  const { manifest: m } = b;
  const date = m.createdAt.slice(0, 10);
  const dir = path.resolve(out ?? path.join(workspace, "feedback", `client-${m.client}-${date}`));
  if (existsSync(dir)) return fail(`${dir} exists: nothing written (was this bundle imported already? pass --out <new folder> to import it again)`);
  const relOut = (f) => {
    const r = path.relative(workspace, f).replaceAll("\\", "/");
    return r.startsWith("..") || path.isAbsolute(r) ? f : r;
  };
  const writes = [];
  for (const [entry, { data }] of b.evidence) writes.push({ file: path.join(dir, ...entry.split("/")), data });
  const files = [];
  for (const { run, issue } of b.issues) {
    const meta = b.runs.get(run);
    const evidence = (issue.evidenceFiles ?? [])
      .map((e) => (typeof e?.entry === "string" && b.evidence.has(e.entry) ? `Evidence file: ${relOut(path.join(dir, ...e.entry.split("/")))} (${oneLine(e.name)}${b.evidence.get(e.entry).redacted ? ", redacted" : ", binary as the client sent it"}).` : e?.leftOut ? `Left out by the client: ${oneLine(e.name)} (${e.size} bytes, ${oneLine(e.leftOut)}).` : ""))
      .filter(Boolean)
      .join(" ");
    const text = renderFeedback({
      agent: issue.from,
      issues: [{ ...issue, target: oneLine(issue.target) }],
      date: typeof issue.at === "string" && DATE_RE.test(issue.at.slice(0, 10)) ? issue.at.slice(0, 10) : date,
      origin: oneLine(`Imported by atf issues import from ${path.basename(zip)}, a redacted bundle from client ${m.client} (created ${m.createdAt}). Placeholders such as <host-1> stand for values that stayed in the client's workspace; the bundle's manifest.json lists them by kind (docs/packaging.md §3.9).`),
      context: runContext(m, meta),
      evidence: () => evidence,
    });
    const file = path.join(dir, `${issue.id}.md`);
    writes.push({ file, data: text });
    files.push(relOut(file));
  }
  mkdirSync(dir, { recursive: true });
  for (const w of writes) {
    mkdirSync(path.dirname(w.file), { recursive: true });
    writeFileSync(w.file, w.data, { flag: "wx" });
  }
  log.log(`atf issues import: ${files.length} feedback file(s) from client ${m.client}'s bundle (${b.runs.size} run(s), created ${m.createdAt}) in ${relOut(dir)}${b.evidence.size ? `, with ${b.evidence.size} evidence file(s)` : ""}:`);
  for (const f of files) log.log(`  ${f}`);
  log.log("Give these paths to framework-implementor-agent. Their text is redacted: placeholders such as <host-1> stand for the client's values.");
  return 0;
}

// The CLI's child process (lib/cli.mjs ISSUES_SCRIPT): export may ask on the terminal, which run() can't. -> exit code
export async function issuesCommand({ workspace, framework, subcommand, ...o }) {
  if (subcommand === "import") return importBundle({ workspace, framework, zip: o.zip, out: o.out });
  const ask = async (q) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(q);
    } finally {
      rl.close();
    }
  };
  return exportIssues({ workspace, framework, run: o.run, since: o.since, includeEvidence: Boolean(o.includeEvidence), client: o.client, out: o.out, yes: Boolean(o.yes), dryRun: Boolean(o.dryRun), interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY), ask });
}
