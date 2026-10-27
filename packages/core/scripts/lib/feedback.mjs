// Feedback files (docs/conventions.md, Feedback contract): parsing, decision-aware triage and the Resolution check.
// Deterministic; never edits a file. The agent writes the Resolution, `check` verifies it.
//
// Two modes, told apart by the file's own frontmatter `target` (written by whoever filed it, never by the resolver):
//   outputs    target: <product slug> -- feedback about what a run produced, resolved by feedback-implementor-agent
//              (P-7). A fixed finding names the domain check it ran, and each file it changed lies in that domain's
//              writable set (OUTPUT_DOMAINS, bounded by config/permissions.yaml) and is no managed file; changed test
//              cases say they await human re-approval.
//   framework  target: framework -- feedback about the framework itself, resolved by the maintainers'
//              framework-implementor-agent under D-062: a fixed finding that changed scripts/ lists a *.test.mjs.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { loadConfig } from "./config.mjs";
import { SLUG_RE } from "./contract.mjs";
import { governing, loadDecisions } from "./decisions.mjs";
import { canWrite, isManaged, resolvePermissions } from "./permissions.mjs";

export const STATUSES = ["fixed", "deferred", "declined"];
export const SEVERITIES = ["blocking", "high", "medium", "low"];
const FRONT_KEYS = ["source_agent", "date", "target", "related_files", "severity"];
const PATH_RE = /(?<![\w./-])((?:[\w.-]+\/)+[\w.-]*\w\.(?:mjs|js|ts|json|md|ya?ml|csv|html|css))(?![\w/-])/g;
const norm = (p) => p.trim().replace(/^`|`$/g, "").replaceAll("\\", "/").replace(/^\.\//, "");
// -> { path } (repo-relative, posix, no . or ..) or { problem }: absolute paths and paths leaving the repo are refused.
export function canonPath(p) {
  const raw = norm(p);
  if (/^(?:\/|[a-zA-Z]:)/.test(raw)) return { problem: `${raw} is an absolute path (use a repo-relative path)` };
  const n = path.posix.normalize(raw);
  if (n === ".." || n.startsWith("../")) return { problem: `${raw} resolves outside the repository` };
  return { path: n === "." ? "" : n };
}
// Decisions governing a path, matched case-insensitively (Windows file systems).
const lowerGlobs = (decisions) => decisions.map((d) => ({ ...d, affects: d.affects.map((g) => g.toLowerCase()) }));
const govern = (decisions, f) => governing(lowerGlobs(decisions), f.toLowerCase());
const isTest = (f) => /^scripts\/(?:.+\/)?[^/]+\.test\.mjs$/.test(f);
const isScript = (f) => f.startsWith("scripts/") && !isTest(f);

export const FRAMEWORK_TARGET = "framework";
export const OUTPUT_AGENT = "feedback-implementor-agent";
// The run-output domains (P-7): the script whose `check` verifies each, and the agents whose write rows in
// config/permissions.yaml own its files. A file is in a domain when OUTPUT_AGENT's row and one of these rows may both
// write it and it is not a managed file, so the permissions file stays the one statement of the scope.
export const OUTPUT_DOMAINS = {
  knowledge: { script: "knowledge", agents: ["knowledge-generator"] },
  testcases: { script: "testcases", agents: ["testcase-writer"], reapproval: true },
  "api-discovery": { script: "endpoints", agents: ["api-discoverer"] },
  "api-plan": { script: "api-plan", agents: ["api-test-planner"] },
  "playwright-ui": { script: "ui-code", agents: ["pw-ui-fixer"] },
  "playwright-api": { script: "api-code", agents: ["pw-api-fixer", "pw-api-client-writer", "pw-api-tests-writer"] },
  "k6-workload": { script: "workload", agents: ["k6-workload-designer"] },
  k6: { script: "k6-code", agents: ["k6-fixer"] },
  report: { script: "report", agents: ["report-generator"] },
};
const DOMAIN_OF_SCRIPT = Object.fromEntries(Object.entries(OUTPUT_DOMAINS).map(([d, v]) => [v.script, d]));
const REAPPROVAL_RE = /awaits? human re-?approval/i;

// -> "outputs" | "framework" | null (target missing or not a product slug; frontmatter problems say why)
export function modeOf(front) {
  const t = front?.target;
  if (t === FRAMEWORK_TARGET) return "framework";
  return t && SLUG_RE.test(t) ? "outputs" : null;
}

// The effective permissions (overlays and ejected config included, as the guard sees them) -> resolved, or throws.
function loadScope(root) {
  const { errors, resolved } = resolvePermissions(loadConfig("permissions.yaml", { workspace: root }));
  if (errors.length) throw new Error(`config/permissions.yaml: ${errors.join("; ")}`);
  for (const a of [OUTPUT_AGENT, ...Object.values(OUTPUT_DOMAINS).flatMap((d) => d.agents)])
    if (!resolved.agents[a]) throw new Error(`config/permissions.yaml has no '${a}' row`);
  return resolved;
}

// -> { managed, domains: [domain] } for a repo-relative path of product `product`, in any module and any run (`*`)
export function outputDomainsOf(resolved, file, product) {
  const values = { product, module: "*", run_id: "*" };
  const vars = resolved.variables ?? {};
  if (isManaged(resolved, file, values)) return { managed: true, domains: [] };
  if (!canWrite(resolved.agents[OUTPUT_AGENT], file, vars, values)) return { managed: false, domains: [] };
  const domains = Object.entries(OUTPUT_DOMAINS).filter(([, d]) => d.agents.some((a) => canWrite(resolved.agents[a], file, vars, values))).map(([n]) => n);
  return { managed: false, domains };
}

// The domain checks a Resolution names: `<script>.mjs check <product> ...` -> { domains: Set, problems }
function namedChecks(text, product, at) {
  const domains = new Set();
  const problems = [];
  for (const m of text.matchAll(/([\w-]+)\.mjs[`'"]?\s+check\s+[`'"]?([^\s`'",]+)/g)) {
    const dom = DOMAIN_OF_SCRIPT[m[1]];
    if (!dom) problems.push(`${at}: ${m[1]}.mjs check is not a domain check (one of ${Object.values(OUTPUT_DOMAINS).map((d) => `${d.script}.mjs`).join(", ")})`);
    else if (m[2] !== product) problems.push(`${at}: Domain check runs ${m[1]}.mjs check on '${m[2]}', not on this feedback's product '${product}'`);
    else domains.add(dom);
  }
  return { domains, problems };
}

// -> { front, problems, body } ; the frontmatter is a flat key: value file with one list (related_files).
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { front: null, problems: ["frontmatter missing (the file must start with ---)"], body: text };
  const front = {};
  let list = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && list) {
      front[list].push(norm(item[1]));
      continue;
    }
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[1] === "related_files") {
      front.related_files = kv[2] && kv[2] !== "[]" ? [norm(kv[2])] : [];
      list = "related_files";
    } else {
      front[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
      list = null;
    }
  }
  const problems = [];
  for (const k of FRONT_KEYS) if (front[k] === undefined || front[k] === "") problems.push(`frontmatter: ${k} is missing`);
  if (front.date && !/^\d{4}-\d{2}-\d{2}$/.test(front.date)) problems.push("frontmatter: date must be YYYY-MM-DD");
  if (front.severity && !SEVERITIES.includes(front.severity)) problems.push(`frontmatter: severity must be one of ${SEVERITIES.join(", ")}`);
  if (front.related_files && !front.related_files.length) problems.push("frontmatter: related_files must list at least one file");
  return { front, problems, body: m[2] };
}

// -> { findings: [{ n, title, text }], resolution: string|null } ; the Resolution section ends the file.
export function splitSections(body) {
  const resAt = body.search(/^## Resolution\b/m);
  const findingsText = resAt < 0 ? body : body.slice(0, resAt);
  const heads = [...findingsText.matchAll(/^## Finding (\d+)\s*[:.-]?\s*(.*)$/gm)];
  const findings = heads.map((h, i) => ({ n: Number(h[1]), title: h[2].trim(), text: findingsText.slice(h.index, heads[i + 1]?.index ?? findingsText.length) }));
  return { findings, resolution: resAt < 0 ? null : body.slice(resAt) };
}

// Resolution format (one block per finding, in the order of the findings):
//   ### Finding N
//   - **Status:** fixed | deferred | declined
//   - **Reason:** <one line or more>
//   - **Files changed:** <comma-separated paths, or none>      (or an indented `- path` list)
//   - **Decisions considered:** D-012, D-040                   (or none)
//   - **Domain check:** `node {fw}/scripts/ui-code.mjs check acme contacts`   (outputs mode, a fixed finding)
export function parseResolution(text) {
  const heads = [...text.matchAll(/^### Finding (\d+)\b.*$/gm)];
  const entries = new Map();
  const problems = [];
  heads.forEach((h, i) => {
    const n = Number(h[1]);
    const block = text.slice(h.index + h[0].length, heads[i + 1]?.index ?? text.length);
    if (entries.has(n)) problems.push(`Resolution: Finding ${n} appears twice`);
    const field = (name) => {
      const m = new RegExp(`^- \\*\\*${name}:\\*\\*[ \\t]*([\\s\\S]*?)(?=^- \\*\\*|(?![\\s\\S]))`, "m").exec(block);
      return m ? m[1].trim() : null;
    };
    const split = (s) => (s === null ? null : [...s.matchAll(/(?:^|[\s,])-?\s*`?([^\s,`]+)`?/g)].map((x) => norm(x[1])).filter((x) => x && !/^none$/i.test(x) && x !== "-"));
    const considered = field("Decisions considered");
    const domainCheck = field("Domain check");
    entries.set(n, {
      n,
      status: field("Status")?.toLowerCase().replace(/[`*]/g, "") ?? null,
      reason: field("Reason"),
      files: split(field("Files changed")),
      considered: considered === null ? null : [...considered.matchAll(/D-\d{3}/g)].map((x) => x[0]),
      domainCheck: domainCheck === null || /^none$/i.test(domainCheck) ? null : domainCheck,
    });
  });
  return { entries, problems };
}

// Paths a text names (repo-relative, with a known extension).
export const namedPaths = (text) => [...new Set([...text.matchAll(PATH_RE)].map((m) => norm(m[1])))];

function load(file) {
  if (!existsSync(file)) throw new Error(`no such file: ${file}`);
  const text = readFileSync(file, "utf8");
  const fm = parseFrontmatter(text);
  return { ...fm, ...splitSections(fm.body) };
}

// -> { mode, findings: [{ n, title, files, decisions: [{ id, title, files }], domains? }], decisions: [...] } for the
// files each finding names (plus the file's related_files for every finding unless it names its own) and the planned
// paths. In outputs mode each finding also lists, per file, its output domains (or `managed: true`).
export function triage(file, { root, plan = [] }) {
  const doc = load(file);
  const { decisions, error } = loadDecisions(root);
  if (error) throw new Error(error);
  const problems = [];
  const clean = (list, where) => list.flatMap((f) => {
    const c = canonPath(f);
    if (c.problem) problems.push(`${where}: ${c.problem}`);
    return c.path ? [c.path] : [];
  });
  const planned = clean(plan, "--plan");
  const related = clean(doc.front?.related_files ?? [], "related_files");
  const map = (files) => {
    const hits = new Map();
    for (const f of files) for (const d of govern(decisions, f)) {
      if (!hits.has(d.id)) hits.set(d.id, { id: d.id, title: d.title, files: [] });
      hits.get(d.id).files.push(f);
    }
    return [...hits.values()];
  };
  const findings = doc.findings.map((f) => {
    const named = clean(namedPaths(f.text), `Finding ${f.n}`);
    const files = [...new Set([...(named.length ? named : related), ...planned])];
    return { n: f.n, title: f.title, files, decisions: map(files) };
  });
  const mode = modeOf(doc.front);
  if (mode === "outputs") {
    // where each file is fixed: its output domains, or managed / outside every domain (then not this agent's to change)
    const scope = loadScope(root);
    for (const f of findings)
      f.domains = f.files.map((file) => {
        const o = outputDomainsOf(scope, file, doc.front.target);
        return { file, ...(o.managed ? { managed: true } : {}), domains: o.domains };
      });
  }
  const all = [...new Set(findings.flatMap((f) => f.files))];
  return { file: path.relative(root, path.resolve(file)).replaceAll("\\", "/"), mode, problems: [...new Set(problems)], findings, decisions: map(all) };
}

// -> { complete, mode, problems, counts }
export function check(file, { root }) {
  const problems = [];
  const doc = load(file);
  problems.push(...doc.problems);
  const { decisions, error } = loadDecisions(root);
  if (error) problems.push(error);
  const ids = new Set(decisions.map((d) => d.id));
  if (!doc.findings.length) problems.push("no '## Finding N' section found");
  const seen = new Set();
  for (const f of doc.findings) {
    if (seen.has(f.n)) problems.push(`Finding ${f.n} is defined twice`);
    seen.add(f.n);
  }
  const counts = { fixed: 0, deferred: 0, declined: 0 };
  const mode = modeOf(doc.front);
  if (doc.front?.target && !mode) problems.push(`frontmatter: target must be a product slug (feedback on a run's outputs) or '${FRAMEWORK_TARGET}' (feedback on the framework)`);
  if (doc.resolution === null) {
    problems.push("no '## Resolution (<date>)' section");
    return { complete: false, mode, problems, counts };
  }
  let scope = null;
  if (mode === "outputs")
    try {
      scope = loadScope(root);
    } catch (e) {
      problems.push(e.message);
    }
  const { entries, problems: rp } = parseResolution(doc.resolution);
  problems.push(...rp);
  for (const n of entries.keys()) if (!seen.has(n)) problems.push(`Resolution: Finding ${n} has no matching '## Finding ${n}'`);
  for (const f of doc.findings) {
    const e = entries.get(f.n);
    const at = `Finding ${f.n}`;
    if (!e) {
      problems.push(`${at}: no Resolution entry ('### Finding ${f.n}' under '## Resolution')`);
      continue;
    }
    if (!STATUSES.includes(e.status)) {
      problems.push(`${at}: Status must be one of ${STATUSES.join(" | ")}${e.status ? ` (got '${e.status}')` : ""}`);
      continue;
    }
    counts[e.status]++;
    if (!e.reason) problems.push(`${at}: Reason is missing`);
    if (e.files === null) problems.push(`${at}: 'Files changed' is missing (write 'none' when no file changed)`);
    if (e.considered === null) problems.push(`${at}: 'Decisions considered' is missing (write 'none' when no decision applies)`);
    for (const d of e.considered ?? []) if (!ids.has(d)) problems.push(`${at}: ${d} is not a recorded decision`);
    const files = [];
    for (const raw of e.files ?? []) {
      const c = canonPath(raw);
      if (c.problem) problems.push(`${at}: Files changed: ${c.problem}`);
      else if (c.path) files.push(c.path);
    }
    if (e.status !== "fixed" && files.length) problems.push(`${at}: a ${e.status} finding changed no file, but Files changed lists ${files.join(", ")}`);
    if (e.status === "deferred" && e.reason && /confirmation/i.test(e.reason)) {
      const m = /needs user confirmation \((D-\d{3})\)/i.exec(e.reason);
      if (!m) problems.push(`${at}: a deferral for a decision conflict reads 'Deferred - needs user confirmation (D-NNN)'`);
      else if (!ids.has(m[1])) problems.push(`${at}: ${m[1]} is not a recorded decision`);
      else if (!(e.considered ?? []).includes(m[1])) problems.push(`${at}: Decisions considered must name ${m[1]}`);
    }
    if (e.status === "fixed") {
      if (!files.length) problems.push(`${at}: a fixed finding must list the files it changed`);
      if (mode === "outputs" && scope) problems.push(...outputProblems(scope, e, files, doc.front.target, at));
      if (mode === "framework" && files.some(isScript)) {
        const tests = files.filter(isTest);
        if (!tests.length) problems.push(`${at}: changed ${files.filter(isScript).join(", ")} under scripts/ without a new or updated scripts/**/*.test.mjs in Files changed`);
        for (const t of tests) if (!existsSync(path.join(root, t))) problems.push(`${at}: test file ${t} does not exist`);
      }
      const named = new Set(e.considered ?? []);
      for (const file of files)
        for (const d of govern(decisions, file)) if (!named.has(d.id)) problems.push(`${at}: ${file} is governed by ${d.id} "${d.title}", which Decisions considered does not name`);
    }
  }
  return { complete: problems.length === 0, mode, problems: [...new Set(problems)], counts };
}

// Outputs mode (P-7), a fixed finding: the domain check it ran, every file in a named domain's writable set and no
// managed file, and changed test cases awaiting human re-approval.
function outputProblems(scope, e, files, product, at) {
  const problems = [];
  if (!e.domainCheck) {
    problems.push(`${at}: 'Domain check' is missing: the check of each domain it changed, e.g. \`node {fw}/scripts/ui-code.mjs check ${product} <module>\`, which exited 0`);
    return problems;
  }
  const named = namedChecks(e.domainCheck, product, at);
  problems.push(...named.problems);
  if (!named.domains.size && !named.problems.length) problems.push(`${at}: 'Domain check' names no \`<script>.mjs check ${product} ...\` command`);
  let cases = false;
  for (const file of files) {
    const o = outputDomainsOf(scope, file, product);
    if (o.managed) problems.push(`${at}: ${file} is a managed file (a script writes it); fix it through its domain's overlay or slots`);
    else if (!o.domains.length) problems.push(`${at}: ${file} is in no output domain of product '${product}' (${OUTPUT_AGENT} writes only the overlays and slots of config/permissions.yaml)`);
    else if (!o.domains.some((d) => named.domains.has(d)))
      problems.push(`${at}: ${file} is in the ${o.domains.join(" or ")} domain, whose check (${o.domains.map((d) => `${OUTPUT_DOMAINS[d].script}.mjs check`).join(" or ")}) Domain check does not name`);
    if (o.domains.some((d) => OUTPUT_DOMAINS[d].reapproval)) cases = true;
  }
  if (cases && !REAPPROVAL_RE.test(e.reason ?? "")) problems.push(`${at}: it changed test cases, so the Reason must say they await human re-approval ('awaits human re-approval'; only a human approves)`);
  return problems;
}

// -> { file, source, related, findings: [{ n, files }] } -- what the file concerns.
export function feedbackPaths(file, { root }) {
  const doc = load(file);
  return {
    file: path.relative(root, path.resolve(file)).replaceAll("\\", "/"),
    source: doc.front?.source_agent ?? null,
    related: doc.front?.related_files ?? [],
    findings: doc.findings.map((f) => ({ n: f.n, files: namedPaths(f.text) })),
  };
}
