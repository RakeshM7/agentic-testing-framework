// Feedback files (docs/conventions.md, Feedback contract): parsing, decision-aware triage and the Resolution check.
// Deterministic; never edits a file. The agent writes the Resolution, `check` verifies it.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { governing, loadDecisions } from "./decisions.mjs";

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
    entries.set(n, {
      n,
      status: field("Status")?.toLowerCase().replace(/[`*]/g, "") ?? null,
      reason: field("Reason"),
      files: split(field("Files changed")),
      considered: considered === null ? null : [...considered.matchAll(/D-\d{3}/g)].map((x) => x[0]),
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

// -> { findings: [{ n, title, files, decisions: [{ id, title, files }] }], decisions: [...] } for the files each
// finding names (plus the file's related_files for every finding unless it names its own) and the planned paths.
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
  const all = [...new Set(findings.flatMap((f) => f.files))];
  return { file: path.relative(root, path.resolve(file)).replaceAll("\\", "/"), problems: [...new Set(problems)], findings, decisions: map(all) };
}

// -> { complete, problems, counts }
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
  if (doc.resolution === null) {
    problems.push("no '## Resolution (<date>)' section");
    return { complete: false, problems, counts };
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
      if (files.some(isScript)) {
        const tests = files.filter(isTest);
        if (!tests.length) problems.push(`${at}: changed ${files.filter(isScript).join(", ")} under scripts/ without a new or updated scripts/**/*.test.mjs in Files changed`);
        for (const t of tests) if (!existsSync(path.join(root, t))) problems.push(`${at}: test file ${t} does not exist`);
      }
      const named = new Set(e.considered ?? []);
      for (const file of files)
        for (const d of govern(decisions, file)) if (!named.has(d.id)) problems.push(`${at}: ${file} is governed by ${d.id} "${d.title}", which Decisions considered does not name`);
    }
  }
  return { complete: problems.length === 0, problems: [...new Set(problems)], counts };
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
