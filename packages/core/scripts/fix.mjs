#!/usr/bin/env node
// CLI over scripts/lib/fix.mjs -- the fixers' accountability (G9). Uses the product's active run. Never runs anything
// against the product.
//
//   fix.mjs snapshot <product> <module> <domain> --round N [--source review|triage]
//        sha256 of the domain's owned code files into results/<run>/<m>/<domain>/fix-snapshot.json. orchestration.mjs
//        next takes it (in code) before it spawns a fixer; this command never overwrites a snapshot and is refused once a
//        fixer step of the source has started, so a fixer cannot re-baseline its own edits.
//   fix.mjs check <product> <module> <domain> --round N [--source review|triage]
//        the fixer's fix-report.json (schema fix-report): an entry for EVERY blocker/major finding of review round N
//        (or of its gate) -- source review, the default -- or every healable triage row -- source triage; `fixed` lists
//        files that really changed since the snapshot, `not-fixed` has a reason (disagree-with-cited-reason |
//        needs-product-change | needs-human | out-of-scope) and a text; no managed or generated file changed.
//   fix.mjs paths <product> <module> <domain>   the report and snapshot files
// domain: playwright-ui | playwright-api | k6. Exits: 0 ok, 1 problems, 2 usage.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { FIX_SOURCES, fixCheck, fixPaths, fixSnapshot } from "./lib/fix.mjs";
import { REVIEW_DOMAINS } from "./lib/review.mjs";

const USAGE = `usage: fix.mjs snapshot|check <product> <module> <${REVIEW_DOMAINS.join("|")}> --round N [--source ${FIX_SOURCES.join("|")}] | paths <product> <module> <domain>`;
const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

export function fixContext(product, module, root = workspaceRoot) {
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  const run = loadJson(p.runFile);
  if (!run.modules.includes(module)) throw new Error(`module must be one of [${run.modules.join(", ")}]`);
  return {
    root, product, module, run, runId: run.runId, productDir: p.productDir, stateDir: p.state, pwProject: p.pwProject, k6Project: p.k6Project,
    permissions: existsSync(p.permissionsFile) ? loadJson(p.permissionsFile) : null,
  };
}

export async function main(argv, { root = workspaceRoot } = {}) {
  const [cmd, product, module, domain, ...rest] = argv;
  let round = null;
  let source = "review";
  let bad = !["snapshot", "check", "paths"].includes(cmd) || !product || !module || !REVIEW_DOMAINS.includes(domain);
  if (!bad && cmd === "paths") bad = rest.length > 0;
  else if (!bad) {
    for (let i = 0; i < rest.length; i += 2) {
      if (rest[i] === "--round" && /^[1-9]\d*$/.test(rest[i + 1] ?? "")) round = Number(rest[i + 1]);
      else if (rest[i] === "--source" && FIX_SOURCES.includes(rest[i + 1])) source = rest[i + 1];
      else bad = true;
    }
    if (round === null) bad = true;
  }
  if (bad) return { code: 2, out: { errors: [USAGE] } };
  const ctx = fixContext(product, module, root);
  const fp = fixPaths(ctx.productDir, ctx.runId, module, domain);
  if (cmd === "paths") return { code: 0, out: { report: rel(root, fp.report), snapshot: rel(root, fp.snapshot) } };
  if (cmd === "snapshot") {
    const r = fixSnapshot(ctx, domain, { round, source, cli: true });
    return { code: r.refused ? 1 : 0, out: r.refused ? r : { ...r, file: rel(root, fp.snapshot) } };
  }
  if (existsSync(fp.report)) {
    let data;
    try {
      data = loadJson(fp.report);
    } catch (e) {
      return { code: 1, out: { complete: false, problems: [`fix-report.json is not valid JSON: ${e.message}`] } };
    }
    const errs = await validateData("fix-report", data);
    if (errs.length) return { code: 1, out: { complete: false, problems: errs.map((e) => `fix-report.json: ${e}`) } };
  }
  const r = fixCheck(ctx, domain, { round, source });
  return { code: r.complete ? 0 : 1, out: { ...r, file: rel(root, fp.report) } };
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
