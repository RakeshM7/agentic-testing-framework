#!/usr/bin/env node
// CLI over scripts/lib/ledger.mjs -- artifacts/<product>/state/ledger.jsonl. The run id is taken from the
// product's active run (state/run.json); agents never pass it themselves.
//   ledger.mjs add     <product> --type T --ref R --module M --stage S --agent A [--label L] [--url U] [--note N]
//                      [--cleanup-endpoint EP-<m>-<n> --cleanup-param P]   the delete that removes it (D-075)
//   ledger.mjs deleted <product> --type T --ref R --module M --stage S --agent A [--note N]
//   ledger.mjs owns    <product> --type T --ref R   exit 0 only if the CURRENT run created it and it is still live
//   ledger.mjs owns    <product> --ref R [--ref R2 ...]   the same for any type and any of the refs (D-074)
//   ledger.mjs list    <product> [--live] [--all-runs]   --live = cleanup worklist (current run unless --all-runs)
//   ledger.mjs sweep   <product> [--run RUN] [--dry-run]   HUMAN-ONLY, between runs: delete what ended runs left (D-075)
// Agents MUST run `owns` before any delete/cancel/remove, and `add` immediately after creating anything.
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { loadJson, paths, workspaceRoot } from "./lib/contract.mjs";
import { append, live, owns, ownsAny, read } from "./lib/ledger.mjs";

const [cmd, product, ...rest] = process.argv.slice(2);
const { values: v } = parseArgs({
  args: rest,
  options: {
    type: { type: "string" }, ref: { type: "string", multiple: true }, module: { type: "string" }, stage: { type: "string" },
    agent: { type: "string" }, label: { type: "string" }, url: { type: "string" }, note: { type: "string" },
    "cleanup-endpoint": { type: "string" }, "cleanup-param": { type: "string" },
    live: { type: "boolean" }, "all-runs": { type: "boolean" }, run: { type: "string" }, "dry-run": { type: "boolean" },
  },
});
if (!cmd || !product) {
  console.error("usage: ledger.mjs add|deleted|owns|list|sweep <product> [options]");
  process.exit(2);
}
const p = paths(product);
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined));
const refs = v.ref ?? [];

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

try {
  const active = existsSync(p.lockFile);
  const runId = existsSync(p.runFile) ? loadJson(p.runFile).runId : undefined;
  if (cmd === "add" || cmd === "deleted") {
    if (!active) throw new Error(`no active run for product '${product}'`);
    if (refs.length !== 1) throw new Error(`${cmd} takes exactly one --ref`);
    const ce = v["cleanup-endpoint"];
    const cp = v["cleanup-param"];
    if (cmd === "deleted" && (ce || cp)) throw new Error("a cleanup recipe belongs to the created entity: pass it to add");
    if (!ce !== !cp) throw new Error("--cleanup-endpoint and --cleanup-param go together");
    if (ce && !/^EP-[a-z0-9]+(?:-[a-z0-9]+)*-\d+$/.test(ce)) throw new Error(`--cleanup-endpoint must be a catalogue id (EP-<module>-<n>), got '${ce}'`);
    const entry = append(p.ledgerFile, clean({ runId, event: cmd === "add" ? "created" : "deleted", type: v.type, ref: refs[0], module: v.module, stage: v.stage, agent: v.agent, label: v.label, url: v.url, note: v.note, cleanup: ce ? { endpoint: ce, param: cp } : undefined }));
    console.log(JSON.stringify(entry));
  } else if (cmd === "owns") {
    if (!refs.length) throw new Error("owns needs --ref");
    if (v.type !== undefined && refs.length !== 1) throw new Error("owns --type takes exactly one --ref");
    const yes = v.type !== undefined ? owns(p.ledgerFile, runId, v.type, refs[0]) : ownsAny(p.ledgerFile, runId, refs);
    process.exit(active && yes ? 0 : 1);
  } else if (cmd === "list") {
    const scope = v["all-runs"] ? undefined : runId;
    console.log(JSON.stringify(v.live ? live(p.ledgerFile, scope) : read(p.ledgerFile).filter((e) => !scope || e.runId === scope), null, 2));
  } else if (cmd === "sweep") {
    const { sweep } = await import("./lib/sweep.mjs");
    const r = await sweep(product, { root: workspaceRoot, run: v.run, dryRun: !!v["dry-run"], interactive: { isTTY: !!process.stdin.isTTY, ask } });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.errors || r.failed?.length ? 1 : 0);
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(e.message);
  process.exit(2);
}
