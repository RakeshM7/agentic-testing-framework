#!/usr/bin/env node
// CLI over scripts/lib/testcases.mjs -- a module's test cases under artifacts/<product>/modules/<m>/testcases/
// (docs/agent-handoffs.md §3). Uses the product's run (state/run.json + state/config.resolved.json).
//
//   testcases.mjs items <product> <module>     the coverage items (CI ids) the inputs give, by technique
//   testcases.mjs build <product> <module>     cases.json + the inputs -> TC ids, coverage.json (ledger, budget),
//                                              <m>-testcases.<ext>, testcases-summary.md, approval.csv (keeping the
//                                              human's entries for unchanged cases), approval-findings.md
//                                              (exit 1 on overlay problems)
//   testcases.mjs check <product> <module>     every rule: nothing pending, the overlay valid, every case covering an
//                                              item and citing evidence that exists, imported cases quoting their
//                                              document verbatim and (with playwright-ui) linked to the exploration,
//                                              in import mode no case of the writer's own; nothing changed since the build;
//                                              a pass stamps coverage.json `verified`
//   testcases.mjs approve <product> <module>   HUMAN ONLY: approval.csv -> approvals.json, each decision pinned to the
//                                              case's content. Works after the run ended. Needs an interactive
//                                              terminal and the module slug typed to confirm. No agent may run it:
//                                              the guard (scripts/lib/guard.mjs) denies it to every tool call it sees.
//   testcases.mjs review-check <product> <module> --round N
//                                              the reviewer's review.json: schema, a verdict on every current case in
//                                              round N; renders review-findings.md with the derived verdict (pass
//                                              exactly when no blocker or major remains). Exit 1 while incomplete.
//   testcases.mjs status <product> <module>    the totals, the assumption count and the human approvals: which cases
//                                              are approved (only those are automated), rejected, sent back, awaiting
//   testcases.mjs paths <product> <module>     the module's mode (generate, or import: D-066, convert and link the
//                                              human's cases only, generate nothing), its testcases/ files, plus
//                                              `importSource`: the human's test case
//                                              file the run-config names for the module ({file, productLevel, format
//                                              (null: not a framework format, import mode converts it), exists}) or null
//   testcases.mjs import <product> <module> [--file <path>]
//                                              the human's own test case file -> testcases/imported.json, then build:
//                                              --file, else the run-config's modules[].testcases_file, else its
//                                              testcases.import (product-level: each case names its module with
//                                              @module:<slug> or a Module column; the others are skipped). Framework
//                                              formats only (gherkin .feature, csv, testrail csv, markdown-table .md);
//                                              stable keys and TC ids, `source: imported`, malformed cases rejected
//                                              with their line (exit 1, the valid ones still imported). Any other
//                                              document -> {convert: true}: testcase-writer's import mode converts it.
//                                              -> {file, format, imported, ids, rejected, skipped, build, unlinkedUi,
//                                              approved?, next, problems}
//   testcases.mjs import <product> <module> [--file <path>] --approved
//                                              HUMAN ONLY, like approve: also records every imported case approved
//                                              (pinned to its content). Needs an interactive terminal and the module
//                                              slug typed to confirm; the guard denies it to every tool call it sees.
// Exits: 0 ok, 1 problems ({problems} or {errors}), 2 usage.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import yaml from "js-yaml";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { approvalSummary, approve, build, importCases, importFormat, importSource, listItems, reviewFiles, reviewResult, runCheck, testcaseContext, testcaseTotals } from "./lib/testcases.mjs";

const USAGE = "usage: testcases.mjs items|build|check|approve|review-check|status|paths|import <product> <module> [--round N] [--file <path>] [--approved]";
// The run-config the run started from, read from its file (run.json configPath), not the frozen resolved copy.
function configOf(root, ctx) {
  const f = ctx.configPath ? path.resolve(root, ctx.configPath) : null;
  return f && existsSync(f) ? yaml.load(readFileSync(f, "utf8")) : null;
}
const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

// active: build and check need the product's active run; approve only its last run's state (a human approves between runs).
export function context(product, module, root, { active = true } = {}) {
  const p = paths(product, root);
  if (active && !existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  if (!existsSync(p.runFile)) throw new Error(`product '${product}' has no run (state/run.json)`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  return testcaseContext({ root, product, module, run, cfg: loadJson(p.configFile), productDir: p.productDir });
}

// interactive: {isTTY, ask(question) -> answer} for approve; the process's own terminal unless a test injects one.
export async function main(argv, { root = workspaceRoot, interactive } = {}) {
  const [cmd, product, module, ...rest] = argv;
  if (cmd === "import") {
    if (!product || !module) return { code: 2, out: { errors: [USAGE] } };
    let v;
    try {
      ({ values: v } = parseArgs({ args: rest, options: { file: { type: "string" }, approved: { type: "boolean" } } }));
    } catch (e) {
      return { code: 2, out: { errors: [e.message, USAGE] } };
    }
    const ctx = context(product, module, root, { active: false });
    return importCases(ctx, validateData, { file: v.file, config: configOf(root, ctx), approved: !!v.approved, ...(interactive ? { interactive } : {}) });
  }
  const round = cmd === "review-check" && rest.length === 2 && rest[0] === "--round" && /^[1-9]\d*$/.test(rest[1]) ? Number(rest[1]) : null;
  if (!cmd || !product || !module || (rest.length && round === null) || (cmd === "review-check" && round === null)) return { code: 2, out: { errors: [USAGE] } };
  if (cmd === "approve") return approve(context(product, module, root, { active: false }), validateData, interactive ? { interactive } : {});
  if (cmd === "status") {
    const c = context(product, module, root, { active: false });
    const { approved } = approvalSummary(c.productDir, module);
    return { code: 0, out: { ...testcaseTotals(c), approved } };
  }
  const ctx = context(product, module, root);
  if (cmd === "review-check") {
    const file = reviewFiles(ctx.productDir, ctx.runId, module).review;
    const bad = existsSync(file) ? await validateData("testcases-review", loadJson(file)) : [];
    if (bad.length) return { code: 1, out: { complete: false, problems: bad.map((e) => `review.json: ${e}`) } };
    const r = reviewResult(ctx, { round });
    return { code: r.complete ? 0 : 1, out: { ...r, file: r.file && rel(root, r.file) } };
  }
  if (cmd === "items") return { code: 0, out: listItems(ctx) };
  if (cmd === "build") return build(ctx, validateData);
  if (cmd === "check") {
    const r = await runCheck(ctx, validateData);
    return { code: r.valid ? 0 : 1, out: r };
  }
  if (cmd === "paths") {
    const { tp } = ctx;
    // the human's test case file the run-config names (testcase-writer's import mode converts or links it): null when none
    const src = importSource(ctx, { config: configOf(root, ctx) });
    return {
      code: 0,
      out: {
        mode: ctx.mode,
        overlay: rel(root, tp.overlay), file: rel(root, tp.file(ctx.format)), summary: rel(root, tp.summary), coverage: rel(root, tp.coverage),
        approvalFindings: rel(root, tp.approvalFindings), approvalCsv: rel(root, tp.approvalCsv), approvals: rel(root, tp.approvals),
        registry: { items: rel(root, tp.registry.items), cases: rel(root, tp.registry.cases) },
        imported: rel(root, tp.imported),
        importSource: src.error ? null : { file: rel(root, src.file), productLevel: src.productLevel, format: importFormat(src.file) ?? null, exists: existsSync(src.file) },
      },
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
