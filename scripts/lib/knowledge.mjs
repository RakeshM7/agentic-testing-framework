// Product knowledge base: artifacts/<product>/knowledge/
//
//   overview.md  glossary.md  sources.md        product level (product pass, stage `knowledge`)
//   sources.json                                source registry -- script-owned, one ID per source product-wide
//   inputs.json                                 fingerprints of the inputs each part was generated from
//   modules/<m>/overview.md glossary.md notes.md sources.md   per module (stage `module-knowledge`)
//
// Rules enforced here (not in prompts):
//   - every source gets ONE product-wide ID (S1, S2, ...) via addSource(); the same location always maps to the same ID
//   - every content line of overview/glossary/notes cites at least one registered source as [S<n>]
//     (exception: lines under a "## Open points" heading -- things the sources do not confirm)
//   - sources.md files are rendered from the registry (product: all sources; module: the ones that module cites)
//   - module glossary terms are merged into the product glossary (Scope column = module slug)
//   - knowledge is reused unless its inputs changed (product references, requirement docs incl. local file content,
//     the module's own config entry and references)

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { withFileLock, writeAtomic } from "./csv.mjs";

export const SOURCE_TYPES = ["vendor-doc", "knowledge-base", "requirement", "web", "live-product"];
export const PRODUCT_GLOSSARY_HEADER = ["Term", "Definition", "Scope", "Sources"];
export const MODULE_GLOSSARY_HEADER = ["Term", "Definition", "Sources"];
const CITE_RE = /\[(S\d+)\]/g;
const OPEN_POINTS_RE = /^#{2,6}\s+open points\b/i;

export function knowledgePaths(productDir) {
  const dir = path.join(productDir, "knowledge");
  const mod = (m) => path.join(dir, "modules", m);
  return {
    dir,
    registry: path.join(dir, "sources.json"),
    inputs: path.join(dir, "inputs.json"),
    product: { overview: path.join(dir, "overview.md"), glossary: path.join(dir, "glossary.md"), sources: path.join(dir, "sources.md") },
    module: (m) => ({ dir: mod(m), overview: path.join(mod(m), "overview.md"), glossary: path.join(mod(m), "glossary.md"), notes: path.join(mod(m), "notes.md"), sources: path.join(mod(m), "sources.md") }),
  };
}

const readJson = (f, fallback) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback);
const writeJson = (f, data) => writeAtomic(f, JSON.stringify(data, null, 2) + "\n");
const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const nonEmpty = (f) => existsSync(f) && statSync(f).size > 0;

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

export function addSource(kp, { title, location, type, scope, runId, accessed = new Date().toISOString().slice(0, 10) }) {
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

export const citedIds = (text) => new Set([...text.matchAll(CITE_RE)].map((m) => m[1]));

function renderSources(entries) {
  const cell = (s) => String(s).replaceAll("|", "\\|");
  return [
    "| ID | Title | Location | Type | Accessed |",
    "|---|---|---|---|---|",
    ...entries.map((s) => `| ${s.id} | ${cell(s.title)} | ${cell(s.location)} | ${s.type} | ${s.accessed} |`),
    "",
  ].join("\n");
}

// Product sources.md = whole registry; module sources.md = the registry entries that module's files cite.
export function render(kp, module) {
  const reg = readRegistry(kp);
  const byId = new Map(reg.map((s) => [s.id, s]));
  writeAtomic(kp.product.sources, "# Sources\n\n" + renderSources(reg));
  if (!module) return { product: reg.length };
  const m = kp.module(module);
  const ids = new Set([m.overview, m.glossary, m.notes].filter(existsSync).flatMap((f) => [...citedIds(readFileSync(f, "utf8"))]));
  const subset = [...ids].map((id) => byId.get(id)).filter(Boolean).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  writeAtomic(m.sources, `# Sources -- ${module}\n\n` + renderSources(subset));
  return { product: reg.length, module: subset.length };
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
    const prod = parseTable(existsSync(kp.product.glossary) ? readFileSync(kp.product.glossary, "utf8") : "");
    const mod = parseTable(readFileSync(kp.module(module).glossary, "utf8"));
    if (mod.header.join("|") !== MODULE_GLOSSARY_HEADER.join("|")) throw new Error(`module glossary header must be: | ${MODULE_GLOSSARY_HEADER.join(" | ")} |`);
    const kept = prod.rows.filter((r) => r[2] !== module);
    const merged = [...kept, ...mod.rows.map(([t, d, s]) => [t, d, module, s])];
    const body = [`| ${PRODUCT_GLOSSARY_HEADER.join(" | ")} |`, `|${PRODUCT_GLOSSARY_HEADER.map(() => "---").join("|")}|`, ...merged.map((r) => `| ${r.join(" | ")} |`)];
    writeAtomic(kp.product.glossary, "# Glossary\n\n" + body.join("\n") + "\n");
    return { terms: merged.length, fromModule: mod.rows.length };
  });
}

// ---------- checks ----------

// Every content line must cite a registered source, except under "## Open points".
export function checkCited(file, registryIds) {
  const problems = [];
  const text = readFileSync(file, "utf8");
  let exempt = false;
  let fence = false;
  text.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("```")) return void (fence = !fence);
    if (fence || !t) return;
    if (/^#{1,6}\s/.test(t)) return void (exempt = OPEN_POINTS_RE.test(t));
    if (/^\|?\s*:?-{3,}/.test(t)) return; // table separator
    const ids = [...citedIds(t)];
    for (const id of ids) if (!registryIds.has(id)) problems.push(`line ${i + 1}: cites ${id}, which is not in sources.json`);
    if (!exempt && !ids.length && !isTableHeader(text, i)) problems.push(`line ${i + 1}: no source citation ([S<n>]): "${t.slice(0, 60)}"`);
  });
  return problems;
}

function isTableHeader(text, i) {
  const lines = text.split(/\r?\n/);
  return lines[i].trim().startsWith("|") && /^\|?\s*:?-{3,}/.test((lines[i + 1] ?? "").trim());
}

export function checkGlossary(file, header) {
  const { header: h, rows } = parseTable(readFileSync(file, "utf8"));
  const problems = [];
  if (h.join("|") !== header.join("|")) problems.push(`glossary header must be: | ${header.join(" | ")} |`);
  rows.forEach((r, i) => {
    if (r.length !== header.length) problems.push(`glossary row ${i + 1}: expected ${header.length} cells`);
    else if (!r[0] || !r[1]) problems.push(`glossary row ${i + 1}: Term and Definition are required`);
  });
  return problems;
}

export function checkProduct(kp) {
  const ids = new Set(readRegistry(kp).map((s) => s.id));
  const problems = [];
  if (!ids.size) problems.push("sources.json: no sources registered");
  for (const [name, f] of Object.entries(kp.product)) if (!nonEmpty(f)) problems.push(`${name}.md: missing or empty`);
  if (problems.length) return problems;
  for (const e of checkCited(kp.product.overview, ids)) problems.push(`overview.md ${e}`);
  for (const e of checkCited(kp.product.glossary, ids)) problems.push(`glossary.md ${e}`);
  for (const e of checkGlossary(kp.product.glossary, PRODUCT_GLOSSARY_HEADER)) problems.push(`glossary.md: ${e}`);
  return problems;
}

export function checkModule(kp, module) {
  const ids = new Set(readRegistry(kp).map((s) => s.id));
  const m = kp.module(module);
  const problems = [];
  for (const name of ["overview", "glossary", "notes", "sources"]) if (!nonEmpty(m[name])) problems.push(`modules/${module}/${name}.md: missing or empty`);
  if (problems.length) return problems;
  for (const name of ["overview", "glossary", "notes"]) for (const e of checkCited(m[name], ids)) problems.push(`modules/${module}/${name}.md ${e}`);
  for (const e of checkGlossary(m.glossary, MODULE_GLOSSARY_HEADER)) problems.push(`modules/${module}/glossary.md: ${e}`);
  const prod = parseTable(existsSync(kp.product.glossary) ? readFileSync(kp.product.glossary, "utf8") : "");
  const merged = new Set(prod.rows.filter((r) => r[2] === module).map((r) => r[0]));
  const missing = parseTable(readFileSync(m.glossary, "utf8")).rows.filter((r) => !merged.has(r[0]));
  if (missing.length) problems.push(`modules/${module}/glossary.md: ${missing.length} term(s) not merged into the product glossary (run merge-glossary)`);
  const cited = [m.overview, m.glossary, m.notes].flatMap((f) => [...citedIds(readFileSync(f, "utf8"))]);
  const listed = citedIds(readFileSync(m.sources, "utf8").replace(/\| (S\d+) \|/g, "[$1]"));
  if (cited.some((id) => !listed.has(id))) problems.push(`modules/${module}/sources.md is stale (run render --module ${module})`);
  return problems;
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
  const productOk = rec.product === fp.product && !checkProduct(kp).length;
  const modules = {};
  for (const [m, h] of Object.entries(fp.modules)) modules[m] = productOk && rec.modules?.[m] === h && !checkModule(kp, m).length ? "reuse" : "generate";
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
