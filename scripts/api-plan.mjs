#!/usr/bin/env node
// CLI over scripts/lib/api-plan.mjs -- a module's API test plan under artifacts/<product>/modules/<m>/api/
// (docs/agent-handoffs.md §4, D-046). Uses the product's active run (state/run.json + state/config.resolved.json).
// Never sends a request to the product.
//
//   api-plan.mjs build <product> <module>   catalogue + drift + test cases + plan-overlay.json -> plan.json,
//                                           plan-coverage.json, plan-registry.json, api-test-plan.md; appends one
//                                           clarification question per fault class asserted as a status class only
//                                           (exit 1 on overlay problems)
//   api-plan.mjs check <product> <module>   schemas, ids vs registry, nothing pending, catalogue unchanged; stamps
//                                           plan-coverage.json `verified` (exit 1 on problems); reports how many
//                                           items are deferred over api.plan_budget (resolved, not pending; D-050)
//   api-plan.mjs paths <product> <module>   the plan's file paths
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, paths, repoRoot, validateData } from "./lib/contract.mjs";
import { build, check, planPaths } from "./lib/api-plan.mjs";
import { parseCases } from "./lib/gate/testcases.mjs";
import { approvalSummary, testcasesFile } from "./lib/testcases.mjs";

function context(product, module, root) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  const cfg = loadJson(p.configFile);
  const pp = planPaths(p.productDir, module);
  const file = testcasesFile(pp.moduleDir, module, cfg.testcases?.output_format ?? "gherkin");
  // Only cases a human approved exist for the plan (D-053): an approved @api case becomes a testcase: coverage item,
  // and the overlay may link or cite (testcase:) approved cases only, so an unapproved case gives no priority and no
  // traceability.
  const approved = new Set(approvalSummary(p.productDir, module).approved);
  const cases = new Map(existsSync(file) ? parseCases(file, cfg.testcases?.output_format ?? "gherkin").filter((c) => c.id && approved.has(c.id)).map((c) => [c.id, { api: c.api, priority: c.priority }]) : []);
  return { run, cfg, pp, cases };
}

const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

export async function main(argv, { root = repoRoot } = {}) {
  const [cmd, product, module] = argv;
  if (!cmd || !product || !module) return { code: 2, out: { errors: ["usage: api-plan.mjs build|check|paths <product> <module>"] } };
  const { run, cfg, pp, cases } = context(product, module, root);
  if (cmd === "paths") return { code: 0, out: Object.fromEntries(["plan", "coverage", "registry", "overlay", "md"].map((k) => [k, rel(root, pp[k])])) };
  if (cmd === "build") {
    if (existsSync(pp.overlay)) {
      const bad = await validateData("api-plan-overlay", loadJson(pp.overlay));
      if (bad.length) return { code: 1, out: { problems: bad.map((e) => `plan-overlay.json: ${e}`), note: "fix plan-overlay.json; nothing was built" } };
    }
    const r = build(pp, { module, cfg, runId: run.runId, cases });
    const schemaProblems = r.summary.scenarios === undefined ? [] : (await check(pp, validateData, { cases })).filter((p) => !p.startsWith("pending "));
    const problems = [...r.problems, ...schemaProblems];
    return { code: problems.length ? 1 : 0, out: { ...r.summary, plan: rel(root, pp.plan), problems, next: r.summary.pending ? "resolve the pending items in plan-coverage.json through plan-overlay.json, then build again" : "run api-plan.mjs check" } };
  }
  if (cmd === "check") {
    const problems = await check(pp, validateData, { cases });
    const deferred = existsSync(pp.coverage) ? (loadJson(pp.coverage).deferred ?? []).length : 0;
    return { code: problems.length ? 1 : 0, out: { valid: !problems.length, deferred, problems } };
  }
  return { code: 2, out: { errors: [`unknown command ${cmd}`] } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { code, out } = await main(process.argv.slice(2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(code);
  } catch (e) {
    console.log(JSON.stringify({ errors: [e.message] }, null, 2));
    process.exit(1);
  }
}
