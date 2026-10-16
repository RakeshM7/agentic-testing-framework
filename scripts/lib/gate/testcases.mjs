// Gate rules for a module's test cases (format: docs/agent-handoffs.md §3). Mechanical checks only; whether an
// expected result is right stays with testcase-reviewer.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { csvPath, isAnswered, readRows } from "../clarifications.mjs";
import { parseCsv } from "../csv.mjs";
import { checkTestcases, testcasesFile } from "../testcases.mjs";
import { finding } from "./common.mjs";

export const PRIORITIES = ["p1", "p2", "p3"];
export const TYPES = ["functional", "negative", "boundary", "security", "visual", "api"];
const CLAR_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/;
const yes = (v) => /^(yes|y|true|x|1)$/i.test(String(v ?? "").trim());

// A case: {id, line, priority, type, clarifications[], mutates, assumption, api}.
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
  };
}

function fromColumns(get, line) {
  const type = get("type").toLowerCase();
  return {
    id: get("id") || null,
    line,
    priority: PRIORITIES.includes(get("priority").toLowerCase()) ? get("priority").toLowerCase() : null,
    type: TYPES.includes(type) ? type : null,
    clarifications: get("clarifications").split(/[\s,;]+/).map((s) => s.replace(/^@/, "")).filter((s) => CLAR_RE.test(s)),
    mutates: yes(get("mutates")),
    assumption: yes(get("assumption")),
    api: type === "api",
  };
}

function table(header, rows) {
  const idx = Object.fromEntries(header.map((h, i) => [String(h).trim().toLowerCase(), i]));
  return rows.map(({ cells, line }) => fromColumns((k) => String(cells[idx[k]] ?? "").trim(), line));
}

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
  if (format === "csv" || format === "testrail") {
    const [header = [], ...rows] = parseCsv(text);
    return table(header, rows.filter((r) => r.some((c) => String(c).trim())).map((cells, i) => ({ cells, line: i + 2 })));
  }
  // markdown-table: the first table whose header has an ID column
  const lines = text.split(/\r?\n/);
  const split = (l) => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
  const h = lines.findIndex((l) => l.trim().startsWith("|") && split(l).some((c) => c.toLowerCase() === "id"));
  if (h < 0) return [];
  const rows = [];
  for (let i = h + 2; i < lines.length && lines[i].trim().startsWith("|"); i++) rows.push({ cells: split(lines[i]), line: i + 1 });
  return table(split(lines[h]), rows);
}

export function gateTestcases({ productDir, module, format }) {
  const moduleDir = path.join(productDir, "modules", module);
  const summary = path.join(moduleDir, "testcases", "testcases-summary.md");
  const file = testcasesFile(moduleDir, module, format);
  const rel = path.posix.join("testcases", path.basename(file));
  const out = [];
  if (!existsSync(file)) return [finding("blocker", rel, null, "testcases-file", `${path.basename(file)} is missing (format ${format})`, "write the test cases file")];
  if (!existsSync(summary)) out.push(finding("blocker", "testcases/testcases-summary.md", null, "summary", "testcases-summary.md is missing", 'write it with the exact line "Total test cases: N"'));
  else for (const p of checkTestcases(summary, { module, testcasesFormat: format })) out.push(finding("blocker", "testcases/testcases-summary.md", null, "summary-total", p, "make the Total line match the file"));

  const rows = readRows(csvPath(productDir, module));
  const answered = new Set(rows.filter(isAnswered).map((r) => r.id.trim()));
  const known = new Set(rows.map((r) => r.id.trim()));
  const cases = parseCases(file, format);
  const seen = new Set();
  const used = new Set();
  const idRe = new RegExp(`^TC-${module}-\\d+$`);
  for (const c of cases) {
    const at = (rule, sev, problem, fix) => out.push(finding(sev, rel, c.line, rule, `${c.id ?? "case"}: ${problem}`, fix));
    if (!c.id || !idRe.test(c.id)) at("case-id", "blocker", `missing or malformed id (expected TC-${module}-<n>)`, `give the case a unique TC-${module}-<n> id`);
    else if (seen.has(c.id)) at("case-id", "blocker", "duplicate id", "ids are unique and never reused; give the newer case the next number");
    else seen.add(c.id);
    if (!c.priority) at("case-tags", "major", "no priority (@p1|@p2|@p3)", "add the priority");
    if (!c.type) at("case-tags", "major", `no type (${TYPES.map((t) => "@" + t).join("|")})`, "add the type");
    for (const ref of c.clarifications) {
      used.add(ref);
      if (!known.has(ref)) at("clarification-ref", "major", `references ${ref}, which is not a row of clarifications.csv`, "reference an existing clarification id");
    }
    const unanswered = c.clarifications.filter((r) => known.has(r) && !answered.has(r));
    if (unanswered.length && !c.assumption) at("assumption", "major", `relies on unanswered ${unanswered.join(", ")} but is not tagged @assumption`, "tag it @assumption and state what it assumes");
    if (c.assumption && !unanswered.length) at("assumption", "minor", "tagged @assumption but relies on no unanswered clarification", "remove @assumption, or reference the row it assumes");
  }
  const summaryText = existsSync(summary) ? readFileSync(summary, "utf8") : "";
  for (const id of answered)
    if (!used.has(id) && !new RegExp(`\\b${id}\\b`).test(summaryText))
      out.push(finding("major", rel, null, "clarification-coverage", `answered clarification ${id} is used by no test case`, "cover it with a case, or list it in testcases-summary.md as not testable with a reason"));
  return out;
}
