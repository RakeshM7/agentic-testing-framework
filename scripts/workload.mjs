#!/usr/bin/env node
// CLI over scripts/lib/workload.mjs -- a module's k6 workload under artifacts/<product>/modules/<m>/k6/ (G7). Uses the
// product's active run (state/run.json: the mode; state/config.resolved.json: the k6 section). Never sends a request
// to the product and never runs k6.
//
//   workload.mjs build <product> <module> [--run <run-id>]   the human-approved @performance test cases (the only
//                                                            source of load, D-068) + the api-discovery
//                                                            catalogue + k6 run-config + workload-overlay.json ->
//                                                            workload.json, workload-coverage.json,
//                                                            workload-registry.json, bound to the run (default: the
//                                                            active run; --run names the active run or a run of the
//                                                            product with a results/<run>/ folder, else an error)
//                                                            (exit 1 on problems; nothing is written then)
//   workload.mjs check <product> <module> [--run <run-id>]   schemas, equal to a fresh build, ids vs registry, the
//                                                            open-model and safety rules; stamps workload-coverage.json
//                                                            `verified` (exit 1 on problems)
//   workload.mjs paths <product> <module>                    the workload's file paths
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, repoRoot, SLUG_RE, validateData } from "./lib/contract.mjs";
import { approvalSummary } from "./lib/testcases.mjs";
import { build, check, workloadPaths } from "./lib/workload.mjs";

function context(product, module, root, runOpt) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  if (runOpt !== undefined && !SLUG_RE.test(runOpt)) throw new Error("--run must be a run id (lowercase kebab-case)");
  const cfg = loadJson(p.configFile);
  const wp = workloadPaths(p.productDir, module);
  // --run names a run of this product: the active run, or a run with a results folder
  const runDir = path.join(p.productDir, "results", runOpt ?? run.runId);
  if (runOpt !== undefined && runOpt !== run.runId && !existsSync(runDir))
    throw new Error(`--run ${runOpt} is neither the active run (${run.runId}) nor a run of '${product}' (${path.relative(root, runDir).replaceAll("\\", "/")} is missing)`);
  // Only cases a human approved exist for the workload (D-053): the approved @performance cases are its only source of
  // load (decision 13), and overlay citations may name approved cases only. The script-built testcases/coverage.json
  // carries each case's endpoint or flow and load.
  const summary = approvalSummary(p.productDir, module);
  const approved = new Set(summary.approved);
  const pick = (c) => Object.fromEntries(["title", "type", "priority", "api", "performance", "endpoint", "flow", "load"].filter((k) => c[k] !== undefined).map((k) => [k, c[k]]));
  const cases = new Map(summary.cases.filter((c) => approved.has(c.id)).map((c) => [c.id, pick(c)]));
  return { wp, opts: { module, cfg, mode: run.mode, runId: runOpt ?? run.runId, cases } };
}

const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

export async function main(argv, { root = repoRoot } = {}) {
  const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { run: { type: "string" } } });
  const [cmd, product, module] = positionals;
  if (!cmd || !product || !module) return { code: 2, out: { errors: ["usage: workload.mjs build|check|paths <product> <module> [--run <run-id>]"] } };
  const { wp, opts } = context(product, module, root, v.run);
  if (cmd === "paths") return { code: 0, out: Object.fromEntries(["workload", "coverage", "registry", "overlay", "cases"].map((k) => [k, rel(root, wp[k])])) };
  if (cmd === "build") {
    if (existsSync(wp.overlay)) {
      const bad = await validateData("workload-overlay", loadJson(wp.overlay));
      if (bad.length) return { code: 1, out: { problems: bad.map((e) => `workload-overlay.json: ${e}`), note: "fix workload-overlay.json; nothing was built" } };
    }
    const r = build(wp, opts);
    return { code: r.problems.length ? 1 : 0, out: { ...(r.summary ?? {}), workload: rel(root, wp.workload), problems: r.problems, notes: r.notes ?? [], next: r.problems.length ? "fix the problems (overlay, run-config or inputs); nothing was written" : "run workload.mjs check" } };
  }
  if (cmd === "check") {
    const problems = await check(wp, validateData, opts);
    const cov = existsSync(wp.coverage) ? loadJson(wp.coverage) : null;
    return { code: problems.length ? 1 : 0, out: { valid: !problems.length, ...(cov?.counts ?? {}), problems } };
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
