// Gate rules for a module's test cases (format: docs/agent-handoffs.md §3). Mechanical checks only; whether an
// expected result is right stays with testcase-reviewer.
//
// The cases are script-built (scripts/testcases.mjs): ids, tags, @assumption, the clarification tags, the rendered file
// and the summary total are checked by `testcases.mjs check`, so the gate does not run them twice. It requires that
// check's verified stamp to be current, and checks one thing itself: every answered clarification is covered by a case
// whose evidence cites exactly `clarification:<id>`, or excluded with a citation in the coverage ledger. An id that
// merely appears somewhere (the summary, inside TC-contacts-3) never counts.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { csvPath, isAnswered, readRows } from "../clarifications.mjs";
import { PRIORITIES, TYPES, parseCases, testcaseContext, testcasesUnverified } from "../testcases.mjs";
import { finding } from "./common.mjs";
import { expandFw } from "../roots.mjs";

// The parse contract lives in lib/testcases.mjs (one reader for the gates, api-plan and the stage check).
export { PRIORITIES, TYPES, parseCases };

// ctx: {root, product, run, cfg, productDir, module}
export function gateTestcases({ root, product, run, cfg, productDir, module }) {
  const moduleDir = path.join(productDir, "modules", module);
  const coverage = path.join(moduleDir, "testcases", "coverage.json");
  if (!existsSync(coverage)) return [finding("blocker", "testcases/coverage.json", null, "testcases-built", "the test cases were never built by scripts/testcases.mjs", "write testcases/cases.json, then run testcases.mjs build and check")];
  const out = [];
  const why = testcasesUnverified(testcaseContext({ root, product, module, run, cfg, productDir }));
  if (why) out.push(finding("blocker", "testcases/coverage.json", null, "testcases-check", why, expandFw("run node {fw}/scripts/testcases.mjs check until it exits 0")));

  const cov = JSON.parse(readFileSync(coverage, "utf8"));
  const cited = new Set(cov.cases.flatMap((c) => c.evidence.filter((e) => e.startsWith("clarification:")).map((e) => e.slice("clarification:".length))));
  const item = new Map(cov.items.filter((i) => i.technique === "clarification").map((i) => [i.subject, i]));
  for (const r of readRows(csvPath(productDir, module)).filter(isAnswered)) {
    const id = r.id.trim();
    const i = item.get(id);
    if (cited.has(id) || i?.status === "excluded") continue;
    if (i?.status === "deferred") out.push(finding("minor", "testcases/coverage.json", null, "clarification-coverage", `answered clarification ${id} is deferred over testcases.max_cases`, "cover it when the budget allows"));
    else out.push(finding("major", "testcases/cases.json", null, "clarification-coverage", `answered clarification ${id} is cited by no test case`, `cover it with a case citing clarification:${id}, or exclude its coverage item with a citation`));
  }
  return out;
}
