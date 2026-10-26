// Product knowledge base: artifacts/<product>/knowledge/ (docs/artifact-contract.md "Knowledge base", D-015, D-051)
//
//   overview.md  glossary.md                    product pass (stage `knowledge`) -- written by knowledge-generator
//   sources.json  sources.md                    source registry (one ID per source product-wide) and its rendering
//   coverage.json  open-points.json             the product pass's input ledger and open-point ids
//   sources/S<n>.txt  sources/index.json        script-owned text cache of a source, for quote checks
//   captures/                                   the agent's own captures of pages the script can't fetch
//   inputs.json                                 fingerprints of the inputs each pass was generated from
//   modules/<m>/overview.md glossary.md notes.md                   module pass (stage `module-knowledge`), agent
//   modules/<m>/sources.md coverage.json open-points.json          module pass, script
//
// Rules enforced here (not in prompts):
//   - every source gets ONE product-wide ID (S1, S2, ...) via addSource(); the same location always maps to the same ID
//   - input ledger (lib/coverage.mjs): every configured input of a pass -- feature.requirement_docs,
//     knowledge.references and, in a module pass, the module's references -- is read (a source with its normalized
//     location was registered), failed or excluded (with a reason); check fails while one is unaccounted for
//   - extra sources (not configured, not live-product) are capped per pass at knowledge.max_extra_sources; over the cap
//     a source is not registered and is recorded `deferred: budget`. A live-product source must be on a product host.
//   - snapshot never fetches a product host or its subdomains; the agent's capture is taken only for a live-product
//     source or after the script's own fetch failed in this run; text from an earlier run is re-fetched, else `stale`
//   - only the fixed headings of each file (an extra section would escape the quote rule)
//   - every content line of overview/glossary/notes cites a registered source as [S<n>] or [S<n> "verbatim quote"];
//     lines under "## Open points" need none, and each is a single bullet line with an optional category tag
//   - rule facts carry a quote, verified against sources/S<n>.txt (whitespace, case and curly quotes normalized):
//     every content line under Business rules and validations, Roles and permissions, Limits and constraints, and
//     every line under Key entities and fields that names a constraint (CONSTRAINT_RE)
//   - fixed headings; each of the six fact categories has a cited line or a tagged open point; no code fences
//   - open points get stable ids KQ-<m>-<n> / KQ-product-<n> (lib/registry.mjs) in open-points.json
//   - a passing check stamps the pass's files (lib/verified.mjs); the stage's done refuses a missing or stale stamp
//   - knowledge is reused unless its inputs changed (product references, requirement docs incl. local file content,
//     the module's own config entry and references)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { createLedger } from "./coverage.mjs";
import { readJson, withFileLock, writeAtomic, writeJson } from "./files.mjs";
import { firstPartyHosts } from "./probe.mjs";
import { assignIds } from "./registry.mjs";
import { stampVerified, unverifiedReason } from "./verified.mjs";

export const SOURCE_TYPES = ["vendor-doc", "knowledge-base", "requirement", "web", "live-product"];
export const PRODUCT_GLOSSARY_HEADER = ["Term", "Definition", "Scope", "Sources"];
export const MODULE_GLOSSARY_HEADER = ["Term", "Definition", "Sources"];
export const DEFAULT_MAX_EXTRA_SOURCES = 20;
export const PRODUCT_OVERVIEW_HEADINGS = ["What it is", "Users and roles", "Main areas", "Key concepts", "Integrations", "Constraints and limits", "Open points"];
export const MODULE_OVERVIEW_HEADINGS = ["Purpose", "Who uses it", "Where it is", "Open points"];
export const NOTES_HEADINGS = ["How it works", "Key entities and fields", "Key actions and flows", "Business rules and validations", "Roles and permissions", "Limits and constraints", "Dependencies on other modules", "Open points"];
// The six fact categories of a module's notes.md: tag -> section. An open point names one as a leading `(tag)`.
export const CATEGORIES = {
  entities: "Key entities and fields",
  flows: "Key actions and flows",
  rules: "Business rules and validations",
  roles: "Roles and permissions",
  limits: "Limits and constraints",
  dependencies: "Dependencies on other modules",
};
// Sections of notes.md whose every content line is a rule fact and needs a verified quote.
export const QUOTE_SECTIONS = [CATEGORIES.rules, CATEGORIES.roles, CATEGORIES.limits];
// Under Key entities and fields, a line that names a field constraint needs a verified quote too.
export const CONSTRAINT_RE = /\b(required|mandatory|optional|unique|must|cannot|can't|only|maximum|minimum|max|min|at most|at least|up to|limit|limits|limited|length|characters?|digits?|format|pattern|default|read-only|readonly|allowed|between)\b/i;
export const MIN_QUOTE_WORDS = 3;
export const INPUT_KINDS = ["requirement_doc", "reference", "module_reference"];
export const INPUT_OUTCOMES = ["failed", "excluded"];

// [S3] or [S3 "exact words from the source"]
const CITE_RE = /\[(S\d+)(?:\s+"([^"]*)")?\]/g;
const FENCE_RE = /^\s*(```|~~~)/;
const SEPARATOR_RE = /^\|?\s*:?-{3,}/;
const BULLET_RE = /^[-*+]\s+\S/;
const TAG_RE = new RegExp(`^\\((${Object.keys(CATEGORIES).join("|")})\\)\\s+`, "i");
const PRODUCT_PASS = "product";

export function knowledgePaths(productDir) {
  const dir = path.join(productDir, "knowledge");
  const mod = (m) => path.join(dir, "modules", m);
  return {
    dir,
    registry: path.join(dir, "sources.json"),
    inputs: path.join(dir, "inputs.json"),
    coverage: path.join(dir, "coverage.json"),
    openPoints: path.join(dir, "open-points.json"),
    cacheDir: path.join(dir, "sources"),
    cacheIndex: path.join(dir, "sources", "index.json"),
    cacheFile: (id) => path.join(dir, "sources", `${id}.txt`),
    captures: path.join(dir, "captures"),
    product: { overview: path.join(dir, "overview.md"), glossary: path.join(dir, "glossary.md"), sources: path.join(dir, "sources.md") },
    module: (m) => ({
      dir: mod(m),
      overview: path.join(mod(m), "overview.md"),
      glossary: path.join(mod(m), "glossary.md"),
      notes: path.join(mod(m), "notes.md"),
      sources: path.join(mod(m), "sources.md"),
      coverage: path.join(mod(m), "coverage.json"),
      openPoints: path.join(mod(m), "open-points.json"),
      ruleFacts: path.join(mod(m), "rule-facts.json"),
    }),
  };
}

// The files one pass owns. module: a slug, or undefined for the product pass.
function passFiles(kp, module) {
  if (!module) return { pass: PRODUCT_PASS, coverage: kp.coverage, openPoints: kp.openPoints, withOpenPoints: [kp.product.overview] };
  const m = kp.module(module);
  return { pass: module, coverage: m.coverage, openPoints: m.openPoints, withOpenPoints: [m.overview, m.notes] };
}

const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const sha256Text = (s) => createHash("sha256").update(s).digest("hex");
const nonEmpty = (f) => existsSync(f) && statSync(f).size > 0;
const read = (f) => readFileSync(f, "utf8");
const today = () => new Date().toISOString().slice(0, 10);
const isUrl = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(s).trim());

// ---------- source registry ----------

export function normalizeLocation(loc) {
  const s = String(loc).trim();
  try {
    const u = new URL(s);
    if (u.protocol === "http:" || u.protocol === "https:") {
      u.hash = "";
      u.hostname = u.hostname.toLowerCase();
      return u.toString().replace(/\/$/, "");
    }
  } catch {}
  return s.replaceAll("\\", "/").replace(/^\.\//, "");
}

export const readRegistry = (kp) => readJson(kp.registry, []);

// The registry primitive: one product-wide id per normalized location. registerSource() is what a pass calls.
export function addSource(kp, { title, location, type, scope, runId, accessed = today() }) {
  if (!title || !location) throw new Error("a source needs a title and a location (URL or file path)");
  if (!SOURCE_TYPES.includes(type)) throw new Error(`source type must be one of [${SOURCE_TYPES}]`);
  return withFileLock(kp.registry, () => {
    const reg = readRegistry(kp);
    const loc = normalizeLocation(location);
    const existing = reg.find((s) => s.location === loc);
    if (existing) return { ...existing, existed: true };
    const id = `S${reg.reduce((n, s) => Math.max(n, Number(s.id.slice(1))), 0) + 1}`;
    const entry = { id, title: String(title).trim(), location: loc, type, accessed, addedBy: scope, runId };
    reg.push(entry);
    writeJson(kp.registry, reg);
    return entry;
  });
}

// -> [{id, quote|null}] for every citation on a line
export const parseCitations = (text) => [...String(text).matchAll(CITE_RE)].map((m) => ({ id: m[1], quote: m[2] ?? null }));
export const citedIds = (text) => new Set(parseCitations(text).map((c) => c.id));

function renderSources(entries) {
  const cell = (s) => String(s).replaceAll("|", "\\|");
  return [
    "| ID | Title | Location | Type | Accessed |",
    "|---|---|---|---|---|",
    ...entries.map((s) => `| ${s.id} | ${cell(s.title)} | ${cell(s.location)} | ${s.type} | ${s.accessed} |`),
    "",
  ].join("\n");
}

// Product sources.md = whole registry; module sources.md = the registry entries that module's files cite. Also writes
// the pass's open-points.json (stable ids). opts.runId is recorded in the open-point registry.
export function render(kp, module, { runId } = {}) {
  const reg = readRegistry(kp);
  const byId = new Map(reg.map((s) => [s.id, s]));
  writeAtomic(kp.product.sources, "# Sources\n\n" + renderSources(reg));
  const points = syncOpenPoints(kp, module, { runId });
  if (!module) return { product: reg.length, openPoints: points.map((p) => p.id) };
  const m = kp.module(module);
  const ids = new Set([m.overview, m.glossary, m.notes].filter(existsSync).flatMap((f) => [...citedIds(read(f))]));
  const subset = [...ids].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  writeAtomic(m.sources, `# Sources -- ${module}\n\n` + renderSources(subset));
  return { product: reg.length, module: subset.length, openPoints: points.map((p) => p.id) };
}

// ---------- input ledger (lib/coverage.mjs) ----------

// The configured inputs of a pass, normalized, each listed once (the first kind wins).
export function configuredInputs(cfg, module) {
  const out = new Map();
  const add = (list, kind) => {
    for (const x of list ?? []) {
      const id = normalizeLocation(x);
      if (!out.has(id)) out.set(id, kind);
    }
  };
  add(cfg.feature?.requirement_docs, "requirement_doc");
  add(cfg.knowledge?.references, "reference");
  if (module) add((cfg.modules ?? []).find((m) => m.slug === module)?.references, "module_reference");
  return [...out].map(([id, kind]) => ({ id, kind }));
}

export const maxExtraSources = (cfg) => cfg.knowledge?.max_extra_sources ?? DEFAULT_MAX_EXTRA_SOURCES;

// The pass's ledger from coverage.json, with every currently configured input listed (new ones pending). With
// opts.runId, a ledger from another run starts over: a pass accounts for its inputs again in each run that rebuilds it.
function loadLedger(kp, cfg, module, { runId } = {}) {
  const pf = passFiles(kp, module);
  let stored = readJson(pf.coverage, null);
  if (runId && stored && stored.runId !== runId) stored = null;
  const led = createLedger({ reasons: INPUT_OUTCOMES });
  const prior = new Map((stored?.items ?? []).map((i) => [i.id, i]));
  const restore = (i) => {
    const { id, status, refs, reason, detail, why, ...extra } = i;
    led.addItem(id, extra);
    if (status !== "pending") led.resolve(id, { status, ...(refs ? { refs } : {}), ...(reason ? { reason } : {}), ...(detail ? { detail } : {}) });
  };
  for (const c of configuredInputs(cfg, module)) {
    const p = prior.get(c.id);
    if (p && INPUT_KINDS.includes(p.kind)) restore({ ...p, kind: c.kind });
    else if (p) restore({ ...p, kind: c.kind, status: p.status === "mapped" ? "mapped" : "pending" });
    else led.addItem(c.id, { kind: c.kind });
  }
  for (const i of stored?.items ?? []) if (!INPUT_KINDS.includes(i.kind) && !led.items.some((x) => x.id === i.id)) restore(i);
  return { pf, led, stored, runId: runId ?? stored?.runId ?? null, cap: maxExtraSources(cfg) };
}

function summarize(items, cap) {
  const inputs = items.filter((i) => INPUT_KINDS.includes(i.kind));
  const extra = items.filter((i) => i.kind === "extra");
  return {
    inputs: {
      total: inputs.length,
      read: inputs.filter((i) => i.status === "mapped").length,
      failed: inputs.filter((i) => i.status === "excluded" && i.reason === "failed").length,
      excluded: inputs.filter((i) => i.status === "excluded" && i.reason === "excluded").length,
      pending: inputs.filter((i) => i.status === "pending").length,
    },
    extra: { cap, used: extra.filter((i) => i.status === "mapped").length, deferred: extra.filter((i) => i.status === "deferred").length },
    liveProduct: items.filter((i) => i.kind === "live-product").length,
  };
}

function saveLedger({ pf, led, stored, runId, cap }) {
  // a stamp survives a ledger change: checkProduct/checkModule re-evaluate the ledger on every call
  const data = { pass: pf.pass, runId, maxExtraSources: cap, items: led.items, summary: summarize(led.items, cap), ...(stored?.verified ? { verified: stored.verified } : {}) };
  mkdirSync(path.dirname(pf.coverage), { recursive: true });
  writeJson(pf.coverage, data);
  return data;
}

// add-source for a pass: registers the source (product-wide id) and records it in the pass's ledger. A configured
// input becomes read. An extra source (not configured, not live-product) over knowledge.max_extra_sources is not
// registered: -> {deferred: true, reason: "budget", detail}, and it stays in the ledger as `deferred: budget`.
export function registerSource(kp, cfg, { title, location, type, module, runId }) {
  if (!title || !location) throw new Error("a source needs a title and a location (URL or file path)");
  if (!SOURCE_TYPES.includes(type)) throw new Error(`source type must be one of [${SOURCE_TYPES}]`);
  // live-product is free of the budget, so it must really be the product: a page on target.url or target.api_urls
  if (type === "live-product" && !(isUrl(location) && isProductHost(hostOfUrl(location), cfg)))
    throw new Error(`a live-product source must be a page on the product's own host [${productHosts(cfg).join(", ")}]: '${location}' is not`);
  const loc = normalizeLocation(location);
  const pf = passFiles(kp, module);
  return withFileLock(pf.coverage, () => {
    const L = loadLedger(kp, cfg, module, { runId });
    const item = L.led.items.find((i) => i.id === loc);
    const configured = item && INPUT_KINDS.includes(item.kind);
    const kind = configured ? item.kind : type === "live-product" ? "live-product" : "extra";
    if (kind === "extra" && item?.status !== "mapped") {
      const used = L.led.items.filter((i) => i.kind === "extra" && i.status === "mapped").length;
      if (used >= L.cap) {
        const detail = `over knowledge.max_extra_sources (${L.cap})`;
        if (!item) L.led.addItem(loc, { kind, title: String(title).trim(), type });
        L.led.resolve(loc, { status: "deferred", reason: "budget", detail });
        saveLedger(L);
        return { deferred: true, location: loc, reason: "budget", detail, note: "not registered and not citable; the ledger keeps it as deferred" };
      }
    }
    const entry = addSource(kp, { title, location: loc, type, scope: module ?? "_product", runId });
    if (!item) L.led.addItem(loc, { kind, title: String(title).trim(), type });
    L.led.resolve(loc, { status: "mapped", refs: [entry.id] });
    saveLedger(L);
    return { ...entry, kind };
  });
}

// `input`: mark a configured input of the pass failed or excluded, with a reason.
export function markInput(kp, cfg, { module, location, status, reason, runId }) {
  if (!INPUT_OUTCOMES.includes(status)) throw new Error(`--status must be one of [${INPUT_OUTCOMES}]`);
  if (!reason || !String(reason).trim()) throw new Error("--reason is required: say why the input was not read");
  const loc = normalizeLocation(location);
  const pf = passFiles(kp, module);
  return withFileLock(pf.coverage, () => {
    const L = loadLedger(kp, cfg, module, { runId });
    const item = L.led.items.find((i) => i.id === loc && INPUT_KINDS.includes(i.kind));
    if (!item) throw new Error(`'${loc}' is not a configured input of this pass: [${configuredInputs(cfg, module).map((i) => i.id).join(", ")}]`);
    L.led.resolve(loc, { status: "excluded", reason: status, detail: String(reason).trim() });
    return { location: loc, status, reason: String(reason).trim(), summary: saveLedger(L).summary };
  });
}

// Problems of the pass's input ledger (pure: reads coverage.json, writes nothing).
export function ledgerProblems(kp, cfg, module) {
  const { led } = loadLedger(kp, cfg, module);
  const label = module ? `modules/${module}/coverage.json` : "coverage.json";
  const out = [];
  for (const i of led.items)
    if (i.status === "pending" && INPUT_KINDS.includes(i.kind))
      out.push(`${label}: input '${i.id}' (${i.kind}) is not accounted for: register it with add-source, or mark it with knowledge.mjs input --status failed|excluded --reason "..."`);
  for (const p of led.problems()) if (!/: unresolved/.test(p)) out.push(`${label}: ${p}`);
  return out;
}

export function ledgerSummary(kp, cfg, module) {
  const L = loadLedger(kp, cfg, module);
  return { ...summarize(L.led.items, L.cap), deferredSources: L.led.items.filter((i) => i.status === "deferred").map((i) => i.id) };
}

// ---------- source text cache (quotes are checked against it) ----------

export const readCacheIndex = (kp) => readJson(kp.cacheIndex, {});

const normalizeQuoteText = (s) =>
  String(s)
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
export { normalizeQuoteText };

// HTML -> readable text: scripts, styles and comments dropped, block ends become line breaks, entities decoded.
export function htmlToText(html) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg|head)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|section|article|dd|dt|pre|blockquote|table|ul|ol)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (m, e) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return entities[e.toLowerCase()] ?? m;
    })
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// ---- the product's hosts ----
// A host is compared lowercase, without brackets or a trailing dot. A URL's hostname never carries its port, so a
// product host is the product on any port (default or not).
export const normalizeHost = (h) => String(h ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
const hostOfUrl = (u) => {
  try {
    return normalizeHost(new URL(u).hostname);
  } catch {
    return null;
  }
};
export const productHosts = (cfg) => [...new Set(firstPartyHosts(cfg).map(normalizeHost))];
// Exact, as the guard compares (target.url + target.api_urls); with subdomains, also any host under one of them.
export function isProductHost(host, cfg, { subdomains = false } = {}) {
  const h = normalizeHost(host);
  return !!h && productHosts(cfg).some((p) => h === p || (subdomains && h.endsWith(`.${p}`)));
}

// An HTML page with fewer words than this after conversion is a failed fetch (it likely needs scripts to render).
export const MIN_FETCH_WORDS = 20;

// Stores the text of source `id` in sources/<id>.txt and its index entry (status fresh).
// meta: {captured_by: script|agent, runId, from?, fetchError?}
export function storeSnapshot(kp, id, text, { captured_by, runId, from, fetchError } = {}) {
  if (!["script", "agent"].includes(captured_by)) throw new Error("captured_by must be script or agent");
  const body = String(text).trim();
  if (!body) throw new Error(`${id}: the source has no text to cache`);
  const reg = readRegistry(kp).find((s) => s.id === id);
  if (!reg) throw new Error(`${id} is not in sources.json`);
  mkdirSync(kp.cacheDir, { recursive: true });
  return withFileLock(kp.cacheIndex, () => {
    writeAtomic(kp.cacheFile(id), body + "\n");
    const index = readCacheIndex(kp);
    index[id] = {
      location: reg.location, status: "fresh", captured_by, capturedAt: today(), ...(runId ? { runId } : {}),
      sha256: sha256Text(body + "\n"), chars: body.length, ...(from ? { from } : {}), ...(fetchError ? { fetchError } : {}),
    };
    writeJson(kp.cacheIndex, index);
    return { id, ...index[id] };
  });
}

// Records that the script's own fetch of `id` failed in this run. Old text is kept and marked `stale`; with no text,
// the entry is `failed`. Either way the agent may then pass --from-file for this source in this run.
function recordFetchFailure(kp, id, message, runId) {
  mkdirSync(kp.cacheDir, { recursive: true });
  return withFileLock(kp.cacheIndex, () => {
    const index = readCacheIndex(kp);
    const old = index[id];
    const fetchError = { ...(runId ? { runId } : {}), at: today(), message };
    const hasText = old && old.status !== "failed" && existsSync(kp.cacheFile(id));
    const location = readRegistry(kp).find((s) => s.id === id)?.location ?? old?.location;
    index[id] = hasText ? { ...old, status: "stale", fetchError } : { location, status: "failed", fetchError };
    writeJson(kp.cacheIndex, index);
    return { id, ...index[id] };
  });
}

// Why the script won't read this file, or null. Credentials files (D-012) and anything outside the repo are refused.
function fileRefusal(abs, root, cfg) {
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return "outside the repository";
  const auth = cfg.authorizations ?? {};
  const secrets = [auth.credentials_file, auth.session_state_file, ...(auth.identities ?? []).flatMap((i) => [i.credentials_file, i.session_state_file])]
    .filter((f) => typeof f === "string" && f)
    .map((f) => path.resolve(root, f));
  if (secrets.includes(path.resolve(abs))) return "a credentials or session file (D-012)";
  if (/(^|[\\/])\.env(\.[^\\/]*)?$|\.env$/i.test(abs)) return "a credentials (.env) file (D-012)";
  return null;
}

// A refusal is a rule, not a failure: it never unlocks --from-file and is never recorded as a failed fetch.
const refusal = (message) => Object.assign(new Error(`refused: ${message}`), { refused: true });

// One plain GET with no credentials, following at most 5 redirects, each checked against the product's hosts and
// their subdomains. -> text; throws on HTTP errors, binary content and an HTML page with no readable text.
async function fetchText(url, { fetchImpl, cfg, timeoutMs = 20000, maxChars = 5_000_000 }) {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const u = new URL(current);
    if (!["http:", "https:"].includes(u.protocol)) throw refusal(`${u.protocol} is not http(s)`);
    if (isProductHost(u.hostname, cfg, { subdomains: true })) throw refusal(`${u.hostname} is the product's own host (or under it); the script never fetches the product`);
    const res = await fetchImpl(current, { method: "GET", redirect: "manual", headers: { accept: "text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5" }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      current = new URL(res.headers.get("location"), current).href;
      continue;
    }
    if (!res.ok) throw new Error(`GET ${current}: HTTP ${res.status}`);
    const ctype = res.headers.get("content-type") ?? "";
    if (/pdf|octet-stream|zip|msword|officedocument|image\/|audio\/|video\//i.test(ctype)) throw new Error(`GET ${current}: ${ctype} is not text`);
    const body = await res.text();
    if (body.length > maxChars) throw new Error(`GET ${current}: more than ${maxChars} characters`);
    if (!(/html|xml/i.test(ctype) || /^\s*</.test(body))) return body;
    const text = htmlToText(body);
    if (text.split(/\s+/).filter(Boolean).length < MIN_FETCH_WORDS) throw new Error(`GET ${current}: fewer than ${MIN_FETCH_WORDS} words of readable text (the page may need scripts to render)`);
    return text;
  }
  throw new Error(`GET ${url}: more than 5 redirects`);
}

// The script's own read of a source: a URL by fetchText, a repo file directly (never a credentials file).
async function scriptText(src, { cfg, root, fetchImpl }) {
  if (isUrl(src.location)) {
    if (isProductHost(hostOfUrl(src.location), cfg, { subdomains: true }))
      throw refusal(`${src.id} is on the product's own host (${hostOfUrl(src.location)}); the script never fetches the product. Register it as live-product, capture what you observed under knowledge/captures/ and pass --from-file`);
    return fetchText(src.location, { fetchImpl, cfg });
  }
  const abs = path.resolve(root, src.location);
  const why = fileRefusal(abs, root, cfg);
  if (why) throw refusal(`${src.location} is ${why}`);
  if (!existsSync(abs)) throw new Error(`file not found: ${src.location}`);
  const raw = read(abs);
  if (raw.includes("\u0000")) throw new Error(`${src.location} is a binary file; the script can't extract its text`);
  return /\.html?$/i.test(abs) ? htmlToText(raw) : raw;
}

// `snapshot`: cache the text of source `id` for this run.
//   - a source cached in this run is returned as is; one cached in an earlier run is fetched again, and if that fails
//     its old text is kept and marked `stale`
//   - fromFile (a capture under knowledge/captures/, captured_by: agent) only for a live-product source, or for a
//     source whose own fetch by the script failed in this run (the failure is in the cache entry)
export async function snapshot(kp, cfg, { id, fromFile, root, runId, fetchImpl = globalThis.fetch }) {
  const src = readRegistry(kp).find((s) => s.id === id);
  if (!src) throw new Error(`${id} is not in sources.json (register it with add-source first)`);
  const entry = readCacheIndex(kp)[id];
  if (fromFile) {
    const failedNow = !!entry?.fetchError && entry.fetchError.runId === runId;
    if (src.type !== "live-product" && !failedNow)
      throw refusal(`--from-file is only for a live-product source, or after the script's own fetch of ${id} failed in this run (run snapshot without --from-file first)`);
    const abs = path.resolve(root, fromFile);
    const rel = path.relative(kp.captures, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw refusal(`a capture must be a file under ${path.relative(root, kp.captures).replaceAll("\\", "/")}/`);
    if (!existsSync(abs)) throw new Error(`capture not found: ${fromFile}`);
    return storeSnapshot(kp, id, read(abs), { captured_by: "agent", runId, from: path.relative(root, abs).replaceAll("\\", "/"), ...(entry?.fetchError ? { fetchError: entry.fetchError } : {}) });
  }
  if (entry?.status === "fresh" && entry.runId === runId && existsSync(kp.cacheFile(id))) return { id, ...entry, cached: true };
  let text;
  try {
    text = await scriptText({ ...src, id }, { cfg, root, fetchImpl });
  } catch (e) {
    if (e.refused) throw e;
    const r = recordFetchFailure(kp, id, e.message, runId);
    if (r.status === "stale") return { ...r, stale: true, note: "the fetch failed; the text from an earlier run is kept and marked stale" };
    throw new Error(`${id}: the script could not read it (${e.message}). Capture the page under knowledge/captures/ and pass --from-file`);
  }
  return storeSnapshot(kp, id, text, { captured_by: "script", runId });
}

// null when `quote` appears in the cached text of `id`, else why not.
function quoteProblem(kp, cache, id, quote) {
  const words = normalizeQuoteText(quote).split(" ").filter(Boolean);
  if (words.length < MIN_QUOTE_WORDS) return `the quote for ${id} needs at least ${MIN_QUOTE_WORDS} words`;
  if (!cache.has(id)) cache.set(id, existsSync(kp.cacheFile(id)) ? normalizeQuoteText(read(kp.cacheFile(id))) : null);
  const text = cache.get(id);
  if (text === null) return `${id} has no cached text: run knowledge.mjs snapshot <product> ${id}`;
  return text.includes(words.join(" ")) ? null : `the quote "${quote.slice(0, 60)}" is not in the cached text of ${id}`;
}

// ---------- markdown scan ----------

// -> [{n, raw, t, kind: blank|heading|fence|separator|table-header|content, level?, title?, section, open}]
export function scanMarkdown(text) {
  const lines = text.split(/\r?\n/);
  let section = null;
  return lines.map((raw, i) => {
    const t = raw.trim();
    const base = { n: i + 1, raw, t, section, open: section === "open points" };
    if (!t) return { ...base, kind: "blank" };
    if (FENCE_RE.test(raw)) return { ...base, kind: "fence" };
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      const level = h[1].length;
      if (level <= 2) section = level === 2 ? h[2].trim().toLowerCase() : null;
      return { ...base, kind: "heading", level, title: h[2].trim(), section, open: false };
    }
    if (SEPARATOR_RE.test(t)) return { ...base, kind: "separator" };
    if (t.startsWith("|") && SEPARATOR_RE.test((lines[i + 1] ?? "").trim())) return { ...base, kind: "table-header" };
    return { ...base, kind: "content" };
  });
}

// opts: {kp (for quotes), quoteNeeded(line) -> bool, cache}
function lineProblems(text, registryIds, { kp, quoteNeeded = () => false, cache = new Map() } = {}) {
  const problems = [];
  for (const l of scanMarkdown(text)) {
    if (l.kind === "fence") {
      problems.push(`line ${l.n}: code fences are not allowed in knowledge files`);
      continue;
    }
    if (l.kind !== "content") continue;
    const cites = parseCitations(l.t);
    for (const c of cites) if (!registryIds.has(c.id)) problems.push(`line ${l.n}: cites ${c.id}, which is not in sources.json`);
    if (l.open) {
      if (!BULLET_RE.test(l.raw)) problems.push(`line ${l.n}: an open point is a single bullet line ("- ..."): "${l.t.slice(0, 60)}"`);
    } else {
      if (!cites.length) problems.push(`line ${l.n}: no source citation ([S<n>]): "${l.t.slice(0, 60)}"`);
      else if (quoteNeeded(l) && !cites.some((c) => c.quote !== null)) problems.push(`line ${l.n}: a rule fact needs a verified quote, e.g. [S<n> "exact words"]: "${l.t.slice(0, 60)}"`);
    }
    if (kp) for (const c of cites) if (c.quote !== null && registryIds.has(c.id)) {
      const p = quoteProblem(kp, cache, c.id, c.quote);
      if (p) problems.push(`line ${l.n}: ${p}`);
    }
  }
  return problems;
}

// Every content line must cite a registered source, except under "## Open points"; no code fences.
export function checkCited(file, registryIds, opts) {
  return lineProblems(read(file), registryIds, opts);
}

// Which notes.md lines carry a rule fact and so need a quote.
export function needsQuote(line) {
  if (QUOTE_SECTIONS.some((s) => s.toLowerCase() === line.section)) return true;
  return line.section === CATEGORIES.entities.toLowerCase() && CONSTRAINT_RE.test(line.t.replace(CITE_RE, ""));
}

// Only the fixed headings: every `## ` heading is one of `allowed` (each once, all present), and no content sits
// outside them. title: the file has exactly one `# ` title, before its first `## `; without it, no `# ` at all.
// (`###` and deeper stay inside their `## ` section and its rules.)
function headingProblems(text, allowed, label, { title = true } = {}) {
  const ls = scanMarkdown(text);
  const out = [];
  const h1 = ls.filter((l) => l.kind === "heading" && l.level === 1);
  const h2 = ls.filter((l) => l.kind === "heading" && l.level === 2);
  if (title && !h1.length) out.push(`${label}: needs a "# <name>" title`);
  for (const h of h1.slice(title ? 1 : 0)) out.push(`${label} line ${h.n}: "# ${h.title}" is not allowed (${title ? "one # title only" : "no # headings in this file"})`);
  if (title && h1.length && h2.length && h2[0].n < h1[0].n) out.push(`${label}: the "# " title must come before the first "## " heading`);
  const names = new Map(allowed.map((h) => [h.toLowerCase(), h]));
  const seen = new Set();
  for (const h of h2) {
    const k = h.title.toLowerCase();
    if (!names.has(k)) out.push(`${label} line ${h.n}: "## ${h.title}" is not an allowed heading (only: ${allowed.join(", ")})`);
    else if (seen.has(k)) out.push(`${label} line ${h.n}: "## ${h.title}" appears twice`);
    seen.add(k);
  }
  for (const h of allowed) if (!seen.has(h.toLowerCase())) out.push(`${label}: missing the heading "## ${h}"`);
  for (const l of ls) if ((l.kind === "content" || l.kind === "table-header") && l.section === null) out.push(`${label} line ${l.n}: content must be under one of the "## " headings: "${l.t.slice(0, 60)}"`);
  return out;
}

// ---------- open points ----------

const openPointKey = (text) => normalizeQuoteText(text.replace(CITE_RE, " ").replace(/[.;:,\s]+$/, ""));

// -> [{text, category|null, key, file, line}] from the "## Open points" sections of the pass's files
export function openPointsOf(kp, module) {
  const out = [];
  for (const f of passFiles(kp, module).withOpenPoints) {
    if (!existsSync(f)) continue;
    for (const l of scanMarkdown(read(f))) {
      if (!l.open || l.kind !== "content" || !BULLET_RE.test(l.raw)) continue;
      let text = l.t.replace(/^[-*+]\s+/, "");
      const tag = TAG_RE.exec(text);
      const category = tag ? tag[1].toLowerCase() : null;
      if (tag) text = text.slice(tag[0].length);
      out.push({ text: text.trim(), category, key: openPointKey(text), file: path.relative(kp.dir, f).replaceAll("\\", "/"), line: l.n });
    }
  }
  return out;
}

// Writes the pass's open-points.json: one stable id per open point (KQ-<m>-<n> / KQ-product-<n>), never reused; a
// point that disappears is kept as `gone`. -> the active points [{id, key, text, category, file}]
export function syncOpenPoints(kp, module, { runId } = {}) {
  const pf = passFiles(kp, module);
  const points = openPointsOf(kp, module);
  const first = new Map();
  for (const p of points) if (!first.has(p.key)) first.set(p.key, p);
  mkdirSync(path.dirname(pf.openPoints), { recursive: true });
  const reg = assignIds(pf.openPoints, [...first.keys()], { module: pf.pass, runId, prefix: "KQ", field: "points" });
  for (const [key, p] of first) Object.assign(reg.points[key], { text: p.text, category: p.category, file: p.file });
  writeJson(pf.openPoints, reg);
  return [...first].map(([key, p]) => ({ id: reg.points[key].id, key, text: p.text, category: p.category, file: p.file }));
}

function openPointProblems(kp, module) {
  const pf = passFiles(kp, module);
  const label = module ? `modules/${module}/open-points.json` : "open-points.json";
  const points = openPointsOf(kp, module);
  const out = [];
  const seen = new Map();
  for (const p of points) {
    if (seen.has(p.key)) out.push(`${p.file} line ${p.line}: the same open point as line ${seen.get(p.key).line} of ${seen.get(p.key).file}`);
    else seen.set(p.key, p);
  }
  const reg = readJson(pf.openPoints, null);
  if (!reg) return [...out, `${label}: missing (run knowledge.mjs render)`];
  const active = Object.entries(reg.points ?? {}).filter(([, e]) => e.status === "active");
  const stale = active.length !== seen.size || active.some(([k, e]) => !seen.has(k) || seen.get(k).category !== (e.category ?? null) || seen.get(k).text !== e.text);
  if (stale) out.push(`${label}: stale -- the open points changed (run knowledge.mjs render)`);
  return out;
}

export function readOpenPoints(kp, module) {
  const reg = readJson(passFiles(kp, module).openPoints, { points: {} });
  return Object.values(reg.points ?? {}).filter((e) => e.status === "active").map((e) => e.id);
}

// ---------- glossary tables ----------

const splitRow = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());

export function parseTable(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return { header: [], rows: [] };
  return { header: splitRow(lines[0]), rows: lines.slice(2).map(splitRow) };
}

export function mergeGlossary(kp, module) {
  return withFileLock(kp.product.glossary, () => {
    const prod = parseTable(existsSync(kp.product.glossary) ? read(kp.product.glossary) : "");
    const mod = parseTable(read(kp.module(module).glossary));
    if (mod.header.join("|") !== MODULE_GLOSSARY_HEADER.join("|")) throw new Error(`module glossary header must be: | ${MODULE_GLOSSARY_HEADER.join(" | ")} |`);
    const kept = prod.rows.filter((r) => r[2] !== module);
    const merged = [...kept, ...mod.rows.map(([t, d, s]) => [t, d, module, s])];
    const body = [`| ${PRODUCT_GLOSSARY_HEADER.join(" | ")} |`, `|${PRODUCT_GLOSSARY_HEADER.map(() => "---").join("|")}|`, ...merged.map((r) => `| ${r.join(" | ")} |`)];
    writeAtomic(kp.product.glossary, "# Glossary\n\n" + body.join("\n") + "\n");
    return { terms: merged.length, fromModule: mod.rows.length };
  });
}

export function checkGlossary(file, header) {
  const { header: h, rows } = parseTable(read(file));
  const problems = [];
  if (h.join("|") !== header.join("|")) problems.push(`glossary header must be: | ${header.join(" | ")} |`);
  rows.forEach((r, i) => {
    if (r.length !== header.length) problems.push(`glossary row ${i + 1}: expected ${header.length} cells`);
    else if (!r[0] || !r[1]) problems.push(`glossary row ${i + 1}: Term and Definition are required`);
  });
  return problems;
}

// ---------- checks ----------

// `## Main areas` has exactly one top-level bullet per configured module, matched by its name at the start.
function mainAreaProblems(text, cfg) {
  const modules = (cfg.modules ?? []).map((m) => m.name).filter(Boolean);
  const bullets = scanMarkdown(text).filter((l) => l.section === "main areas" && l.kind === "content" && BULLET_RE.test(l.raw));
  const counts = new Map(modules.map((n) => [n, 0]));
  const out = [];
  for (const b of bullets) {
    const lead = b.t.replace(/^[-*+]\s+/, "").replace(/^[*_`]+/, "").toLowerCase();
    const hit = [...modules].sort((a, z) => z.length - a.length).find((n) => lead.startsWith(n.toLowerCase()) && !/[a-z0-9]/i.test(lead[n.length] ?? ""));
    if (hit) counts.set(hit, counts.get(hit) + 1);
    else out.push(`overview.md line ${b.n}: a "## Main areas" bullet must start with a configured module's name: "${b.t.slice(0, 60)}"`);
  }
  for (const [n, c] of counts) if (c !== 1) out.push(`overview.md: "## Main areas" needs exactly one bullet for module '${n}' (found ${c})`);
  return out;
}

// Each fact category has a cited content line in its notes.md section, or an open point tagged with it.
function categoryProblems(notesText, points) {
  const lines = scanMarkdown(notesText);
  const out = [];
  for (const [tag, section] of Object.entries(CATEGORIES)) {
    const cited = lines.some((l) => l.kind === "content" && l.section === section.toLowerCase() && parseCitations(l.t).length);
    if (!cited && !points.some((p) => p.category === tag)) out.push(`notes.md: "## ${section}" needs a cited fact, or an open point tagged "(${tag})"`);
  }
  return out;
}

// The content checks of the product pass (pure). cfg: the run's resolved config.
export function productProblems(kp, cfg) {
  const ids = new Set(readRegistry(kp).map((s) => s.id));
  const problems = [];
  if (!ids.size) problems.push("sources.json: no sources registered");
  for (const [name, f] of Object.entries(kp.product)) if (!nonEmpty(f)) problems.push(`${name}.md: missing or empty`);
  if (problems.length) return problems;
  const cache = new Map();
  const overview = read(kp.product.overview);
  problems.push(...headingProblems(overview, PRODUCT_OVERVIEW_HEADINGS, "overview.md"));
  problems.push(...mainAreaProblems(overview, cfg));
  for (const e of checkCited(kp.product.overview, ids, { kp, cache })) problems.push(`overview.md ${e}`);
  for (const e of checkCited(kp.product.glossary, ids, { kp, cache })) problems.push(`glossary.md ${e}`);
  for (const e of checkGlossary(kp.product.glossary, PRODUCT_GLOSSARY_HEADER)) problems.push(`glossary.md: ${e}`);
  problems.push(...ledgerProblems(kp, cfg));
  problems.push(...openPointProblems(kp));
  return problems;
}

// The content checks of a module pass (pure).
export function moduleProblems(kp, cfg, module) {
  const ids = new Set(readRegistry(kp).map((s) => s.id));
  const m = kp.module(module);
  const at = (name) => `modules/${module}/${name}.md`;
  const problems = [];
  for (const name of ["overview", "glossary", "notes", "sources"]) if (!nonEmpty(m[name])) problems.push(`${at(name)}: missing or empty`);
  if (problems.length) return problems;
  const cache = new Map();
  problems.push(...headingProblems(read(m.overview), MODULE_OVERVIEW_HEADINGS, at("overview")));
  problems.push(...headingProblems(read(m.notes), NOTES_HEADINGS, at("notes"), { title: false }));
  for (const name of ["overview", "glossary", "notes"]) for (const e of checkCited(m[name], ids, { kp, cache, quoteNeeded: name === "notes" ? needsQuote : undefined })) problems.push(`${at(name)} ${e}`);
  for (const e of categoryProblems(read(m.notes), openPointsOf(kp, module))) problems.push(`modules/${module}/${e}`);
  for (const e of checkGlossary(m.glossary, MODULE_GLOSSARY_HEADER)) problems.push(`${at("glossary")}: ${e}`);
  const prod = parseTable(existsSync(kp.product.glossary) ? read(kp.product.glossary) : "");
  const merged = new Set(prod.rows.filter((r) => r[2] === module).map((r) => r[0]));
  const missing = parseTable(read(m.glossary)).rows.filter((r) => !merged.has(r[0]));
  if (missing.length) problems.push(`${at("glossary")}: ${missing.length} term(s) not merged into the product glossary (run merge-glossary)`);
  const cited = [m.overview, m.glossary, m.notes].flatMap((f) => [...citedIds(read(f))]);
  const listed = citedIds(read(m.sources).replace(/\| (S\d+) \|/g, "[$1]"));
  if (cited.some((id) => !listed.has(id))) problems.push(`${at("sources")} is stale (run render --module ${module})`);
  problems.push(...ledgerProblems(kp, cfg, module));
  problems.push(...openPointProblems(kp, module));
  problems.push(...ruleFactProblems(kp, module));
  return problems;
}

// ---------- verified stamp (lib/verified.mjs) ----------

// The files a pass's stamp covers. The product glossary is shared with the module passes (merge-glossary), so the
// product stamp covers its product-scope rows (`glossaryRows`) instead of the file.
function stampInputs(kp, module) {
  if (!module) return { overview: kp.product.overview, openPoints: kp.openPoints };
  const m = kp.module(module);
  return { overview: m.overview, glossary: m.glossary, notes: m.notes, sources: m.sources, openPoints: m.openPoints, ruleFacts: m.ruleFacts };
}
const productRowsDigest = (kp) =>
  sha256Text(JSON.stringify(parseTable(existsSync(kp.product.glossary) ? read(kp.product.glossary) : "").rows.filter((r) => r[2] === PRODUCT_PASS)));

function stampProblem(kp, module) {
  const pf = passFiles(kp, module);
  const stamp = readJson(pf.coverage, {})?.verified;
  const label = module ? `module ${module}` : "product";
  const unstamped = `the ${label} knowledge did not pass knowledge.mjs check (no verified stamp)`;
  if (!stamp) return unstamped;
  const { glossaryRows, ...files } = stamp;
  const why = unverifiedReason(files, stampInputs(kp, module), { unstamped, changed: `the ${label} knowledge changed after knowledge.mjs check (run check again)` });
  if (why) return why;
  if (!module && glossaryRows !== productRowsDigest(kp)) return `the ${label} knowledge changed after knowledge.mjs check (run check again)`;
  return null;
}

function writeStamp(kp, module) {
  const pf = passFiles(kp, module);
  return withFileLock(pf.coverage, () => {
    const data = readJson(pf.coverage, null);
    data.verified = { ...stampVerified(stampInputs(kp, module)), ...(module ? {} : { glossaryRows: productRowsDigest(kp) }) };
    writeJson(pf.coverage, data);
    return data.verified;
  });
}

// What the stage's done runs (pure): the content checks, then a current verified stamp.
export function checkProduct(kp, cfg) {
  const problems = productProblems(kp, cfg);
  if (problems.length) return problems;
  const s = stampProblem(kp);
  return s ? [s] : [];
}

export function checkModule(kp, cfg, module) {
  const problems = moduleProblems(kp, cfg, module);
  if (problems.length) return problems;
  const s = stampProblem(kp, module);
  return s ? [s] : [];
}

// `check` from the CLI: refreshes open-points.json, runs the content checks and, when they pass, writes the verified
// stamp. -> {valid, problems, inputs, deferredSources, openPoints, capturedByAgent}
// ---------- rule facts and their evidence ----------

// How strong the cached text behind a verified quote is: script-fetched (fresh, fetched or read by the script),
// agent-capture (the agent's --from-file capture), stale (a later re-fetch failed; older text kept).
export const EVIDENCE = ["script-fetched", "agent-capture", "stale"];
const evidenceOf = (entry) => (entry?.status === "stale" ? "stale" : entry?.captured_by === "agent" ? "agent-capture" : "script-fetched");
const SECTION_TAG = Object.fromEntries(Object.entries(CATEGORIES).map(([tag, s]) => [s.toLowerCase(), tag]));

// The rule facts of a module's notes.md (the lines needsQuote() selects) with every quote that verifies, each tagged
// with its evidence. A fact's evidence is its strongest quote's, in EVIDENCE order: a fact is weaker evidence
// (agent-capture or stale) only when no quote of it rests on script-fetched text. Facts with no verified quote are
// left out (check fails on them anyway). -> [{file, line, category, text, citations: [{source, quote, evidence}], evidence}]
export function ruleFactsOf(kp, module) {
  const m = kp.module(module);
  if (!existsSync(m.notes)) return [];
  const index = readCacheIndex(kp);
  const ids = new Set(readRegistry(kp).map((s) => s.id));
  const cache = new Map();
  const facts = [];
  for (const l of scanMarkdown(read(m.notes))) {
    if (l.kind !== "content" || l.open || !needsQuote(l)) continue;
    const citations = parseCitations(l.t)
      .filter((c) => c.quote !== null && ids.has(c.id) && !quoteProblem(kp, cache, c.id, c.quote))
      .map((c) => ({ source: c.id, quote: c.quote, evidence: evidenceOf(index[c.id]) }));
    if (!citations.length) continue;
    const evidence = EVIDENCE.find((e) => citations.some((c) => c.evidence === e));
    facts.push({ file: `modules/${module}/notes.md`, line: l.n, category: SECTION_TAG[l.section], text: l.t, citations, evidence });
  }
  return facts;
}

// Writes modules/<m>/rule-facts.json (schema knowledge-rule-facts) for later agents: test cases built on a weaker fact
// are tagged @assumption. -> the facts
export function writeRuleFacts(kp, module) {
  const facts = ruleFactsOf(kp, module);
  mkdirSync(kp.module(module).dir, { recursive: true });
  writeJson(kp.module(module).ruleFacts, { module, facts });
  return facts;
}

function ruleFactProblems(kp, module) {
  const file = kp.module(module).ruleFacts;
  if (!existsSync(file)) return [`modules/${module}/rule-facts.json: missing (run knowledge.mjs check)`];
  return JSON.stringify(readJson(file, {}).facts ?? null) === JSON.stringify(ruleFactsOf(kp, module)) ? [] : [`modules/${module}/rule-facts.json: stale -- the rule facts or their sources changed (run knowledge.mjs check)`];
}

export function runCheck(kp, cfg, { module, runId } = {}) {
  syncOpenPoints(kp, module, { runId });
  const facts = module ? writeRuleFacts(kp, module) : [];
  const flagged = (e) => facts.filter((f) => f.evidence === e).map((f) => ({ file: f.file, line: f.line, sources: f.citations.map((c) => c.source) }));
  // make sure a ledger exists to stamp, listing the configured inputs
  const pf = passFiles(kp, module);
  if (!existsSync(pf.coverage)) withFileLock(pf.coverage, () => saveLedger(loadLedger(kp, cfg, module, { runId })));
  const problems = module ? moduleProblems(kp, cfg, module) : productProblems(kp, cfg);
  if (!problems.length) writeStamp(kp, module);
  const files = module ? [kp.module(module).overview, kp.module(module).glossary, kp.module(module).notes] : [kp.product.overview, kp.product.glossary];
  const cited = new Set(files.filter(existsSync).flatMap((f) => [...citedIds(read(f))]));
  const index = readCacheIndex(kp);
  const s = ledgerSummary(kp, cfg, module);
  return {
    valid: !problems.length,
    problems,
    inputs: s.inputs,
    extraSources: s.extra,
    deferredSources: s.deferredSources,
    openPoints: readOpenPoints(kp, module),
    capturedByAgent: [...cited].filter((id) => index[id]?.captured_by === "agent").length,
    staleSources: [...cited].filter((id) => index[id]?.status === "stale").length,
    ...(module
      ? {
          ruleFacts: { total: facts.length, ...Object.fromEntries(EVIDENCE.map((e) => [e, facts.filter((f) => f.evidence === e).length])) },
          // allowed, but weaker evidence: test cases built on these are tagged @assumption
          agentCapturedRuleFacts: flagged("agent-capture"),
          staleRuleFacts: flagged("stale"),
        }
      : {}),
  };
}

// ---------- reuse unless inputs changed ----------

function docFingerprint(doc, root) {
  try {
    const u = new URL(doc);
    if (u.protocol === "http:" || u.protocol === "https:") return { doc };
  } catch {}
  const abs = path.resolve(root, doc);
  if (!existsSync(abs)) throw new Error(`requirement doc not found: ${doc}`);
  return { doc, sha1: sha1(readFileSync(abs)) };
}

export function fingerprints(cfg, root) {
  const productInputs = {
    references: [...(cfg.knowledge?.references ?? [])].map(normalizeLocation).sort(),
    requirement_docs: (cfg.feature?.requirement_docs ?? []).map((d) => docFingerprint(d, root)),
  };
  const product = sha1(JSON.stringify(productInputs));
  const modules = {};
  for (const m of cfg.modules ?? []) {
    const own = { slug: m.slug, name: m.name, entry_url: m.entry_url ?? null, nav_path: m.nav_path ?? null, references: [...(m.references ?? [])].map(normalizeLocation).sort() };
    modules[m.slug] = sha1(JSON.stringify({ product, own }));
  }
  return { product, modules };
}

// -> { product: "reuse"|"generate", modules: {<m>: "reuse"|"generate"} }
export function plan(kp, cfg, root) {
  const fp = fingerprints(cfg, root);
  const rec = readJson(kp.inputs, { product: null, modules: {} });
  const productOk = rec.product === fp.product && !checkProduct(kp, cfg).length;
  const modules = {};
  for (const [m, h] of Object.entries(fp.modules)) modules[m] = productOk && rec.modules?.[m] === h && !checkModule(kp, cfg, m).length ? "reuse" : "generate";
  return { product: productOk ? "reuse" : "generate", modules };
}

// Called when a knowledge stage is marked done: remember which inputs produced the current files.
export function recordInputs(kp, cfg, root, module) {
  const fp = fingerprints(cfg, root);
  return withFileLock(kp.inputs, () => {
    const rec = readJson(kp.inputs, { product: null, modules: {} });
    if (module) rec.modules = { ...rec.modules, [module]: fp.modules[module] };
    else rec.product = fp.product;
    writeJson(kp.inputs, rec);
    return rec;
  });
}
