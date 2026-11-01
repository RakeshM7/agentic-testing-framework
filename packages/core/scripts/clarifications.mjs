#!/usr/bin/env node
// CLI over scripts/lib/clarifications.mjs -- the ONLY way agents write
// artifacts/<product>/modules/<module>/clarifications.csv. The Run ID for new rows comes from the product's
// active run. Humans edit the Answer and Answer status columns directly (in Excel or an editor); agents never overwrite
// a non-empty Answer unless --requirement-change.
//
//   clarifications.mjs append    <product> <module> <items.json>   items = [{question, steps}] -> {added: [ids], duplicates}
//   clarifications.mjs list      <product> <module> [--open]       rows (--open = unanswered only)
//   clarifications.mjs set-steps <product> <module> <id> [--question Q] [--steps S]   unanswered rows only
//   clarifications.mjs record    <product> <module> <id> --file <outcome.json>
//        clarification-explorer: checks the outcome against the row's evidence (docs/agent-handoffs.md §2), then writes
//        the Answer (agent-proposed) or notes, appends its followUps, and writes clarification-evidence/<id>/record.json.
//        -> {id, verdict, answerStatus, followUps} | exit 1 {errors} with every problem, and nothing written
//   clarifications.mjs record    <product> <module> <id> [--answer A] [--notes N] [--requirement-change]
//        module-explorer's requirement changes
//   clarifications.mjs status    <product> [<module>]              {total, answered, proposed[], unconfirmed[]} per module
//   clarifications.mjs summary   <product> <module>                writes clarifications-summary.md from the CSV
//                                                                  -> {file, total, answered, proposed, unconfirmed: [{id, next}]}
import "./lib/node-gate.mjs"; // first: on a Node.js older than 20, runs this command again under a newer one
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadJson, paths } from "./lib/contract.mjs";
import { append, csvPath, isAnswered, readRows, record, recordOutcome, renderSummary, setSteps, status } from "./lib/clarifications.mjs";
import { knowledgePaths, readRegistry } from "./lib/knowledge.mjs";
import { read as readLedger } from "./lib/ledger.mjs";

const [cmd, product, ...rest] = process.argv.slice(2);
const { values: v, positionals: pos } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: {
    question: { type: "string" },
    steps: { type: "string" },
    answer: { type: "string" },
    notes: { type: "string" },
    file: { type: "string" },
    "requirement-change": { type: "boolean" },
    open: { type: "boolean" },
  },
});
const out = (x, code = 0) => {
  console.log(JSON.stringify(x, null, 2));
  process.exit(code);
};
if (!cmd || !product) {
  console.error("usage: clarifications.mjs append|list|set-steps|record|status|summary <product> ... (see header comment)");
  process.exit(2);
}
const p = paths(product);
const activeRun = () => {
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  return loadJson(p.runFile);
};

try {
  const [module, arg] = pos;
  const file = module ? csvPath(p.productDir, module) : null;
  if (cmd === "append") out(append(file, module, activeRun().runId, JSON.parse(readFileSync(path.resolve(arg), "utf8"))));
  else if (cmd === "list") out(readRows(file).filter((r) => !v.open || !isAnswered(r)));
  else if (cmd === "set-steps") out(setSteps(file, arg, { question: v.question, steps: v.steps }));
  else if (cmd === "record" && v.file) {
    if (v.answer !== undefined || v.notes !== undefined || v["requirement-change"]) throw new Error("--file records the whole outcome; it takes no --answer, --notes or --requirement-change");
    const run = activeRun();
    const outcome = JSON.parse(readFileSync(path.resolve(v.file), "utf8"));
    const sourceIds = new Set(readRegistry(knowledgePaths(p.productDir)).map((s) => s.id));
    out(recordOutcome(file, outcome, { id: arg, module, runId: run.runId, mode: run.mode, ledgerEntries: readLedger(p.ledgerFile), sourceIds, productDir: p.productDir }));
  } else if (cmd === "record") out(record(file, arg, { answer: v.answer, notes: v.notes, runId: activeRun().runId, requirementChange: v["requirement-change"] }));
  else if (cmd === "status") {
    const modulesDir = path.join(p.productDir, "modules");
    const mods = module ? [module] : existsSync(modulesDir) ? readdirSync(modulesDir) : [];
    out(Object.fromEntries(mods.filter((m) => existsSync(csvPath(p.productDir, m))).map((m) => [m, status(csvPath(p.productDir, m))])));
  } else if (cmd === "summary") {
    if (!module) throw new Error("summary needs <module>");
    out(renderSummary(file, module));
  }
  else out({ errors: [`unknown command ${cmd}`] }, 2);
} catch (e) {
  out({ errors: [e.message] }, 1);
}
