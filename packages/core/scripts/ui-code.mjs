#!/usr/bin/env node
// CLI over scripts/lib/ui-code.mjs -- a module's UI test code, scaffolded per approved test case and required page
// template (D-055; docs/agent-handoffs.md §11). Uses the product's active run (state/run.json +
// state/config.resolved.json). Never touches the product.
//
//   ui-code.mjs build <product> <module>     the approved cases + the exploration -> ui-code/plan.json and coverage.json
//                                            (the ledger), the cases spec skeleton (keeping every region's body; a body
//                                            whose test is gone is parked and comes back with it), a class shell for
//                                            each missing page object, the fixture registration and the locator smoke.
//                                            Unapproved cases are reported as awaiting approval and never generated.
//   ui-code.mjs check <product> <module> [--pages] [--static]
//                                            --pages: the page objects (present, their class, every locator name
//                                            verbatim in a snapshot of their template, selectors only with a cited
//                                            reason, no assertion or fixed wait), the registration and its use in
//                                            fixtures/ui/index.ts, the smoke up to date, and tsc. Without it: also the
//                                            cases spec (the skeleton intact, no empty step, an assertion in each
//                                            expected-result step, toHaveScreenshot for @visual, recordCreated for
//                                            @mutates, no extra test) and every gate rule (scripts/lib/gate/playwright.mjs),
//                                            with tsc and playwright --list. A pass stamps coverage.json `verified`;
//                                            --static skips the compile commands and stamps nothing.
//   ui-code.mjs paths <product> <module>     the files the writers read and write
// Exits: 0 ok, 1 problems ({problems} or {errors}), 2 usage.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { finding, run as runCommand, walk } from "./lib/gate/common.mjs";
import { codeFindings, gatePlaywright } from "./lib/gate/playwright.mjs";
import { build, buildProblems, clearStamp, recordParked, stampCheck, uiCodeContext, uiCodeFindings, uiCodePathsOut } from "./lib/ui-code.mjs";

const USAGE = "usage: ui-code.mjs build|check|paths <product> <module> [--pages] [--static]";

function context(product, module, root) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  const cfg = loadJson(p.configFile);
  return { p, run, cfg, ctx: uiCodeContext({ root, product, module, run, cfg, productDir: p.productDir, pwProject: p.pwProject }) };
}

const line = (f) => `${f.file}${f.line ? `:${f.line}` : ""} [${f.rule}] ${f.problem} -- ${f.fix}`;

// exec(cmd, args, cwd) -> null | error, listTests(cwd, side, module) -> {report} | {error}: the compile commands, injected by tests.
export async function main(argv, { root = workspaceRoot, exec, listTests } = {}) {
  const [cmd, product, module, ...rest] = argv;
  const flags = new Set(rest);
  if (!cmd || !product || !module || rest.some((f) => !["--pages", "--static"].includes(f)) || (cmd !== "check" && rest.length)) return { code: 2, out: { errors: [USAGE] } };
  const { p, run, cfg, ctx } = context(product, module, root);
  if (cmd === "paths") return { code: 0, out: uiCodePathsOut(ctx) };
  if (cmd === "build") return build(ctx, validateData);
  if (cmd === "check") {
    const scope = flags.has("--pages") ? "pages" : "tests";
    const compile = !flags.has("--static");
    const problems = buildProblems(ctx);
    let findings = [];
    if (!problems.length) {
      if (compile && !existsSync(path.join(ctx.pwProject, "package.json"))) problems.push(`playwright-tests/${product}/package.json is missing: the Playwright repo must be rendered first (foundation.mjs --side repo)`);
      if (scope === "pages") {
        const objects = `pages/${module}`;
        findings = [...uiCodeFindings(ctx, { scope }), ...codeFindings(ctx.pwProject, walk(ctx.pwProject, objects, /\.ts$/), objects, "ui")];
        if (compile && !problems.length) {
          const tsc = (exec ?? runCommand)("npx", ["tsc", "--noEmit"], ctx.pwProject);
          if (tsc) findings.push(finding("blocker", "tsconfig.json", null, "typecheck", `npx tsc --noEmit failed: ${tsc}`, "fix the type errors"));
        }
      } else findings = gatePlaywright({ root, product, run, cfg, productDir: p.productDir, module, side: "ui", compile: compile && !problems.length, pwProject: p.pwProject, k6Project: p.k6Project, exec, listTests });
    }
    problems.push(...findings.filter((f) => f.severity !== "minor").map(line));
    const parked = scope === "tests" && !buildProblems(ctx).length ? recordParked(ctx) : [];
    const valid = !problems.length;
    const stamped = valid && compile;
    if (stamped) stampCheck(ctx, scope);
    else if (!valid) clearStamp(ctx, scope);
    return {
      code: valid ? 0 : 1,
      out: { valid, scope, stamped, ...(compile ? {} : { note: "--static: the compile commands did not run, so nothing was stamped" }), parked, minor: findings.filter((f) => f.severity === "minor").map(line), problems },
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
