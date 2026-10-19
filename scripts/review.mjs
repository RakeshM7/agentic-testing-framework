#!/usr/bin/env node
// CLI over scripts/lib/review.mjs -- the per-test review of a code domain (G9) and, for `testcases`, the G3 per-case
// review (delegated to testcases.mjs review-check). Uses the product's active run. Never runs anything against the product.
//
//   review.mjs check <product> <module> <domain> --round N
//        domain: playwright-ui | playwright-api | k6 | testcases. The reviewer's results/<run>/<m>/<domain>/review.json
//        (schema review): a verdict on every dimension (intent, assertion, flakiness, data-safety) of EVERY test of the
//        module in round N, every finding with a real file:line, no code edited since. A pass derives the verdict (pass
//        exactly when no blocker or major remains), renders review-findings.md and stamps review-check.json.
//   review.mjs render <product> <module> <domain>
//        re-renders review-findings.md from a review.json whose stamp is still fresh
//   review.mjs paths <product> <module> <domain>   the review's files
// Exits: 0 ok, 1 problems, 2 usage.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, paths, repoRoot, validateData } from "./lib/contract.mjs";
import { REVIEW_DOMAINS, reviewCheck, reviewPaths, reviewRender } from "./lib/review.mjs";
import { main as testcasesMain } from "./testcases.mjs";

const DOMAINS = [...REVIEW_DOMAINS, "testcases"];
const USAGE = `usage: review.mjs check <product> <module> <${DOMAINS.join("|")}> --round N | render <product> <module> <domain> | paths <product> <module> <domain>`;
const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

function context(product, module, root) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  return { root, product, module, run, runId: run.runId, productDir: p.productDir, pwProject: p.pwProject, k6Project: p.k6Project };
}

export async function main(argv, { root = repoRoot } = {}) {
  const [cmd, product, module, domain, ...rest] = argv;
  const round = cmd === "check" && rest.length === 2 && rest[0] === "--round" && /^[1-9]\d*$/.test(rest[1]) ? Number(rest[1]) : null;
  const bad = !["check", "render", "paths"].includes(cmd) || !product || !module || !DOMAINS.includes(domain) || (cmd === "check" ? round === null : rest.length > 0);
  if (bad) return { code: 2, out: { errors: [USAGE] } };
  if (domain === "testcases") {
    if (cmd === "check") return testcasesMain(["review-check", product, module, "--round", String(round)], { root });
    const ctx = context(product, module, root);
    const rp = { review: path.join(ctx.productDir, "results", ctx.runId, module, "testcases", "review.json"), findings: path.join(ctx.productDir, "results", ctx.runId, module, "testcases", "review-findings.md") };
    return { code: 0, out: { review: rel(root, rp.review), findings: rel(root, rp.findings) } };
  }
  const ctx = context(product, module, root);
  const rp = reviewPaths(ctx.productDir, ctx.runId, module, domain);
  if (cmd === "paths") return { code: 0, out: { review: rel(root, rp.review), findings: rel(root, rp.findings), state: rel(root, rp.state) } };
  if (cmd === "render") {
    const r = reviewRender(ctx, domain);
    return { code: r.complete ? 0 : 1, out: { ...r, file: rel(root, rp.findings) } };
  }
  if (existsSync(rp.review)) {
    let data;
    try {
      data = loadJson(rp.review);
    } catch (e) {
      return { code: 1, out: { complete: false, problems: [`review.json is not valid JSON: ${e.message}`] } };
    }
    const errs = await validateData("review", data);
    if (errs.length) return { code: 1, out: { complete: false, problems: errs.map((e) => `review.json: ${e}`) } };
  }
  const r = reviewCheck(ctx, domain, { round });
  return { code: r.complete ? 0 : 1, out: { ...r, file: rel(root, rp.findings) } };
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
