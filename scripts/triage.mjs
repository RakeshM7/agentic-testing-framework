#!/usr/bin/env node
// CLI over scripts/lib/triage.mjs -- the script-built triage of a run's results (G8, D-058). Never runs a test and never
// sends a request. Uses the product's active run (state/run.json).
//
//   triage.mjs prepare <product> <module> --domain ui|api|k6   clears the previous run's stale output (k6: the module's
//                                                              results/<m>-*.summary|created|untracked.json; ui/api:
//                                                              test-results/<side>/<m>/ + <m>-report.json) before a run
//   triage.mjs build   <product> <module> --domain ...         results.json (+ known-issues.json, triage-overlay.json)
//                                                              -> triage.json, triage.md, the BUG registry (exit 1 on
//                                                              input problems; nothing is written then)
//   triage.mjs check   <product> <module> --domain ...         schemas, results unchanged since the build, equal to a
//                                                              fresh build, every row classified, product-bug evidence and
//                                                              expectation, overrides cited, bug drafts; stamps `verified`
//   triage.mjs paths   <product> <module> --domain ...         the triage's file paths
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { DOMAINS, build, check, prepare, triagePaths } from "./lib/triage.mjs";

const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

export async function main(argv, { root = workspaceRoot } = {}) {
  const { values: v, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { domain: { type: "string" } } });
  const [cmd, product, module] = positionals;
  if (!["build", "check", "paths", "prepare"].includes(cmd) || !product || !module || !Object.hasOwn(DOMAINS, v.domain ?? "")) return { code: 2, out: { errors: ["usage: triage.mjs build|check|paths|prepare <product> <module> --domain ui|api|k6"] } };
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  const ctx = { root, product, module, domain: v.domain, run, productDir: p.productDir, pwProject: p.pwProject, k6Project: p.k6Project };
  const tp = triagePaths(p.productDir, module, run.runId, v.domain);
  if (cmd === "paths") return { code: 0, out: Object.fromEntries(["results", "triage", "md", "overlay", "registry", "knownIssues"].map((k) => [k, rel(root, tp[k])])) };
  if (cmd === "prepare") return { code: 0, out: prepare(ctx) };
  if (cmd === "build") {
    const r = await build(ctx, validateData);
    return { code: r.problems.length ? 1 : 0, out: { ...(r.summary ?? {}), triage: rel(root, tp.triage), problems: r.problems, ...(r.overlayProblems?.length ? { overlayProblems: r.overlayProblems } : {}), next: r.problems.length ? "fix the problems; nothing was written" : r.overlayProblems?.length ? "classify the open rows and fix the overlay problems in triage-overlay.json, build again, then check" : "run triage.mjs check" } };
  }
  const problems = await check(ctx, validateData);
  return { code: problems.length ? 1 : 0, out: { valid: !problems.length, problems } };
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
