// A module's test cases: artifacts/<product>/modules/<m>/testcases/ (docs/agent-handoffs.md §3). Script-built
// (docs/conventions.md "Script-built agents", variant A): the script enumerates the coverage items, the testcase-writer
// authors the structured cases, the script gives them stable ids and renders every file downstream reads.
//
// Agent-owned:
//   cases.json              the cases overlay (schema testcases-overlay): structured cases, each linked to the coverage
//                           items it covers and the evidence it relies on, plus cited exclusions
// Human-owned:
//   approval.csv            rendered by build; a human fills Approved (yes / no / changes) and Comment in Excel or an
//                           editor, then runs `testcases.mjs approve`. No agent may run approve or write the sheet.
// Script-owned (never hand-edited):
//   registry/items.json     CI-<m>-<n> per coverage item key (lib/registry.mjs)
//   registry/cases.json     TC-<m>-<n> per case key (lib/registry.mjs)
//   coverage.json           the coverage ledger, the resolved cases, build problems and, after a passing check, the
//                           verified stamp (schema testcases-coverage)
//   <m>-testcases.<ext>     ext by testcases.output_format: gherkin -> .feature, csv/testrail -> .csv, markdown-table -> .md
//   testcases-summary.md    with the line "Total test cases: N" equal to the number of cases in the file
//   approvals.json          the human approvals `approve` recorded, each pinned to the case's content hash
//   approval-findings.md    the `no` / `changes` rows as findings for the writer (docs/agent-handoffs.md §6 format)
//
// Coverage items (ISO/IEC/IEEE 29119-4 techniques), each keyed by source + technique + target:
//   ep / required / bva / enum / boolean   per input field of explore/interactions.json (D-052 field constraints)
//   state-transition                        per transition of explore/model.json
//   flow                                    per explore/flows/*.md
//   rule / decision-table                   per rule fact of knowledge/modules/<m>/rule-facts.json (D-051)
//   clarification                           per answered clarifications.csv row
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { citationProblem } from "./citations.mjs";
import { csvPath, evidenceDir, isAnswered, isAuthoritative, readRows } from "./clarifications.mjs";
import { createLedger } from "./coverage.mjs";
import { detectDelimiter, parseCsv, serializeCsv, withFileLock, writeAtomic } from "./csv.mjs";
import { explorePaths } from "./explore.mjs";
import { knowledgePaths } from "./knowledge.mjs";
import { assignIds } from "./registry.mjs";
import { sha256, stampVerified, unverifiedReason } from "./verified.mjs";

export const EXT = { gherkin: "feature", csv: "csv", testrail: "csv", "markdown-table": "md" };
export const FORMATS = Object.keys(EXT);
export const PRIORITIES = ["p1", "p2", "p3"];
export const TYPES = ["functional", "negative", "boundary", "security", "visual", "api"];
export const DEFAULT_MAX_CASES = 200;
// Technique order breaks priority ties when the budget ranks the items.
export const TECHNIQUES = ["clarification", "flow", "decision-table", "rule", "state-transition", "required", "ep", "bva", "boolean", "enum"];
const PRIORITY_OF = { clarification: "p1", flow: "p1", "decision-table": "p1", rule: "p1", "state-transition": "p2", required: "p2", ep: "p2", bva: "p2", boolean: "p2", enum: "p3" };
export const EXCLUDE_REASONS = ["not-testable", "not-applicable", "out-of-scope", "duplicate-of"];
export const EVIDENCE_KINDS = ["clarification", "knowledge", "observation"];
export const APPROVAL_COLUMNS = ["TC ID", "Title", "Key steps", "Expected", "Priority", "Approved", "Comment", "Rendered in run", "Version"];
const TOTAL_RE = /^Total test cases:\s*(\d+)\s*$/im;
const CLAR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/;
// Input-bearing roles of explore/interactions.json; a script-derived duplicate or a control outside the module is not a
// field of this module (the canonical item covers a duplicate).
const FIELD_ROLES = ["textbox", "searchbox", "spinbutton", "slider", "combobox", "listbox", "checkbox", "radio", "switch"];
const NOT_FIELDS = ["duplicate-of", "out-of-module", "external", "logout"];
const WEAK_EVIDENCE = ["agent-capture", "stale"];

const readJson = (f, fallback) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : fallback);
const writeJson = (f, data) => {
  mkdirSync(path.dirname(f), { recursive: true });
  writeAtomic(f, JSON.stringify(data, null, 2) + "\n");
};
const sha256Text = (s) => createHash("sha256").update(s).digest("hex");
const sha1 = (s) => createHash("sha1").update(s).digest("hex");
const uniq = (xs) => [...new Set(xs)];
const idNum = (id) => Number(String(id).split("-").at(-1));
const byNum = (a, b) => idNum(a) - idNum(b);
const one = (s) => String(s ?? "").replace(/\s*\r?\n\s*/g, " ").trim();
const clip = (s, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
const rel = (from, f) => path.relative(from, f).replaceAll("\\", "/");

export const testcasesFile = (moduleDir, module, format) => path.join(moduleDir, "testcases", `${module}-testcases.${EXT[format]}`);

export function testcasePaths(productDir, module) {
  const moduleDir = path.join(productDir, "modules", module);
  const dir = path.join(moduleDir, "testcases");
  return {
    moduleDir,
    dir,
    overlay: path.join(dir, "cases.json"),
    coverage: path.join(dir, "coverage.json"),
    registry: { items: path.join(dir, "registry", "items.json"), cases: path.join(dir, "registry", "cases.json") },
    summary: path.join(dir, "testcases-summary.md"),
    approvalCsv: path.join(dir, "approval.csv"),
    approvals: path.join(dir, "approvals.json"),
    approvalFindings: path.join(dir, "approval-findings.md"),
    file: (format) => testcasesFile(moduleDir, module, format),
  };
}

// ctx for every command: {root, product, module, moduleName, runId, cfg, format, maxCases, productDir, tp, xp, kp}
export function testcaseContext({ root, product, module, run, cfg, productDir }) {
  return {
    root, product, module, productDir, cfg,
    runId: run?.runId ?? null,
    moduleName: cfg.modules?.find((m) => m.slug === module)?.name ?? module,
    format: cfg.testcases?.output_format ?? "gherkin",
    maxCases: cfg.testcases?.max_cases ?? DEFAULT_MAX_CASES,
    tp: testcasePaths(productDir, module),
    xp: explorePaths(productDir, module),
    kp: knowledgePaths(productDir),
  };
}

// ---------- the parse contract (downstream: gates, api-plan, report) ----------

const yes = (v) => /^(yes|y|true|x|1)$/i.test(String(v ?? "").trim());

// A case: {id, line, priority, type, clarifications[], mutates, assumption, api, visual}.
function fromTags(tags, line) {
  const t = tags.map((s) => s.replace(/^@/, ""));
  return {
    id: t.find((s) => /^TC-/.test(s)) ?? null,
    line,
    priority: t.find((s) => PRIORITIES.includes(s)) ?? null,
    type: t.find((s) => TYPES.includes(s)) ?? null,
    clarifications: t.filter((s) => CLAR_RE.test(s)),
    mutates: t.includes("mutates"),
    assumption: t.includes("assumption"),
    api: t.includes("api"),
    visual: t.includes("visual"),
  };
}

function fromColumns(get, line) {
  const type = get("type").toLowerCase();
  const tags = get("tags").toLowerCase().split(/[\s,;]+/).map((s) => s.replace(/^@/, ""));
  return {
    id: get("id") || null,
    line,
    priority: PRIORITIES.includes(get("priority").toLowerCase()) ? get("priority").toLowerCase() : null,
    type: TYPES.includes(type) ? type : null,
    clarifications: get("clarifications").split(/[\s,;]+/).map((s) => s.replace(/^@/, "")).filter((s) => CLAR_RE.test(s)),
    mutates: yes(get("mutates")) || tags.includes("mutates"),
    assumption: yes(get("assumption")) || tags.includes("assumption"),
    api: type === "api" || tags.includes("api"),
    visual: type === "visual" || tags.includes("visual"),
  };
}

function table(header, rows) {
  const idx = Object.fromEntries(header.map((h, i) => [String(h).trim().toLowerCase(), i]));
  return rows.map(({ cells, line }) => fromColumns((k) => String(cells[idx[k]] ?? "").trim(), line));
}

// Gherkin: tags on the lines before each Scenario. CSV/TestRail: one row per case by column name, blank rows skipped.
// Markdown: every table whose header has an ID column (not only the first), blank rows skipped.
export function parseCases(file, format) {
  const text = readFileSync(file, "utf8");
  if (format === "gherkin") {
    const cases = [];
    let tags = [];
    text.split(/\r?\n/).forEach((raw, i) => {
      const l = raw.trim();
      if (l.startsWith("@")) tags.push(...l.split(/\s+/).filter((s) => s.startsWith("@")));
      else if (/^Scenario( Outline)?:/.test(l)) {
        cases.push(fromTags(tags, i + 1));
        tags = [];
      } else if (l && !l.startsWith("#")) tags = [];
    });
    return cases;
  }
  const blank = (cells) => !cells.some((c) => String(c).trim());
  if (format === "csv" || format === "testrail") {
    const [header = [], ...rows] = parseCsv(text);
    return table(header, rows.map((cells, i) => ({ cells, line: i + 2 })).filter((r) => !blank(r.cells)));
  }
  const lines = text.split(/\r?\n/);
  const split = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
  const isTable = (l) => l.trim().startsWith("|");
  const isSep = (l) => /^\|?\s*:?-{3,}/.test(l.trim());
  const out = [];
  for (let h = 0; h < lines.length; h++) {
    if (!isTable(lines[h]) || !isSep(lines[h + 1] ?? "") || (h > 0 && isTable(lines[h - 1]))) continue;
    const header = split(lines[h]);
    let i = h + 2;
    const rows = [];
    for (; i < lines.length && isTable(lines[i]); i++) rows.push({ cells: split(lines[i]), line: i + 1 });
    if (header.some((c) => c.toLowerCase() === "id")) out.push(...table(header, rows.filter((r) => !blank(r.cells))));
    h = i - 1;
  }
  return out;
}

// One count for every reader: exactly the cases parseCases returns.
export const countCases = (file, format) => parseCases(file, format).length;

export function checkTestcases(summaryFile, { module, testcasesFormat = "gherkin" }) {
  const file = testcasesFile(path.dirname(path.dirname(summaryFile)), module, testcasesFormat);
  if (!existsSync(file)) return [`${path.basename(file)} is missing (format ${testcasesFormat})`];
  const m = TOTAL_RE.exec(readFileSync(summaryFile, "utf8"));
  if (!m) return ['summary needs a line "Total test cases: N"'];
  const n = countCases(file, testcasesFormat);
  if (!n) return [`${path.basename(file)} contains no test cases`];
  return Number(m[1]) === n ? [] : [`summary says ${m[1]} test cases but ${path.basename(file)} has ${n}`];
}

// ---------- inputs ----------

const flowFiles = (xp) => (existsSync(xp.flows) ? readdirSync(xp.flows).filter((f) => f.endsWith(".md")).sort() : []);
const flowsDigest = (xp) => sha256Text(flowFiles(xp).map((f) => `${f}\n${readFileSync(path.join(xp.flows, f), "utf8")}`).join("\n\u0000"));
const rowsDigest = (rows) => sha256Text(JSON.stringify(rows.map((r) => [r.id.trim(), r.answer, r.answerStatus])));
const configDigest = (ctx) => sha256Text(JSON.stringify({ format: ctx.format, maxCases: ctx.maxCases, name: ctx.moduleName }));
// G2 field constraints: interactions.json entries carry their frontier item id (D-052). An older exploration has none.
const isG2Interactions = (x) => Array.isArray(x) && x.every((e) => /^FR-/.test(e?.id ?? ""));

export function readInputs(ctx) {
  const { xp, kp, module, productDir } = ctx;
  const flows = flowFiles(xp).map((f) => {
    const title = /^#\s+(.+)$/m.exec(readFileSync(path.join(xp.flows, f), "utf8"))?.[1]?.trim();
    return { file: f, title: title || f.replace(/\.md$/, "") };
  });
  return {
    model: readJson(xp.model, null),
    interactions: readJson(xp.interactions, null),
    ruleFacts: readJson(kp.module(module).ruleFacts, null),
    openPoints: readJson(kp.module(module).openPoints, null),
    flows,
    rows: readRows(csvPath(productDir, module)),
  };
}

// ---------- coverage items ----------

const INVALID_TARGET = /^(missing$|invalid:|bva:below-min$|bva:above-max$|enum:outside$)/;
const fieldName = (s) => one(s).replace(/\s*\((required|mandatory)\)\s*$/i, "").replace(/\s*\*\s*$/, "").trim() || "(unnamed)";

// Equivalence partitions and boundary values per input field (one field = page + role + name, merged over its states).
export function fieldItems(interactions) {
  const groups = new Map();
  for (const i of interactions ?? []) {
    if (!FIELD_ROLES.includes(i.role) || NOT_FIELDS.includes(i.reason)) continue;
    const name = fieldName(i.name);
    const gk = `${i.page ?? "-"}|${i.role}|${name.toLowerCase()}`;
    const g = groups.get(gk) ?? { page: i.page ?? null, role: i.role, name, fr: [], states: [], required: false, options: [], validation: [] };
    g.fr.push(i.id);
    if (i.state) g.states.push(i.state);
    if (i.required) g.required = true;
    for (const o of i.options ?? []) if (String(o).trim() && !g.options.includes(o)) g.options.push(o);
    for (const v of i.validation ?? []) if (!g.validation.includes(v)) g.validation.push(v);
    for (const c of ["inputType", "pattern", "maxlength", "minlength", "min", "max"]) if (i[c] !== undefined && g[c] === undefined) g[c] = i[c];
    groups.set(gk, g);
  }
  const out = [];
  for (const gk of [...groups.keys()].sort()) {
    const g = groups.get(gk);
    const constraints = Object.fromEntries(["required", "inputType", "pattern", "maxlength", "minlength", "min", "max"].filter((c) => g[c] !== undefined && g[c] !== false).map((c) => [c, g[c]]));
    if (g.options.length) constraints.options = g.options;
    if (g.validation.length) constraints.validation = g.validation;
    const field = { page: g.page, role: g.role, name: g.name, fr: uniq(g.fr).sort(byNum), states: uniq(g.states).sort(byNum), constraints };
    const subject = `${g.page ?? "?"}: ${g.role} "${g.name}"`;
    // invalid: an invalid partition or an out-of-range boundary (a case tests one at a time: the single-fault rule)
    const add = (technique, target, label) => out.push({ key: `field|${gk}|${target}`, technique, source: "interactions", subject, label: `${g.name}: ${label}`, field, ...(INVALID_TARGET.test(target) ? { invalid: true } : {}) });
    if (["checkbox", "switch"].includes(g.role)) {
      add("boolean", "checked", "checked");
      add("boolean", "unchecked", "unchecked");
      continue;
    }
    if (g.role === "radio") {
      add("ep", "valid", "selected");
      continue;
    }
    if (g.options.length) for (const o of g.options) add("enum", `enum:${o.toLowerCase()}`, `the option "${o}"`);
    else add("ep", "valid", "a valid value");
    if (g.options.length) add("enum", "enum:outside", "a value outside its options");
    if (g.required) add("required", "missing", "left empty (required)");
    if (g.pattern) add("ep", "invalid:pattern", `a value that breaks the pattern ${g.pattern}`);
    if (g.inputType === "number") add("ep", "invalid:not-a-number", "a value that is not a number");
    for (const v of g.validation) add("ep", `invalid:${slug(v)}`, `the input that shows "${v}"`);
    const lo = g.minlength ?? g.min;
    const hi = g.maxlength ?? g.max;
    const unit = g.maxlength !== undefined || g.minlength !== undefined ? " characters" : "";
    if (Number.isFinite(lo)) {
      add("bva", "bva:min", `${lo}${unit} (the minimum)`);
      add("bva", "bva:below-min", `${lo - 1}${unit} (just below the minimum)`);
    }
    if (Number.isFinite(hi)) {
      add("bva", "bva:max", `${hi}${unit} (the maximum)`);
      add("bva", "bva:above-max", `${hi + 1}${unit} (just above the maximum)`);
    }
  }
  return out;
}

export function transitionItems(model) {
  const seen = new Set();
  const out = [];
  for (const t of model?.transitions ?? []) {
    const key = `transition|${t.from}|${t.actions.join(" > ")}|${t.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, technique: "state-transition", source: "model", subject: `${t.from} -> ${t.to}`, label: `${t.from} → ${t.to} by ${t.actions.join(", then ") || "(no action)"}`, transition: { from: t.from, to: t.to, actions: t.actions } });
  }
  return out;
}

export const flowItems = (flows) => flows.map((f) => ({ key: `flow|${f.file.replace(/\.md$/, "")}`, technique: "flow", source: "flows", subject: `flows/${f.file}`, label: f.title }));

// The text of a rule fact without its bullet, markdown emphasis and citations ([S1], [S1 "quote"]).
export const factText = (t) => one(t).replace(/^[-*]\s+/, "").replace(/\[S\d+(?:\s+"[^"]*")?\]/g, "").replace(/\*\*|__/g, "").replace(/\s+([.,;:])/g, "$1").replace(/\s+/g, " ").trim();
const COND_RE = /\b(only if|only when|if|when|whenever|unless|while|as long as|provided that)\b/i;

// The conditions of a rule: the clause after its first condition word, split on and/or (and list commas).
// "If A and B, X" / "X only when A or B" -> {conditions: [A, B], connective: and | or | mixed}
export function conditionsOf(text) {
  const t = factText(text).replace(/\.$/, "");
  const m = COND_RE.exec(t);
  if (!m) return { conditions: [], connective: null };
  let clause = t.slice(m.index + m[0].length);
  // a leading condition ("If A, B and C, X") ends at its last comma; a trailing one ("X only when A or B") runs to the end
  const cut = clause.lastIndexOf(",");
  if (m.index === 0 && cut > 0) clause = clause.slice(0, cut);
  clause = clause.split(/\bthen\b|;/i)[0].replace(/^\s*(both|either)\s+/i, "");
  const seps = [...clause.matchAll(/\s+(and|or)\s+/gi)].map((x) => x[1].toLowerCase());
  const conditions = clause.split(/\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or)\s+/i).map((c) => c.trim()).filter(Boolean);
  if (conditions.length < 2) return { conditions, connective: null };
  const connective = seps.length && seps.every((s) => s === "or") ? "or" : seps.every((s) => s === "and") ? "and" : "mixed"; // list commas join like the words around them
  return { conditions, connective };
}

// A collapsed decision table (the MC/DC-style reduction): N + 1 rows instead of 2^N. For AND rules: all conditions
// true (the rule applies), then each condition false alone (it does not). For OR rules: all false (it does not apply),
// then each condition true alone (it does). Each row shows one condition changing the outcome on its own. A rule that
// mixes and with or can't be grouped reliably from its wording, so it degrades to one item per condition (outcome
// null: the case states, from the evidence, what that condition does).
export function decisionTable(conditions, connective) {
  const vals = (f) => Object.fromEntries(conditions.map((c, i) => [c, f(i)]));
  if (connective === "mixed")
    return conditions.map((c) => ({ key: `cond:${slug(c)}`, values: { [c]: true }, outcome: null, label: `the condition "${c}" (a rule mixing and/or: one item per condition)` }));
  if (connective === "or")
    return [
      { key: "all-false", values: vals(() => false), outcome: false, label: "no condition holds -> the rule does not apply" },
      ...conditions.map((c, i) => ({ key: `only:${slug(c)}`, values: vals((j) => j === i), outcome: true, label: `only "${c}" holds -> the rule applies` })),
    ];
  return [
    { key: "all-true", values: vals(() => true), outcome: true, label: "every condition holds -> the rule applies" },
    ...conditions.map((c, i) => ({ key: `not:${slug(c)}`, values: vals((j) => j !== i), outcome: false, label: `"${c}" does not hold (the others do) -> the rule does not apply` })),
  ];
}

const factKey = (text) => sha1(factText(text).toLowerCase()).slice(0, 10);

export function ruleItems(facts) {
  const out = [];
  for (const f of facts ?? []) {
    const text = factText(f.text);
    const fact = { file: f.file, line: f.line, category: f.category, evidence: f.evidence, text };
    const base = { source: "rule-facts", subject: `knowledge/${f.file}:${f.line}`, fact };
    const { conditions, connective } = conditionsOf(text);
    if (conditions.length < 2) out.push({ ...base, key: `rule|${factKey(text)}`, technique: "rule", label: clip(text) });
    else for (const row of decisionTable(conditions, connective)) out.push({ ...base, key: `rule|${factKey(text)}|${row.key}`, technique: "decision-table", label: `${clip(text, 120)} -- ${row.label}`, row: { values: row.values, outcome: row.outcome, connective } });
  }
  return out;
}

export const clarificationItems = (rows) =>
  rows.filter(isAnswered).map((r) => ({ key: `clarification|${r.id.trim()}`, technique: "clarification", source: "clarifications", subject: r.id.trim(), label: clip(one(r.question)), clarification: { id: r.id.trim(), answerStatus: r.answerStatus } }));

// Every coverage item of the module, without ids. G2 inputs that are missing degrade the enumeration: the module then
// gets items per flow, clarification (and rule fact), and `degraded` says what is missing.
export function enumerateItems(inputs) {
  const degraded = [];
  const items = [];
  if (isG2Interactions(inputs.interactions)) items.push(...fieldItems(inputs.interactions));
  else degraded.push(inputs.interactions ? "explore/interactions.json has no field constraints (an older exploration): no EP/BVA items" : "explore/interactions.json is missing: no EP/BVA items");
  if (inputs.model?.transitions) items.push(...transitionItems(inputs.model));
  else degraded.push("explore/model.json is missing (an older exploration): no state-transition items");
  items.push(...flowItems(inputs.flows));
  if (inputs.ruleFacts) items.push(...ruleItems(inputs.ruleFacts.facts));
  else degraded.push("knowledge rule-facts.json is missing: no rule or decision-table items");
  items.push(...clarificationItems(inputs.rows));
  for (const i of items) i.priority = PRIORITY_OF[i.technique];
  return { items, degraded };
}

// Enumerate and give every item its stable CI id. -> {items (with id), degraded}
export function assignItemIds(ctx, inputs = readInputs(ctx)) {
  const { items, degraded } = enumerateItems(inputs);
  const reg = assignIds(ctx.tp.registry.items, uniq(items.map((i) => i.key)), { module: ctx.module, runId: ctx.runId, prefix: "CI", field: "items" });
  const seen = new Set();
  const out = [];
  for (const i of items) {
    if (seen.has(i.key)) continue; // two fields with the same page, role and name are one item
    seen.add(i.key);
    out.push({ id: reg.items[i.key].id, ...i });
  }
  return { items: out.sort((a, b) => byNum(a.id, b.id)), degraded };
}

// ---------- the overlay ----------

const QUOTE_RE = /"([^"]+)"|“([^”]+)”/g;
const normQuote = (s) => String(s).replace(/\\"/g, '"').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
const EMAIL_RE = /[\w.+-]+@((?:[\w-]+\.)+[\w-]+)/g;
const SYNTHETIC_DOMAIN = /(^|\.)example\.(com|org|net)$|\.(test|example|invalid|localhost)$/i;
const STEP_TITLE = /^(given|when|then|and|but|verify|check|test|click)\b/i;
const UI_MECHANICS = /\b(click(s|ed)?|double-click(s)?|tap(s|ped)?|press(es)?|scroll(s)?|hover(s)?)\b/i;

function readText(file) {
  try {
    return statSync(file).isFile() ? readFileSync(file, "utf8") : "";
  } catch {
    return "";
  }
}

// The text a citation stands for, for the verbatim-quote check.
function evidenceText(cite, ctx, rowsById) {
  const [kind, ...rest] = String(cite).split(":");
  const ref = rest.join(":");
  const file = ref.split("#")[0];
  if (kind === "clarification") {
    const row = rowsById.get(ref);
    if (!row) return "";
    const dir = evidenceDir(csvPath(ctx.productDir, ctx.module), ref);
    const files = existsSync(dir) ? readdirSync(dir).map((f) => path.join(dir, f)) : [];
    return [row.answer, row.notes, ...files.map(readText)].join("\n");
  }
  if (kind === "observation") return readText(path.join(ctx.tp.moduleDir, file));
  if (kind === "knowledge") return readText(path.join(ctx.kp.dir, file));
  return "";
}

// The items a case really covers: existing items only, and an answered clarification only when the case cites
// `clarification:<id>` for it (an item can't be ticked off without relying on its answer).
export function effectiveCovers(c, itemsById) {
  const cited = new Set((c.evidence ?? []).filter((e) => e.startsWith("clarification:")).map((e) => e.slice("clarification:".length)));
  return uniq(c.covers ?? []).filter((id) => {
    const i = itemsById.get(id);
    return i && (i.technique !== "clarification" || cited.has(i.clarification.id));
  });
}

// The clarification rows a case relies on: its clarification citations (which include every clarification item it covers).
const clarificationsOfCase = (c) => uniq((c.evidence ?? []).filter((e) => e.startsWith("clarification:")).map((e) => e.slice("clarification:".length))).sort(byNum);

// A cited knowledge:/observation: file must be a real file inside its root, named by a plain relative path (no `.`,
// `..`, empty or absolute segments, never a directory); a #L<n> fragment must name an existing line.
function citedFileProblem(e, ctx) {
  const [kind, ...rest] = String(e).split(":");
  const [file, frag = ""] = rest.join(":").split("#");
  const root = kind === "knowledge" ? ctx.kp.dir : ctx.tp.moduleDir;
  const segs = file.replaceAll("\\", "/").split("/");
  if (!file || path.isAbsolute(file) || /^[a-z]:/i.test(file) || segs.some((s) => s === "" || s === "." || s === ".."))
    return `'${e}': cite a file by its plain relative path under ${kind === "knowledge" ? "knowledge/" : "the module"}`;
  const abs = path.join(root, file);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return `'${e}': no such file`;
  }
  if (!st.isFile()) return `'${e}': not a file`;
  const line = /^L(\d+)$/.exec(frag);
  if (line && (Number(line[1]) < 1 || Number(line[1]) > readFileSync(abs, "utf8").split(/\r?\n/).length)) return `'${e}': ${file} has no line ${line[1]}`;
  return null;
}

// -> null when a citation of a case's evidence or an exclusion holds, else why not.
function citeProblem(e, ctx, { rows, kqIds, answered = false }) {
  const [kind, ...rest] = String(e).split(":");
  const ref = rest.join(":");
  if (!EVIDENCE_KINDS.includes(kind)) return `'${e}' must be clarification:<id>, knowledge:<path> or observation:<path>`;
  if (kind === "clarification") {
    if (answered) return citationProblem(e, { rows, cases: new Set(), productDir: ctx.productDir, moduleDir: ctx.tp.moduleDir });
    return rows.some((r) => r.id.trim() === ref) ? null : `'${e}': no such row in clarifications.csv`;
  }
  const p = citedFileProblem(e, ctx) ?? citationProblem(e, { rows, cases: new Set(), productDir: ctx.productDir, moduleDir: ctx.tp.moduleDir });
  if (p) return p;
  const frag = ref.split("#")[1] ?? "";
  return kind === "knowledge" && /^KQ-/.test(frag) && !kqIds.has(frag) ? `'${e}': no active open point ${frag}` : null;
}

// What one case may cover (one behavior per case): at most MAX_COVERS items; at most one value per input field; at
// most one invalid partition or out-of-range boundary overall (the single-fault rule of EP/BVA); at most one row per
// decision table. A case covering everything is the loophole this closes.
export const MAX_COVERS = 6;
function coverProblems(items) {
  const out = [];
  if (items.length > MAX_COVERS) out.push(`covers ${items.length} coverage items; a case covers at most ${MAX_COVERS} (one behavior per case)`);
  const invalid = items.filter((i) => i.invalid);
  if (invalid.length > 1) out.push(`covers ${invalid.length} invalid partitions (${invalid.map((i) => i.id).join(", ")}); a case tests one invalid value at a time`);
  const groups = (pred) => {
    const m = new Map();
    for (const i of items.filter(pred)) m.set(i.subject, [...(m.get(i.subject) ?? []), i.id]);
    return [...m].filter(([, ids]) => ids.length > 1);
  };
  for (const [subject, ids] of groups((i) => i.source === "interactions")) out.push(`covers several values of the field ${subject} (${ids.join(", ")}); one value per field per case`);
  for (const [subject, ids] of groups((i) => i.technique === "decision-table")) out.push(`covers several rows of the decision table of ${subject} (${ids.join(", ")}); one combination per case`);
  return out;
}

// An expected result must name something a tester can observe. Without a quoted message or a value it needs at least
// MIN_EXPECTED_WORDS words, no vague phrase ("works", "appropriately", "as expected", "handled" ...), and an anchor: a
// state id, a state or status word (shown, disabled, saved, refused ...), or the name of a field or element that the
// case covers or its evidence shows. names: those names.
const MIN_EXPECTED_WORDS = 4;
const VAGUE = /\b(works?|working|behaves?|behaving|appropriate(ly)?|correct(ly)?|proper(ly)?|successful(ly)?|as (expected|designed|intended)|handled?|handles|is (ok|okay|fine|valid)|no (errors?|issues?|problems?)|nothing (bad|wrong))\b/i;
const STATUS_WORDS = /\b(ST-[a-z0-9-]+|shown|shows|displayed|displays|visible|hidden|appears?|disappears?|disabled|enabled|selected|checked|unchecked|empty|listed|lists|saved|created|deleted|removed|updated|archived|restored|refused|rejected|accepted|blocked|redirect(s|ed)?|navigates?|opens?|closes?|closed|stays?|remains?|status|error|warning|message|count|total|sorted|filtered|highlighted|required|invalid|valid|unchanged|focus(ed)?)\b/i;
function expectedProblem(text, names) {
  const t = one(text);
  if (/"[^"]+"|“[^”]+”|\d/.test(t)) return null;
  if (t.split(/\s+/).filter(Boolean).length < MIN_EXPECTED_WORDS) return `the expected result '${t}' is too short to observe (at least ${MIN_EXPECTED_WORDS} words, a quoted message or a value)`;
  if (VAGUE.test(t)) return `the expected result '${t}' is vague (${VAGUE.exec(t)[0]}); say what the product shows or stores (quote it, or give the value)`;
  const lower = t.toLowerCase();
  if (STATUS_WORDS.test(t) || names.some((n) => n.length >= 3 && lower.includes(n.toLowerCase()))) return null;
  return `the expected result '${t}' has no observable anchor: a quoted message, a value, a field or element the evidence shows, or a state or status`;
}
// Field and element names a case may anchor its expected result on: its covered fields', and every "name" its evidence quotes.
const anchorNames = (items, evidenceTexts) => uniq([...items.map((i) => i.field?.name).filter(Boolean), ...evidenceTexts.flatMap((t) => [...t.matchAll(/"([^"\n]{3,60})"/g)].map((m) => m[1].trim()))]);

// What makes two items the same check, so one may be a duplicate of the other: the same technique and source, and the
// same target once the place it was found is taken out -- a field's role, name and partition (from any page), or a
// transition's actions (from any state). Flows, rule facts and clarifications are never duplicates. -> boolean
function sameTarget(a, b) {
  if (!a || !b || a.technique !== b.technique || a.source !== b.source) return false;
  const target = (i) => (i.source === "interactions" ? i.key.split("|").slice(2).join("|").toLowerCase() : i.source === "model" ? i.transition.actions.join(" > ").toLowerCase() : null);
  return target(a) !== null && target(a) === target(b);
}

// The problems of one exclusion. mapped: the items some case covers.
function exclusionProblems(x, ctx, { itemsById, mapped, excludedIds, rows, kqIds }) {
  const out = [];
  if (!itemsById.has(x.item)) out.push("not a coverage item of this build");
  if (!EXCLUDE_REASONS.includes(x.reason)) out.push(`reason must be one of [${EXCLUDE_REASONS.join(", ")}]`);
  if (!String(x.detail ?? "").trim()) out.push("needs a detail");
  if (!x.citation) out.push("an exclusion needs a citation that shows why (only a cited exclude takes an item out)");
  else {
    const p = citeProblem(x.citation, ctx, { rows, kqIds, answered: true });
    if (p) out.push(p);
  }
  if (x.reason === "duplicate-of") {
    if (!itemsById.has(x.of)) out.push(`duplicate-of names ${x.of ?? "nothing"}; name the coverage item that covers it (of)`);
    else if (x.of === x.item) out.push("an item can't be a duplicate of itself");
    else if (itemsById.has(x.item) && !sameTarget(itemsById.get(x.item), itemsById.get(x.of)))
      out.push(`duplicate-of ${x.of}, which is not the same check: a duplicate has the same technique, source and target (e.g. one field's partition reached on two pages)`);
    else if (excludedIds.has(x.of)) out.push(`duplicate-of ${x.of}, which is excluded itself (no chains or cycles)`);
    else if (!mapped.has(x.of)) out.push(`duplicate-of ${x.of}, which no case covers; a duplicate needs a covered item`);
  }
  return out;
}

// The overlay's derived sets for this build. -> {mapped, excludedIds, kqIds, rowsById}
function overlaySets(overlay, { itemsById, rows, openPoints }) {
  return {
    mapped: new Set((overlay.cases ?? []).flatMap((c) => effectiveCovers(c, itemsById))),
    excludedIds: new Set((overlay.exclude ?? []).map((x) => x.item)),
    kqIds: new Set(Object.values(openPoints?.points ?? {}).filter((p) => p.status === "active").map((p) => p.id)),
    rowsById: new Map(rows.map((r) => [r.id.trim(), r])),
  };
}

// The exclusions that take their item out: valid, and the first one per item. -> Map item -> exclusion
export function validExclusions(ctx, overlay, { itemsById, rows, openPoints }) {
  const sets = overlaySets(overlay, { itemsById, rows, openPoints });
  const out = new Map();
  for (const x of overlay.exclude ?? []) if (!out.has(x.item) && !exclusionProblems(x, ctx, { itemsById, rows, ...sets }).length) out.set(x.item, x);
  return out;
}

// Problems of the overlay against this build's items and the module's files (beyond the schema). -> string[]
export function overlayProblems(ctx, overlay, { itemsById, rows, openPoints }) {
  const problems = [];
  const sets = overlaySets(overlay, { itemsById, rows, openPoints });
  const { rowsById, kqIds } = sets;
  const keys = new Map();
  const titles = new Map();
  for (const c of overlay.cases ?? []) {
    const at = (p) => problems.push(`case '${c.key}': ${p}`);
    if (keys.has(c.key)) at("the key is used twice; keys are unique and never change");
    keys.set(c.key, true);
    const t = one(c.title).toLowerCase();
    if (titles.has(t)) at(`the title repeats case '${titles.get(t)}' (scenario names are unique)`);
    else titles.set(t, c.key);
    if (STEP_TITLE.test(one(c.title))) at("the title is a step, not a declarative name of the behavior (gherkin-lint)");
    if (UI_MECHANICS.test(c.action ?? "")) at("the action (the one When) names UI mechanics; keep it declarative and put clicks and keys in steps");
    const rawTexts = (c.evidence ?? []).map((e) => evidenceText(e, ctx, rowsById));
    const ep = expectedProblem(c.expected, anchorNames(effectiveCovers(c, itemsById).map((id) => itemsById.get(id)), rawTexts));
    if (ep) at(ep);
    if (!(c.covers ?? []).length) at("covers no coverage item (link the CI ids it covers)");
    for (const id of c.covers ?? []) {
      const i = itemsById.get(id);
      if (!i) at(`covers ${id}, which is not a coverage item of this build`);
      else if (i.technique === "clarification" && !(c.evidence ?? []).includes(`clarification:${i.clarification.id}`))
        at(`covers ${id} (clarification ${i.clarification.id}) without citing clarification:${i.clarification.id}`);
    }
    for (const p of coverProblems(effectiveCovers(c, itemsById).map((id) => ({ id, ...itemsById.get(id) })))) at(p);
    if (!(c.evidence ?? []).length) at("cites no evidence (clarification:, knowledge: or observation:)");
    for (const e of c.evidence ?? []) {
      const p = citeProblem(e, ctx, { rows, kqIds });
      if (p) at(p);
    }
    if (c.assumption && !String(c.assumes ?? "").trim()) at("tagged assumption without saying what it assumes (assumes)");
    const texts = (c.evidence ?? []).map((e) => normQuote(evidenceText(e, ctx, rowsById)));
    for (const m of String(c.expected ?? "").matchAll(QUOTE_RE)) {
      const q = normQuote(m[1] ?? m[2]);
      if (q && !texts.some((t) => t.includes(q))) at(`the expected result quotes "${m[1] ?? m[2]}", which appears in none of its evidence (quote the product's messages verbatim)`);
    }
    for (const [k, v] of Object.entries(c.data ?? {}))
      for (const m of String(v).matchAll(EMAIL_RE)) if (!SYNTHETIC_DOMAIN.test(m[1])) at(`test data '${k}' uses the email domain ${m[1]}; use synthetic data (example.com, *.test)`);
  }
  const seen = new Set();
  for (const x of overlay.exclude ?? []) {
    if (seen.has(x.item)) problems.push(`exclude ${x.item}: excluded twice`);
    seen.add(x.item);
    for (const p of exclusionProblems(x, ctx, { itemsById, rows, ...sets })) problems.push(`exclude ${x.item}: ${p}`);
  }
  return problems;
}

// Why a case is an assumption: an unanswered or unapproved clarification (D-048), a rule fact resting on an agent
// capture or stale text (D-051), an open point, or the writer's own `assumes`. -> string[]
function assumptionsOf(c, { itemsById, rowsById, facts }) {
  const out = [];
  for (const id of clarificationsOfCase(c)) {
    const row = rowsById.get(id);
    if (!row) continue;
    if (!isAnswered(row)) out.push(`${id} is unanswered`);
    else if (!isAuthoritative(row)) out.push(`${id} is awaiting human approval (${row.answerStatus})`);
  }
  const weak = (f) => f && WEAK_EVIDENCE.includes(f.evidence);
  for (const id of effectiveCovers(c, itemsById)) {
    const f = itemsById.get(id)?.fact;
    if (weak(f)) out.push(`the rule fact knowledge/${f.file}:${f.line} rests on ${f.evidence} evidence`);
  }
  for (const e of c.evidence ?? []) {
    const m = /^knowledge:([^#]+)#(?:L(\d+)|(KQ-[\w-]+))$/.exec(e);
    if (!m) continue;
    if (m[3]) out.push(`${m[3]} is an open point`);
    const f = facts.find((x) => x.file === m[1] && x.line === Number(m[2]));
    if (weak(f)) out.push(`the rule fact knowledge/${f.file}:${f.line} rests on ${f.evidence} evidence`);
  }
  if (c.assumption && c.assumes) out.push(one(c.assumes));
  return uniq(out);
}

// What a human approves: the case's content, what it covers, the evidence it rests on and whether it is an assumption.
// A change to any of it -- including re-pointing evidence or covers, or a clarification it relies on changing status --
// makes an approved case unapproved again. assumption: the derived @assumption.
export function caseHash(c, assumption = !!c.assumption) {
  const sorted = (xs) => uniq(xs ?? []).sort();
  const data = Object.fromEntries(Object.entries(c.data ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const content = {
    title: one(c.title), type: c.type, priority: c.priority, mutates: !!c.mutates, visual: !!c.visual, api: !!c.api,
    preconditions: (c.preconditions ?? []).map(one), action: one(c.action), steps: (c.steps ?? []).map(one), expected: one(c.expected), data,
    covers: sorted(c.covers), evidence: sorted(c.evidence), assumption: !!assumption,
  };
  return sha256Text(JSON.stringify(content));
}
// The Version cell of approval.csv: `v` + 12 hex, so Excel keeps it text.
export const versionOf = (hash) => `v${String(hash).slice(0, 12)}`;
// A Version cell against a case's hash, read tolerantly: the `v` prefix optional, case and spaces ignored; a value Excel
// turned into a whole number counts only when it is exactly the version's digits (leading zeros dropped). Anything else
// Excel produced (scientific notation, rounding) can't be matched unambiguously. -> "match" | "differs" | "unreadable"
export function versionMatch(cell, hash) {
  const want = versionOf(hash).slice(1);
  const v = String(cell ?? "").trim().toLowerCase().replace(/^v/, "");
  if (/^[0-9a-f]{12}$/.test(v)) return v === want ? "match" : "differs";
  if (/^\d{1,12}$/.test(v)) return v.padStart(12, "0") === want ? "match" : "differs";
  return "unreadable";
}

// ---------- rendering ----------

const tagsOf = (c) => uniq([c.id, c.priority, c.type, ...(c.mutates ? ["mutates"] : []), ...(c.visual ? ["visual"] : []), ...(c.api ? ["api"] : []), ...c.clarifications, ...(c.assumption ? ["assumption"] : [])]);
const flags = (c) => ["mutates", "visual", "api", "assumption"].filter((f) => c[f]);
const numbered = (steps) => steps.map((s, i) => `${i + 1}. ${one(s)}`).join("\n");
const dataText = (c) => Object.entries(c.data ?? {}).map(([k, v]) => `${k} = ${v}`).join("\n");
export const CASE_COLUMNS = ["ID", "Title", "Priority", "Type", "Preconditions", "Steps", "Expected", "Test data", "Clarifications", "Mutates", "Assumption", "Tags", "Covers", "Evidence"];
const caseRow = (c) => [c.id, one(c.title), c.priority, c.type, c.preconditions.map(one).join("\n"), numbered(c.steps), one(c.expected), dataText(c), c.clarifications.join(" "), c.mutates ? "yes" : "", c.assumption ? "yes" : "", flags(c).join(" "), c.covers.join(" "), c.evidence.join(" ")];
const HEADER_NOTE = "Rendered by scripts/testcases.mjs build from testcases/cases.json. Do not edit this file: change cases.json and build again.";

function renderGherkin(feature, cases) {
  const cell = (s) => String(s).replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "\\n");
  const lines = [`# ${HEADER_NOTE}`, `Feature: ${one(feature)}`, ""];
  for (const c of cases) {
    lines.push(`  ${tagsOf(c).map((t) => `@${t}`).join(" ")}`, `  Scenario: ${one(c.title)}`, "    Steps:");
    c.steps.forEach((s, i) => lines.push(`      ${i + 1}. ${one(s)}`));
    if (c.assumption) lines.push(`    Assumes: ${c.assumptions.join("; ")}`);
    lines.push(`    Covers: ${c.covers.join(", ")}`, `    Evidence: ${c.evidence.join(", ")}`);
    c.preconditions.forEach((p, i) => lines.push(`    ${i ? "And" : "Given"} ${one(p)}`));
    lines.push(`    When ${one(c.action)}`);
    const data = Object.entries(c.data ?? {});
    if (data.length) lines.push("      | field | value |", ...data.map(([k, v]) => `      | ${cell(k)} | ${cell(v)} |`));
    lines.push(`    Then ${one(c.expected)}`, "");
  }
  return lines.join("\n");
}

function renderMarkdown(feature, cases) {
  const cell = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  return [`# Test cases -- ${one(feature)}`, "", `<!-- ${HEADER_NOTE} -->`, "", `| ${CASE_COLUMNS.join(" | ")} |`, `|${CASE_COLUMNS.map(() => "---").join("|")}|`, ...cases.map((c) => `| ${caseRow(c).map(cell).join(" | ")} |`), ""].join("\n");
}

// -> the text of <m>-testcases.<ext> in the format
export function renderCases(format, feature, cases) {
  if (format === "gherkin") return renderGherkin(feature, cases);
  if (format === "markdown-table") return renderMarkdown(feature, cases);
  if (format === "testrail") return serializeCsv([["Section", ...CASE_COLUMNS], ...cases.map((c) => [one(feature), ...caseRow(c)])]);
  if (format === "csv") return serializeCsv([CASE_COLUMNS, ...cases.map(caseRow)]);
  throw new Error(`unknown testcases.output_format '${format}' (one of ${FORMATS.join(", ")})`);
}

function renderSummary(ctx, cases, ledger, byTechnique, degraded, file) {
  const count = (k, vals) => vals.map((v) => `| ${v} | ${cases.filter((c) => c[k] === v).length} |`);
  const used = new Map();
  for (const c of cases) for (const id of c.clarifications) used.set(id, [...(used.get(id) ?? []), c.id]);
  const items = ledger.items;
  const list = (status) => items.filter((i) => i.status === status);
  return [
    `# Test cases -- ${ctx.moduleName}`,
    "",
    `Total test cases: ${cases.length}`,
    "",
    `Rendered by \`scripts/testcases.mjs build\` from \`testcases/cases.json\` into \`testcases/${path.basename(file)}\` (${ctx.format}). Do not edit.`,
    "",
    "## By type",
    "",
    "| Type | Cases |",
    "|---|---|",
    ...count("type", TYPES),
    "",
    "## By priority",
    "",
    "| Priority | Cases |",
    "|---|---|",
    ...count("priority", PRIORITIES),
    "",
    "## Coverage items",
    "",
    "| Technique | Items | Mapped | Excluded | Pending | Deferred |",
    "|---|---|---|---|---|---|",
    ...TECHNIQUES.filter((t) => byTechnique[t]).map((t) => `| ${t} | ${byTechnique[t].total} | ${byTechnique[t].mapped} | ${byTechnique[t].excluded} | ${byTechnique[t].pending} | ${byTechnique[t].deferred} |`),
    "",
    ...(degraded.length ? ["Degraded (inputs missing):", ...degraded.map((d) => `- ${d}`), ""] : []),
    "## Clarifications used",
    "",
    ...(used.size ? [...used].sort(([a], [b]) => byNum(a, b)).map(([id, tcs]) => `- ${id}: ${tcs.join(", ")}`) : ["None."]),
    "",
    "## Assumption-based cases",
    "",
    ...(cases.some((c) => c.assumption) ? cases.filter((c) => c.assumption).map((c) => `- ${c.id} ${one(c.title)}: ${c.assumptions.join("; ")}`) : ["None."]),
    "",
    "## Excluded coverage items",
    "",
    ...(list("excluded").length ? list("excluded").map((i) => `- ${i.id} (${i.label}): ${i.reason} -- ${i.detail}${i.citation ? ` [${i.citation}]` : i.of ? ` [${i.of}]` : ""}`) : ["None."]),
    "",
    `## Deferred (over testcases.max_cases ${ctx.maxCases})`,
    "",
    ...(list("deferred").length ? list("deferred").map((i) => `- ${i.id} (${i.priority}) ${i.label}`) : ["None."]),
    "",
  ].join("\n");
}

// ---------- approvals (human only) ----------

// Excel-friendly: case, spaces and a few synonyms. -> "yes" | "no" | "changes" | "" (blank) | null (not understood)
export function normApproval(v) {
  const s = String(v ?? "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!s) return "";
  if (["yes", "y", "approved", "approve", "ok", "x", "true", "1"].includes(s)) return "yes";
  if (["no", "n", "rejected", "reject", "false", "0"].includes(s)) return "no";
  if (["changes", "change", "changes-requested", "change-requested", "request-changes", "needs-changes"].includes(s)) return "changes";
  return null;
}

export const readApprovals = (tp, module) => readJson(tp.approvals, { module, cases: {} });
const REQUIRED_APPROVAL_COLUMNS = ["TC ID", "Approved", "Version"];

// approval.csv as Excel may have saved it: `,` or `;` (by locale), a BOM, any column order.
// -> null (no file) | {rows: [{id, approved, comment, run, version, line}], delimiter, missing: [required columns not found]}
function readApprovalCsv(file) {
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const delimiter = detectDelimiter(text);
  const all = parseCsv(text, { delimiter });
  const header = (all[0] ?? []).map((h) => String(h).trim().toLowerCase());
  const col = (name) => header.indexOf(name.toLowerCase());
  const get = (r, name) => (col(name) < 0 ? "" : String(r[col(name)] ?? "").trim());
  const rows = all.slice(1).map((r, i) => ({ id: get(r, "TC ID"), approved: get(r, "Approved"), comment: get(r, "Comment"), run: get(r, "Rendered in run"), version: get(r, "Version"), line: i + 2 })).filter((r) => r.id);
  return { rows, delimiter, missing: REQUIRED_APPROVAL_COLUMNS.filter((c) => col(c) < 0) };
}

// Each current case's approval: approved / rejected / changes (a decision on exactly this content) or awaiting.
// A decision on an earlier content of the case no longer counts (`invalidated`). approvals.json is the only source.
export function approvalStatus(cases, approvals) {
  return new Map(
    cases.map((c) => {
      const a = approvals.cases?.[c.id];
      if (!a) return [c.id, { status: "awaiting" }];
      if (a.hash !== c.hash) return [c.id, { status: "awaiting", invalidated: true }];
      return [c.id, { status: { yes: "approved", no: "rejected", changes: "changes" }[a.decision], comment: a.comment }];
    })
  );
}

export function approvalCounts(cases, approvals) {
  const st = [...approvalStatus(cases, approvals).values()];
  const n = (s) => st.filter((x) => x.status === s).length;
  return { approved: n("approved"), rejected: n("rejected"), changes: n("changes"), awaiting: n("awaiting"), invalidated: st.filter((x) => x.invalidated).length };
}

// approval.csv for the human: every current case, keeping the human's entries for unchanged cases (same Version), and
// prefilling a recorded decision on exactly this content. A row whose Version Excel made unreadable keeps the human's
// entry and that cell, so `approve` keeps reporting it. Keeps the sheet's delimiter.
// -> warning or null (e.g. the file is open in another program)
function renderApprovalCsv(ctx, cases, approvals) {
  const { tp, runId } = ctx;
  let before = null;
  try {
    before = readApprovalCsv(tp.approvalCsv);
  } catch (e) {
    return `approval.csv was not re-rendered: ${e.message}`;
  }
  const old = new Map((before?.rows ?? []).map((r) => [r.id, r]));
  const rows = cases.map((c) => {
    let v = versionOf(c.hash);
    const r = old.get(c.id);
    const a = approvals.cases?.[c.id];
    let approved = "";
    let comment = "";
    let run = runId ?? "";
    const m = r ? versionMatch(r.version, c.hash) : null;
    if (m === "match") [approved, comment, run] = [r.approved, r.comment, r.run || run];
    else if (m === "unreadable" && (r.approved || r.comment)) [approved, comment, run, v] = [r.approved, r.comment, r.run || run, r.version];
    else if (a && a.hash === c.hash) [approved, comment, run] = [a.decision, a.comment ?? "", a.run ?? run];
    else if (r?.comment && !r.comment.startsWith("(on an earlier version)")) comment = `(on an earlier version) ${r.comment}`;
    return [c.id, one(c.title), numbered(c.steps), one(c.expected), c.priority, approved, comment, run, v];
  });
  const text = serializeCsv([APPROVAL_COLUMNS, ...rows], { delimiter: before?.delimiter ?? "," });
  if (existsSync(tp.approvalCsv) && readFileSync(tp.approvalCsv, "utf8") === text) return null;
  try {
    mkdirSync(tp.dir, { recursive: true });
    writeAtomic(tp.approvalCsv, text);
    return null;
  } catch (e) {
    return `approval.csv was not re-rendered: ${e.message}`;
  }
}

// The `no` and `changes` decisions on the current content, as findings for the writer (docs/agent-handoffs.md §6).
function renderApprovalFindings(ctx, cases, approvals) {
  const st = approvalStatus(cases, approvals);
  const cell = (s) => one(s).replace(/\|/g, "\\|");
  const rows = cases
    .filter((c) => ["rejected", "changes"].includes(st.get(c.id).status))
    .map((c, i) => {
      const s = st.get(c.id);
      const comment = s.comment ? cell(s.comment) : "(no comment)";
      return s.status === "rejected"
        ? `| ${i + 1} | blocker | testcases/cases.json |  | human-rejected | ${c.id} (case '${c.key}') was rejected by a human: ${comment} | fix or replace the case as the comment says; the changed case goes back to the human |`
        : `| ${i + 1} | major | testcases/cases.json |  | human-changes | ${c.id} (case '${c.key}'): a human asked for changes: ${comment} | apply the requested changes; the changed case goes back to the human |`;
    });
  const text = [`# Approval -- testcases / ${ctx.module}`, `Verdict: ${rows.length ? "changes-required" : "pass"}`, "| # | Severity | File | Line | Rule | Problem | Required fix |", "|---|---|---|---|---|---|---|", ...rows, ""].join("\n");
  if (!(existsSync(ctx.tp.approvalFindings) && readFileSync(ctx.tp.approvalFindings, "utf8") === text)) writeAtomic(ctx.tp.approvalFindings, text);
  return rows.length;
}

// The process's own terminal: approve asks there. An agent's shell is not interactive (no TTY), so it is refused.
function terminal() {
  return {
    isTTY: !!process.stdin.isTTY,
    ask: async (question) => {
      const { createInterface } = await import("node:readline/promises");
      const rl = createInterface({ input: process.stdin, output: process.stderr });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
  };
}

// `testcases.mjs approve`: a human's decisions in approval.csv -> approvals.json, each pinned to the case's content
// hash. A row whose Version is not the case's current content is refused (re-render with build and review it again); a
// blank row clears an earlier decision. Human only: the guard denies it to every tool call it sees, and it refuses
// unless it runs in an interactive terminal where the human types the module slug to confirm (interactive: injected by
// tests). Exit 1 whenever it records nothing.
export async function approve(ctx, validateData, { interactive = terminal() } = {}) {
  const { tp, module } = ctx;
  const fail = (problems, extra = {}) => ({ code: 1, out: { recorded: [], cleared: [], ...extra, problems } });
  const cov = readJson(tp.coverage, null);
  if (!cov) return fail(["testcases/coverage.json is missing: the test cases were never built"]);
  const sheet = readApprovalCsv(tp.approvalCsv);
  if (!sheet) return fail(["testcases/approval.csv is missing: it is rendered by testcases.mjs build"]);
  if (sheet.missing.length) return fail([`approval.csv has no ${sheet.missing.map((c) => `'${c}'`).join(", ")} column (header: ${APPROVAL_COLUMNS.join(", ")}); nothing was recorded`]);
  const cases = new Map(cov.cases.map((c) => [c.id, c]));
  const before = readApprovals(tp, module);
  const next = { module, cases: { ...before.cases } };
  const problems = [];
  const recorded = [];
  const cleared = [];
  const unchanged = [];
  for (const r of sheet.rows) {
    const c = cases.get(r.id);
    const decision = normApproval(r.approved);
    const at = (p) => problems.push(`approval.csv line ${r.line}: ${r.id}: ${p}`);
    if (!c) {
      if (decision) at("not a current test case");
      continue;
    }
    if (decision === null) {
      at(`Approved '${r.approved}' is not yes, no, changes or blank`);
      continue;
    }
    if (decision === "") {
      if (next.cases[r.id]) {
        delete next.cases[r.id];
        cleared.push(r.id);
      }
      continue;
    }
    const m = versionMatch(r.version, c.hash);
    if (m === "unreadable") {
      at(`Version '${r.version}' can't be read (Excel may have changed it); check the row still describes the case, then set Version to ${versionOf(c.hash)}. Your entry is kept`);
      continue;
    }
    if (m === "differs") {
      at(`changed since this row was rendered (Version ${r.version || "missing"}, now ${versionOf(c.hash)}); run build to re-render it and review it again`);
      continue;
    }
    const prev = next.cases[r.id];
    if (prev && prev.hash === c.hash && prev.decision === decision && (prev.comment ?? "") === r.comment) {
      unchanged.push(r.id);
      continue;
    }
    next.cases[r.id] = { decision, comment: r.comment, hash: c.hash, version: versionOf(c.hash), run: r.run || ctx.runId || null, at: new Date().toISOString() };
    recorded.push(r.id);
  }
  if (!recorded.length && !cleared.length) {
    if (!unchanged.length) return fail([...problems, "approval.csv has no decision to record: every Approved cell is blank or was refused"]);
  } else {
    if (!interactive?.isTTY) return fail([...problems, "approve is human-only: run it yourself in an interactive terminal (in Git Bash's mintty: winpty node scripts/testcases.mjs approve ...); nothing was recorded"]);
    const answer = await interactive.ask(`Record ${recorded.length} decision(s) and clear ${cleared.length} for module '${module}'. Type the module slug to confirm: `);
    if (String(answer ?? "").trim() !== module) return fail([...problems, `not confirmed (expected '${module}'); nothing was recorded`]);
    const bad = await validateData("testcases-approvals", next);
    if (bad.length) return fail([...problems, ...bad.map((e) => `approvals.json: ${e}`), "nothing was recorded"]);
    withFileLock(tp.approvals, () => writeJson(tp.approvals, next));
  }
  const approvals = readApprovals(tp, module);
  const findings = renderApprovalFindings(ctx, cov.cases, approvals);
  return { code: problems.length ? 1 : 0, out: { recorded, cleared, unchanged, ...approvalCounts(cov.cases, approvals), findings, problems } };
}

// ---------- build ----------

// The inputs a build depends on (check fails when one changed after the build) and the files it renders.
function inputDigests(ctx, rows) {
  const { tp, xp, kp, module } = ctx;
  return {
    cases: sha256(tp.overlay), model: sha256(xp.model), interactions: sha256(xp.interactions),
    ruleFacts: sha256(kp.module(module).ruleFacts), openPoints: sha256(kp.module(module).openPoints),
    flows: flowsDigest(xp), clarifications: rowsDigest(rows ?? readRows(csvPath(ctx.productDir, module))), config: configDigest(ctx),
  };
}
const outputFiles = (ctx) => ({ file: ctx.tp.file(ctx.format), summary: ctx.tp.summary });

// Seeds the TC registry of a module whose cases were hand-written before this script, so old ids are never reused.
function seedCaseRegistry(ctx) {
  const { tp, module } = ctx;
  if (existsSync(tp.registry.cases)) return;
  const old = FORMATS.map((f) => tp.file(f)).filter((f, i, a) => a.indexOf(f) === i && existsSync(f));
  let max = 0;
  for (const f of old) {
    const format = FORMATS.find((x) => tp.file(x) === f);
    try {
      for (const c of parseCases(f, format)) if (new RegExp(`^TC-${module}-\\d+$`).test(c.id ?? "")) max = Math.max(max, idNum(c.id));
    } catch {}
  }
  if (max) writeJson(tp.registry.cases, { module, next: max + 1, cases: {} });
}

// validateData: contract.mjs validateData (async, schema name + data). -> {code, out}
export async function build(ctx, validateData) {
  const { tp, module, format } = ctx;
  const overlay = readJson(tp.overlay, { cases: [], exclude: [] });
  const bad = await validateData("testcases-overlay", overlay);
  if (bad.length) return { code: 1, out: { problems: bad.map((e) => `cases.json: ${e}`), note: "fix testcases/cases.json; nothing was built" } };
  if (overlay.module && overlay.module !== module) return { code: 1, out: { problems: [`cases.json: module is '${overlay.module}', not '${module}'`], note: "nothing was built" } };
  const inputs = readInputs(ctx);
  const { items, degraded } = assignItemIds(ctx, inputs);
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const rowsById = new Map(inputs.rows.map((r) => [r.id.trim(), r]));
  const facts = (inputs.ruleFacts?.facts ?? []).map((f) => ({ ...f }));
  const problems = overlayProblems(ctx, overlay, { itemsById, rows: inputs.rows, openPoints: inputs.openPoints });
  const warnings = [];

  // cases: stable ids, derived tags
  seedCaseRegistry(ctx);
  const caseReg = assignIds(tp.registry.cases, uniq(overlay.cases.map((c) => c.key)), { module, runId: ctx.runId, prefix: "TC", field: "cases" });
  const seenKeys = new Set();
  const cases = [];
  for (const c of overlay.cases) {
    if (seenKeys.has(c.key)) continue;
    seenKeys.add(c.key);
    const covers = effectiveCovers(c, itemsById).sort(byNum);
    const assumptions = assumptionsOf(c, { itemsById, rowsById, facts });
    cases.push({
      id: caseReg.cases[c.key].id, key: c.key, title: one(c.title), type: c.type, priority: c.priority,
      mutates: !!c.mutates, visual: !!c.visual || c.type === "visual", api: !!c.api || c.type === "api",
      assumption: assumptions.length > 0, assumptions,
      preconditions: c.preconditions ?? [], action: c.action, steps: c.steps, expected: c.expected, data: c.data ?? {},
      covers, evidence: uniq(c.evidence ?? []), clarifications: clarificationsOfCase(c), hash: caseHash(c, assumptions.length > 0),
    });
  }
  cases.sort((a, b) => byNum(a.id, b.id));
  const gone = Object.entries(caseReg.cases).filter(([, e]) => e.status === "gone").map(([k, e]) => `${e.id} (${k})`);
  if (gone.length) warnings.push(`cases no longer in cases.json (their ids are never reused): ${gone.join(", ")}`);
  if (cases.length > ctx.maxCases) warnings.push(`${cases.length} cases, over testcases.max_cases (${ctx.maxCases})`);

  // the coverage ledger: mapped by the cases, excluded by a valid cited exclusion, the rest pending or over the budget
  const ledger = createLedger({ reasons: EXCLUDE_REASONS });
  const refs = new Map();
  for (const c of cases) for (const id of c.covers) refs.set(id, [...(refs.get(id) ?? []), c.id]);
  const exclusions = validExclusions(ctx, overlay, { itemsById, rows: inputs.rows, openPoints: inputs.openPoints });
  for (const i of items) {
    const { id, key, technique, source, subject, label, priority, ...extra } = i;
    ledger.addItem(id, { key, technique, source, subject, label, priority, ...extra });
    const x = exclusions.get(id);
    if (refs.has(id)) {
      ledger.resolve(id, { status: "mapped", refs: refs.get(id).sort(byNum) });
      if (x) warnings.push(`${id} is covered by ${refs.get(id).join(", ")} and also excluded; the exclusion is ignored`);
    } else if (x)
      ledger.resolve(id, { status: "excluded", reason: x.reason, detail: one(x.detail), ...(x.citation ? { citation: x.citation } : {}), ...(x.of ? { of: x.of } : {}) });
  }
  // The budget: the max_cases best-ranked items still in play (mapped or pending) are in it; a pending item beyond it is
  // deferred: budget. A covered item is never deferred: the work is done. Ranked by priority, then technique, then key,
  // so the set does not move while the writer covers items.
  const rank = (i) => [PRIORITIES.indexOf(i.priority), TECHNIQUES.indexOf(i.technique), i.key];
  const cmp = (a, b) => {
    const [x, y] = [rank(a), rank(b)];
    return x[0] - y[0] || x[1] - y[1] || (x[2] < y[2] ? -1 : x[2] > y[2] ? 1 : 0);
  };
  const inPlay = ledger.items.filter((i) => i.status === "mapped" || i.status === "pending").sort(cmp);
  for (const i of inPlay.slice(ctx.maxCases)) if (i.status === "pending") ledger.resolve(i.id, { status: "deferred", reason: "budget", detail: `over testcases.max_cases (${ctx.maxCases})` });
  for (const i of ledger.items) if (i.status === "pending") i.why = "no case covers it yet";
  const byTechnique = {};
  for (const i of ledger.items) {
    const t = (byTechnique[i.technique] ??= { total: 0, mapped: 0, excluded: 0, pending: 0, deferred: 0 });
    t.total++;
    t[i.status]++;
  }

  // render
  const file = tp.file(format);
  mkdirSync(tp.dir, { recursive: true });
  const writeIfChanged = (f, text) => {
    if (!(existsSync(f) && readFileSync(f, "utf8") === text)) writeAtomic(f, text);
  };
  writeIfChanged(file, renderCases(format, ctx.moduleName, cases));
  writeIfChanged(tp.summary, renderSummary(ctx, cases, ledger, byTechnique, degraded, file));
  const parsed = parseCases(file, format).map((c) => c.id);
  if (JSON.stringify(parsed) !== JSON.stringify(cases.map((c) => c.id))) problems.push(`${path.basename(file)} does not parse back to the cases (${parsed.length} of ${cases.length})`);

  const approvals = readApprovals(tp, module);
  const w = renderApprovalCsv(ctx, cases, approvals);
  if (w) warnings.push(w);
  const approvalFindings = renderApprovalFindings(ctx, cases, approvals);

  const coverage = {
    module, runId: ctx.runId, format, maxCases: ctx.maxCases, degraded,
    summary: ledger.summary(), byTechnique,
    items: ledger.items.map(({ why, ...i }) => i),
    cases,
    problems,
    built: { inputs: inputDigests(ctx, inputs.rows), outputs: Object.fromEntries(Object.entries(outputFiles(ctx)).map(([k, f]) => [k, sha256(f)])) },
  };
  const covBad = await validateData("testcases-coverage", coverage);
  if (covBad.length) problems.push(...covBad.map((e) => `coverage.json (internal): ${e}`));
  writeJson(tp.coverage, coverage);
  const pending = ledger.items.filter((i) => i.status === "pending");
  return {
    code: problems.length ? 1 : 0,
    out: {
      cases: cases.length, assumption: cases.filter((c) => c.assumption).length, items: ledger.summary(), degraded,
      pending: pending.slice(0, 40).map((i) => ({ id: i.id, technique: i.technique, label: i.label })),
      approvals: approvalCounts(cases, approvals), approvalFindings,
      written: [file, tp.summary, tp.coverage, tp.approvalCsv].map((f) => rel(ctx.root, f)),
      problems, warnings,
      next: problems.length ? "fix the problems in testcases/cases.json, then build again" : pending.length ? "cover or exclude the pending items in testcases/coverage.json through cases.json, then build again" : "run testcases.mjs check",
    },
  };
}

// `items`: the coverage items only (ids assigned), for a first look before any case exists.
export function listItems(ctx) {
  const { items, degraded } = assignItemIds(ctx);
  const counts = {};
  for (const i of items) counts[i.technique] = (counts[i.technique] ?? 0) + 1;
  return { total: items.length, byTechnique: counts, degraded, items: items.map((i) => ({ id: i.id, technique: i.technique, priority: i.priority, subject: i.subject, label: i.label })) };
}

// ---------- check and the verified stamp ----------

function verifiedInputs(ctx) {
  const { tp, xp, kp, module } = ctx;
  return { cases: tp.overlay, file: tp.file(ctx.format), summary: tp.summary, model: xp.model, interactions: xp.interactions, ruleFacts: kp.module(module).ruleFacts, openPoints: kp.module(module).openPoints };
}
const extraDigests = (ctx) => ({ flows: flowsDigest(ctx.xp), clarifications: rowsDigest(readRows(csvPath(ctx.productDir, ctx.module))), config: configDigest(ctx) });

// null when the module's test cases passed `check` on exactly what is on disk, else why not (for the domain flow).
export function testcasesUnverified(ctx) {
  const cov = readJson(ctx.tp.coverage, null);
  if (!cov) return "testcases/coverage.json is missing: the writer must finish with testcases.mjs check";
  const { flows, clarifications, config, ...files } = cov.verified ?? {};
  const why = unverifiedReason(cov.verified ? files : null, verifiedInputs(ctx), { unstamped: "the test cases did not pass testcases.mjs check", changed: "the test cases or their inputs changed after testcases.mjs check" });
  if (why) return why;
  const now = extraDigests(ctx);
  return flows === now.flows && clarifications === now.clarifications && config === now.config ? null : "the flows, the clarifications or the run-config changed after testcases.mjs check";
}

// Every rule; a pass stamps coverage.json `verified`. -> {valid, problems, ...counts}
export async function runCheck(ctx, validateData) {
  const { tp, module } = ctx;
  const cov = readJson(tp.coverage, null);
  if (!cov) return { valid: false, problems: ["testcases/coverage.json is missing: run testcases.mjs build first"] };
  const problems = [];
  const overlay = readJson(tp.overlay, { cases: [], exclude: [] });
  problems.push(...(await validateData("testcases-overlay", overlay)).map((e) => `cases.json: ${e}`));
  const { verified, ...unstamped } = cov;
  problems.push(...(await validateData("testcases-coverage", unstamped)).map((e) => `coverage.json: ${e}`));
  const inputs = readInputs(ctx);
  const now = inputDigests(ctx, inputs.rows);
  const stale = Object.keys(now).filter((k) => now[k] !== cov.built?.inputs?.[k]);
  if (stale.length) problems.push(`stale: ${stale.join(", ")} changed after the last build (run testcases.mjs build again)`);
  for (const [k, f] of Object.entries(outputFiles(ctx))) if (sha256(f) !== cov.built?.outputs?.[k]) problems.push(`${rel(ctx.root, f)} changed after the last build (it is script-owned; run build again)`);
  if (!stale.length) {
    const itemsById = new Map(cov.items.map((i) => [i.id, i]));
    problems.push(...overlayProblems(ctx, overlay, { itemsById, rows: inputs.rows, openPoints: inputs.openPoints }));
  }
  for (const i of cov.items) if (i.status === "pending") problems.push(`${i.id} pending: ${i.label} (${i.subject})`);
  for (const c of cov.cases) if (!c.covers.length) problems.push(`${c.id} (case '${c.key}') covers no coverage item`);
  if (existsSync(tp.summary)) problems.push(...checkTestcases(tp.summary, { module, testcasesFormat: ctx.format }));
  const valid = !uniq(problems).length;
  if (valid) writeJson(tp.coverage, { ...unstamped, verified: { ...stampVerified(verifiedInputs(ctx)), ...extraDigests(ctx) } });
  return { valid, cases: cov.cases.length, assumption: cov.cases.filter((c) => c.assumption).length, items: cov.summary, deferred: cov.summary.deferred, degraded: cov.degraded, problems: uniq(problems) };
}
