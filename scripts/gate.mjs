#!/usr/bin/env node
// Pre-review gate: the mechanical checks a reviewer used to do by reading, run as code before the reviewer is
// started. Writes artifacts/<product>/results/<run-id>/<module>/<domain>/gate-findings.md in the review-findings
// format (docs/agent-handoffs.md §6). On `changes-required` the domain orchestrator hands that file to the writer or
// fixer instead of starting the reviewer. Never runs anything against the product.
//
//   gate.mjs <product> <module> testcases|playwright-ui|playwright-api|k6 [--static]
//        -> {verdict, file, counts}; exit 0 = pass, 1 = changes-required, 2 = usage/state error
//   --static skips the compile/list/inspect commands (tsc, playwright --list, k6 inspect).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, repoRoot } from "./lib/contract.mjs";
import { writeAtomic } from "./lib/csv.mjs";
import { SEVERITIES, renderFindings } from "./lib/gate/common.mjs";
import { gateK6 } from "./lib/gate/k6.mjs";
import { gatePlaywright } from "./lib/gate/playwright.mjs";
import { gateTestcases } from "./lib/gate/testcases.mjs";

export const GATED = ["testcases", "playwright-ui", "playwright-api", "k6"];

export function gate(product, module, domain, { root = repoRoot, compile = true } = {}) {
  if (!GATED.includes(domain)) throw new Error(`domain must be one of [${GATED}]`);
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules}]`);
  const cfg = existsSync(p.configFile) ? loadJson(p.configFile) : {};
  const format = cfg.testcases?.output_format ?? "gherkin";
  const ctx = { root, product, run, cfg, productDir: p.productDir, module, format, compile, pwProject: p.pwProject, k6Project: p.k6Project };

  const findings =
    domain === "testcases" ? gateTestcases(ctx)
    : domain === "k6" ? gateK6(ctx)
    : gatePlaywright({ ...ctx, side: domain === "playwright-ui" ? "ui" : "api" });
  findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));

  const { verdict, text } = renderFindings(domain, module, findings);
  const file = path.join(p.results(run.runId), module, domain, "gate-findings.md");
  writeAtomic(file, text);
  const counts = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
  return { verdict, file: path.relative(root, file).replaceAll("\\", "/"), counts };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { static: { type: "boolean" } } });
  const [product, module, domain] = positionals;
  if (!product || !module || !domain) {
    console.error(`usage: gate.mjs <product> <module> ${GATED.join("|")} [--static]`);
    process.exit(2);
  }
  try {
    const r = gate(product, module, domain, { compile: !values.static });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.verdict === "pass" ? 0 : 1);
  } catch (e) {
    console.log(JSON.stringify({ errors: [e.message] }, null, 2));
    process.exit(2);
  }
}
