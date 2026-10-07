#!/usr/bin/env node
// CLI over scripts/lib/clarifications.mjs -- the ONLY way agents write
// artifacts/<product>/modules/<module>/clarifications.csv. The Run ID for new rows comes from the product's
// active run. Humans edit the Answer column directly (in Excel or an editor); agents never overwrite a non-empty
// Answer unless --requirement-change.
//
//   clarifications.mjs append    <product> <module> <items.json>   items = [{question, steps}] -> {added: [ids], duplicates}
//   clarifications.mjs list      <product> <module> [--open]       rows (--open = unanswered only)
//   clarifications.mjs set-steps <product> <module> <id> [--question Q] [--steps S]   question-writer, unanswered rows only
//   clarifications.mjs record    <product> <module> <id> [--answer A] [--notes N] [--requirement-change]
//   clarifications.mjs status    <product> [<module>]              {total, answered, unconfirmed[]} per module
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadJson, paths } from "./lib/contract.mjs";
import { append, csvPath, isAnswered, readRows, record, setSteps, status } from "./lib/clarifications.mjs";

const [cmd, product, ...rest] = process.argv.slice(2);
const { values: v, positionals: pos } = parseArgs({
  args: rest,
  allowPositionals: true,
  options: { question: { type: "string" }, steps: { type: "string" }, answer: { type: "string" }, notes: { type: "string" }, "requirement-change": { type: "boolean" }, open: { type: "boolean" } },
});
const out = (x, code = 0) => {
  console.log(JSON.stringify(x, null, 2));
  process.exit(code);
};
if (!cmd || !product) {
  console.error("usage: clarifications.mjs append|list|set-steps|record|status <product> ... (see header comment)");
  process.exit(2);
}
const p = paths(product);
const activeRunId = () => {
  if (!existsSync(p.lockFile)) throw new Error(`no active run for product '${product}'`);
  return loadJson(p.runFile).runId;
};

try {
  const [module, arg] = pos;
  const file = module ? csvPath(p.productDir, module) : null;
  if (cmd === "append") out(append(file, module, activeRunId(), JSON.parse(readFileSync(path.resolve(arg), "utf8"))));
  else if (cmd === "list") out(readRows(file).filter((r) => !v.open || !isAnswered(r)));
  else if (cmd === "set-steps") out(setSteps(file, arg, { question: v.question, steps: v.steps }));
  else if (cmd === "record") out(record(file, arg, { answer: v.answer, notes: v.notes, runId: activeRunId(), requirementChange: v["requirement-change"] }));
  else if (cmd === "status") {
    const modulesDir = path.join(p.productDir, "modules");
    const mods = module ? [module] : existsSync(modulesDir) ? readdirSync(modulesDir) : [];
    out(Object.fromEntries(mods.filter((m) => existsSync(csvPath(p.productDir, m))).map((m) => [m, status(csvPath(p.productDir, m))])));
  } else out({ errors: [`unknown command ${cmd}`] }, 2);
} catch (e) {
  out({ errors: [e.message] }, 1);
}
