#!/usr/bin/env node
// CLI over scripts/lib/api-code.mjs -- a module's Playwright API code, generated from the endpoint catalogue and the
// verified API plan (D-056; docs/agent-handoffs.md §12). Uses the product's active run (state/run.json +
// state/config.resolved.json). Never sends a request to the product.
//
//   api-code.mjs build <product> <module> [--adopt]
//                                            --adopt: first move every file a build did not make out of the generated
//                                            folders (an older module's hand-written specs or clients) into
//                                            api-code/legacy/. Then: the catalogue + the plan + the overlays -> api-code/plan.json and coverage.json
//                                            (the ledger); the clients, types, schemas, support and registration; one
//                                            literal test per plan scenario in tests/api/<m>/<resource>.spec.ts; the
//                                            payload and glue slot files around the tests-writer's slots (every slot's
//                                            body is kept; a body whose slot is gone is parked and comes back with it);
//                                            the composite helpers file, seeded once.
//   api-code.mjs check <product> <module> [--clients] [--static]
//                                            --clients: the generated client files unedited, the client overlay applied,
//                                            the composite helpers' rules, the registration in fixtures/api/index.ts, and
//                                            tsc. Without it: also the specs (one test per scenario, titles and tags,
//                                            fixme for blocked, the ledger, no raw request), every payload and glue slot
//                                            filled under its rules, and every gate rule (scripts/lib/gate/playwright.mjs)
//                                            with tsc and playwright --list. A pass stamps coverage.json `verified`;
//                                            --static skips the compile commands and stamps nothing.
//   api-code.mjs paths <product> <module>     the files the writers read and write
// Exits: 0 ok, 1 problems ({problems} or {errors}), 2 usage.
import "./lib/node-gate.mjs"; // first: on a Node.js older than 20, runs this command again under a newer one
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { apiCodeContext, apiCodeFindings, apiCodePathsOut, build, buildProblems, clearStamp, recordSlots, stampCheck } from "./lib/api-code.mjs";
import { finding, run as runCommand, walk } from "./lib/gate/common.mjs";
import { codeFindings, gatePlaywright } from "./lib/gate/playwright.mjs";

const USAGE = "usage: api-code.mjs build <product> <module> [--adopt] | check <product> <module> [--clients] [--static] | paths <product> <module>";

function context(product, module, root) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  const cfg = loadJson(p.configFile);
  return { p, run, cfg, ctx: apiCodeContext({ root, product, module, run, cfg, productDir: p.productDir, pwProject: p.pwProject }) };
}

const line = (f) => `${f.file}${f.line ? `:${f.line}` : ""} [${f.rule}] ${f.problem} -- ${f.fix}`;

// exec(cmd, args, cwd) -> null | error, listTests(cwd, side, module) -> {report} | {error}: the compile commands, injected by tests.
export async function main(argv, { root = workspaceRoot, exec, listTests } = {}) {
  const [cmd, product, module, ...rest] = argv;
  const flags = new Set(rest);
  const allowed = { check: ["--clients", "--static"], build: ["--adopt"] }[cmd] ?? [];
  if (!cmd || !product || !module || rest.some((f) => !allowed.includes(f))) return { code: 2, out: { errors: [USAGE] } };
  const { p, run, cfg, ctx } = context(product, module, root);
  if (cmd === "paths") return { code: 0, out: apiCodePathsOut(ctx) };
  if (cmd === "build") return build(ctx, validateData, { adopt: flags.has("--adopt") });
  if (cmd === "check") {
    const scope = flags.has("--clients") ? "clients" : "tests";
    const compile = !flags.has("--static");
    const problems = buildProblems(ctx);
    let findings = [];
    if (!problems.length) {
      if (compile && !existsSync(path.join(ctx.pwProject, "package.json"))) problems.push(`playwright-tests/${product}/package.json is missing: the Playwright repo must be rendered first (foundation.mjs --side repo)`);
      if (scope === "clients") {
        const clients = `clients/${module}`;
        findings = [...apiCodeFindings(ctx, { scope }), ...codeFindings(ctx.pwProject, walk(ctx.pwProject, clients, /\.ts$/), clients, "api")];
        if (compile && !problems.length) {
          const tsc = (exec ?? runCommand)("npx", ["tsc", "--noEmit"], ctx.pwProject);
          if (tsc) findings.push(finding("blocker", "tsconfig.json", null, "typecheck", `npx tsc --noEmit failed: ${tsc}`, "fix the type errors"));
        }
      } else findings = gatePlaywright({ root, product, run, cfg, productDir: p.productDir, module, side: "api", compile: compile && !problems.length, pwProject: p.pwProject, k6Project: p.k6Project, exec, listTests });
    }
    problems.push(...findings.filter((f) => f.severity !== "minor").map(line));
    const slots = buildProblems(ctx).length ? null : recordSlots(ctx);
    const valid = !problems.length;
    const stamped = valid && compile;
    if (stamped) stampCheck(ctx, scope);
    else if (!valid) clearStamp(ctx, scope);
    return {
      code: valid ? 0 : 1,
      out: { valid, scope, stamped, ...(compile ? {} : { note: "--static: the compile commands did not run, so nothing was stamped" }), ...(slots ? { slots } : {}), minor: findings.filter((f) => f.severity === "minor").map(line), problems },
    };
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
