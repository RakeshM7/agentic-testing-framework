#!/usr/bin/env node
// CLI over scripts/lib/ledger.mjs -- artifacts/<product>/state/ledger.jsonl. The run id is taken from the
// product's active run (state/run.json); agents never pass it themselves.
//   ledger.mjs add     <product> --type T --ref R --module M --stage S --agent A [--label L] [--url U] [--note N]
//   ledger.mjs deleted <product> --type T --ref R --module M --stage S --agent A [--note N]
//   ledger.mjs owns    <product> --type T --ref R   exit 0 only if the CURRENT run created it and it is still live
//   ledger.mjs list    <product> [--live] [--all-runs]   --live = cleanup worklist (current run unless --all-runs)
// Agents MUST run `owns` before any delete/cancel/remove, and `add` immediately after creating anything.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { loadJson, paths } from "./lib/contract.mjs";
import { append, live, owns, read } from "./lib/ledger.mjs";

const [cmd, product, ...rest] = process.argv.slice(2);
const { values: v } = parseArgs({
  args: rest,
  options: {
    type: { type: "string" }, ref: { type: "string" }, module: { type: "string" }, stage: { type: "string" },
    agent: { type: "string" }, label: { type: "string" }, url: { type: "string" }, note: { type: "string" },
    live: { type: "boolean" }, "all-runs": { type: "boolean" },
  },
});
if (!cmd || !product) {
  console.error("usage: ledger.mjs add|deleted|owns|list <product> [options]");
  process.exit(2);
}
const p = paths(product);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));

try {
  const active = existsSync(p.lockFile);
  const runId = existsSync(p.runFile) ? loadJson(p.runFile).runId : undefined;
  if (cmd === "add" || cmd === "deleted") {
    if (!active) throw new Error(`no active run for product '${product}'`);
    const entry = append(p.ledgerFile, clean({ runId, event: cmd === "add" ? "created" : "deleted", type: v.type, ref: v.ref, module: v.module, stage: v.stage, agent: v.agent, label: v.label, url: v.url, note: v.note }));
    console.log(JSON.stringify(entry));
  } else if (cmd === "owns") {
    process.exit(active && owns(p.ledgerFile, runId, v.type, v.ref) ? 0 : 1);
  } else if (cmd === "list") {
    const scope = v["all-runs"] ? undefined : runId;
    console.log(JSON.stringify(v.live ? live(p.ledgerFile, scope) : read(p.ledgerFile).filter((e) => !scope || e.runId === scope), null, 2));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
