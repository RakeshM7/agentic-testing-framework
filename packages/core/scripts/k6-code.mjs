#!/usr/bin/env node
// CLI over scripts/lib/k6-code.mjs -- a module's k6 scripts, generated from its verified workload (G7). The
// k6-script-writer's own command (the workload designer's is workload.mjs). Uses the product's active run. Never sends
// a request and never runs load; `k6 inspect` (offline) runs in check only when k6 is on PATH, and never under tests.
//
//   k6-code.mjs build <product> <module> [--adopt]
//                       requires a verified, current workload (workload.mjs build + check). Then: one managed script
//                       per workload scenario (k6-tests/<p>/scripts/<m>-<name>.js), the slot file
//                       k6-tests/<p>/scripts/slots/<m>.js re-rendered around the agent's slot bodies (a body whose slot
//                       is gone is parked in k6/parked.json and comes back with its slot), k6/code-plan.json. A generated
//                       script no scenario names any more is removed; --adopt also moves hand-written <m>-*.js files to
//                       artifacts/<p>/modules/<m>/k6/legacy/.
//   k6-code.mjs check <product> <module>
//                       the workload verified; options and thresholds equal to workload.json, dropped_iterations,
//                       requireFullRun(<mutates>), no write in a readonly workload, trackLeftover and the delete step,
//                       no hard-coded URL or BASE_URL, a comment on every sleep(), the endpoint tag on every request, one
//                       script per id (none missing, duplicated or extra), no drift from a fresh render, the slot markers,
//                       the skeleton, the slot scan, every needed slot filled; k6 inspect when available. A pass stamps
//                       code-plan.json `verified`.
//   k6-code.mjs paths <product> <module>   the managed and the agent-writable paths
// Exits: 0 ok, 1 problems, 2 usage.
import "./lib/node-gate.mjs"; // first: on a Node.js older than 20, runs this command again under a newer one
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { build, check, computeModel, k6CodeContext, k6CodePaths } from "./lib/k6-code.mjs";

const USAGE = "usage: k6-code.mjs build <product> <module> [--adopt] | check <product> <module> | paths <product> <module>";

function context(product, module, root) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  return k6CodeContext({ root, product, module, run, productDir: p.productDir, k6Project: p.k6Project });
}

// inspect: (file, cwd) -> {out} | {error}, or a string (skipped, why); injected by tests.
export async function main(argv, { root = workspaceRoot, inspect } = {}) {
  const [cmd, product, module, ...rest] = argv;
  const allowed = { build: ["--adopt"] }[cmd] ?? [];
  if (!cmd || !product || !module || rest.some((f) => !allowed.includes(f))) return { code: 2, out: { errors: [USAGE] } };
  const ctx = context(product, module, root);
  if (cmd === "paths") {
    const m = existsSync(ctx.wp.workload) ? computeModel(ctx) : null;
    return { code: 0, out: k6CodePaths(ctx, m?.scripts ? m : null) };
  }
  if (cmd === "build") return build(ctx, validateData, { adopt: rest.includes("--adopt") });
  if (cmd === "check") {
    const r = await check(ctx, validateData, inspect === undefined ? {} : { inspect });
    return { code: r.problems.length ? 1 : 0, out: { valid: !r.problems.length, inspect: r.inspect, ...(r.slots ? { slots: r.slots } : {}), problems: r.problems } };
  }
  return { code: 2, out: { errors: [`unknown command ${cmd}`, USAGE] } };
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
