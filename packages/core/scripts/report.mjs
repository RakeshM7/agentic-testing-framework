#!/usr/bin/env node
// CLI over scripts/lib/report.mjs -- the run report (G11). The report is rendered from report.json (report-data.mjs),
// and the report-generator writes only a cited narrative. Uses the product's run state (the run need not be active).
//
//   report.mjs render <product>   index.html from report.json and narrative.json (the narrative is optional here; the
//                                 deck then has no summary, risk or recommendation slides). Deterministic: the same
//                                 inputs give the same bytes. No network, no CDN: one self-contained file.
//   report.mjs check <product>    report.json valid and of this run; narrative.json valid (schema report-narrative); every
//                                 cited path exists in report.json and every number in a statement equals a number at a
//                                 cited path; index.html is exactly what render makes of the two. A pass stamps
//                                 report-check.json (the `report` stage requires the stamp); a failure removes it.
//   report.mjs paths <product>    the files of the report
// Exits: 0 ok, 1 problems, 2 usage.
import "./lib/node-gate.mjs"; // first: on a Node.js older than 20, runs this command again under a newer one
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadJson, paths, workspaceRoot, validateData } from "./lib/contract.mjs";
import { writeAtomic, writeJson } from "./lib/files.mjs";
import { narrativeProblems, renderDeck, reportPaths, stampReport } from "./lib/report.mjs";

const USAGE = "usage: report.mjs render <product> | check <product> | paths <product>";
const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

function readInput(file, schema, label) {
  if (!existsSync(file)) return { problems: [`${label} is missing`] };
  let data;
  try {
    data = loadJson(file);
  } catch (e) {
    return { problems: [`${label} is not valid JSON: ${e.message}`] };
  }
  return validateData(schema, data).then((errs) => (errs.length ? { problems: errs.map((e) => `${label}: ${e}`) } : { data, problems: [] }));
}

export async function main(argv, { root = workspaceRoot } = {}) {
  const [cmd, product, ...rest] = argv;
  if (!["render", "check", "paths"].includes(cmd) || !product || rest.length) return { code: 2, out: { errors: [USAGE] } };
  const p = paths(product, root);
  if (!existsSync(p.runFile)) throw new Error(`no run state for product '${product}'`);
  const run = loadJson(p.runFile);
  const rp = reportPaths(p.productDir, run.runId);
  const files = { report: rel(root, rp.report), narrative: rel(root, rp.narrative), html: rel(root, rp.html), state: rel(root, rp.state) };
  if (cmd === "paths") return { code: 0, out: files };

  const report = await readInput(rp.report, "report", "report.json");
  const narrative = existsSync(rp.narrative) || cmd === "check" ? await readInput(rp.narrative, "report-narrative", "narrative.json") : { data: null, problems: [] };
  const problems = [...report.problems, ...narrative.problems];
  if (report.data && report.data.runId !== run.runId) problems.push(`report.json is of run ${report.data.runId}, not ${run.runId}: run report-data.mjs again`);
  if (report.data && narrative.data) problems.push(...narrativeProblems(report.data, narrative.data));

  if (cmd === "render") {
    if (problems.length) return { code: 1, out: { rendered: false, problems } };
    writeAtomic(rp.html, renderDeck(report.data, narrative.data));
    return { code: 0, out: { rendered: true, file: files.html, narrative: !!narrative.data, next: narrative.data ? "run report.mjs check" : "write narrative.json, render again, then check" } };
  }
  // check
  if (!problems.length) {
    if (!existsSync(rp.html)) problems.push("index.html is missing: run report.mjs render");
    else if (readFileSync(rp.html, "utf8") !== renderDeck(report.data, narrative.data)) problems.push("index.html is not what render makes of report.json and narrative.json (edited by hand, or an input changed): run report.mjs render");
  }
  if (problems.length) {
    rmSync(rp.state, { force: true });
    return { code: 1, out: { valid: false, problems } };
  }
  writeJson(rp.state, { product, runId: run.runId, verified: stampReport(rp) });
  return { code: 0, out: { valid: true, problems: [], file: files.html, stamp: files.state } };
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
