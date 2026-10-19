#!/usr/bin/env node
// PostToolUse hook entry, for every host (registered next to pretooluse.mjs, same --host values). It only runs after a
// tool call actually happened, so an edit under a design decision that reaches here was confirmed by the user: remember
// that decision for the rest of the session (scripts/lib/decisions.mjs). Never blocks anything: an error is logged with
// its stack to artifacts/hook-errors.jsonl (scripts/lib/hook-log.mjs, D-065) and otherwise ignored.
import { readFileSync } from "node:fs";

let payload;
let raw;
let args = {};
let root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
try {
  const { adapterFor, hookArgs } = await import("./hosts/index.mjs");
  args = hookArgs();
  const adapter = await adapterFor(args.host);
  raw = readFileSync(0, "utf8");
  payload = JSON.parse(raw);
  root = adapter.rootOf(payload);
  const call = adapter.normalize(payload, { env: process.env, host: args.host, agent: args.agent });
  if (call.sessionId) {
    const { loadDecisions, rememberConfirmed, touchedDecisions } = await import("../lib/decisions.mjs");
    const { decisions = [] } = loadDecisions(root);
    rememberConfirmed(root, call.sessionId, touchedDecisions(call, root, decisions).map((h) => h.decision.id));
  }
} catch (e) {
  // remembering is a convenience; the next governed edit simply asks again
  try {
    const { logHookError } = await import("../lib/hook-log.mjs");
    const log = logHookError(root, { hook: "posttooluse", args, error: e, payload, raw, outcome: "ignored: confirmation not remembered" });
    console.error(`Framework PostToolUse hook error (${e.message}); details in ${log}`);
  } catch {
    // logging must never fail the hook
  }
}
process.exit(0);
