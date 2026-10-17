// Gate rules for a module's test cases (format: docs/agent-handoffs.md §3). Mechanical checks only; whether an
// expected result is right stays with testcase-reviewer.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { csvPath, isAnswered, isAuthoritative, readRows } from "../clarifications.mjs";
import { PRIORITIES, TYPES, checkTestcases, parseCases, testcasesFile } from "../testcases.mjs";
import { finding } from "./common.mjs";

// The parse contract lives in lib/testcases.mjs (one reader for the gates, api-plan and the stage check).
export { PRIORITIES, TYPES, parseCases };

// The cases whose @assumption scripts/testcases.mjs derived, with its reasons (testcases/coverage.json). -> Set of ids
function derivedAssumptions(file) {
  try {
    return new Set((JSON.parse(readFileSync(file, "utf8")).cases ?? []).filter((c) => c.assumption && c.assumptions?.length).map((c) => c.id));
  } catch {
    return new Set();
  }
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
  // Rows a case may rely on without @assumption: a human answered them, or approved the agent's answer (D-048).
  const authoritative = new Set(rows.filter(isAuthoritative).map((r) => r.id.trim()));
  const known = new Set(rows.map((r) => r.id.trim()));
  const cases = parseCases(file, format);
  const derived = derivedAssumptions(path.join(moduleDir, "testcases", "coverage.json"));
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
    const unconfirmed = c.clarifications.filter((r) => known.has(r) && !authoritative.has(r));
    if (unconfirmed.length && !c.assumption) at("assumption", "major", `relies on ${unconfirmed.join(", ")}, which is unanswered or awaiting human approval, but is not tagged @assumption`, "tag it @assumption and state what it assumes");
    // testcases.mjs derives @assumption from more than clarifications (a weak rule fact, an open point, the writer's
    // stated assumption); a case whose assumption the script derived and recorded is not a finding.
    if (c.assumption && !unconfirmed.length && !derived.has(c.id)) at("assumption", "minor", "tagged @assumption but relies on no unanswered or unapproved clarification", "remove @assumption, or reference the row it assumes");
  }
  const summaryText = existsSync(summary) ? readFileSync(summary, "utf8") : "";
  for (const id of answered)
    if (!used.has(id) && !new RegExp(`\\b${id}\\b`).test(summaryText))
      out.push(finding("major", rel, null, "clarification-coverage", `answered clarification ${id} is used by no test case`, "cover it with a case, or list it in testcases-summary.md as not testable with a reason"));
  return out;
}
