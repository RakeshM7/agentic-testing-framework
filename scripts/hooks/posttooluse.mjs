#!/usr/bin/env node
// PostToolUse hook entry, for every host (registered next to pretooluse.mjs, same --host values). It only runs after a
// tool call actually happened, so an edit under a design decision that reaches here was confirmed by the user: remember
// that decision for the rest of the session (scripts/lib/decisions.mjs). Never blocks anything; any error is ignored.
import { readFileSync } from "node:fs";

try {
  const { adapterFor, hookArgs } = await import("./hosts/index.mjs");
  const args = hookArgs();
  const adapter = await adapterFor(args.host);
  const payload = JSON.parse(readFileSync(0, "utf8"));
  const root = adapter.rootOf(payload);
  const call = adapter.normalize(payload, { env: process.env, host: args.host, agent: args.agent });
  if (call.sessionId) {
    const { loadDecisions, rememberConfirmed, touchedDecisions } = await import("../lib/decisions.mjs");
    const { decisions = [] } = loadDecisions(root);
    rememberConfirmed(root, call.sessionId, touchedDecisions(call, root, decisions).map((h) => h.decision.id));
  }
} catch {
  // remembering is a convenience; the next governed edit simply asks again
}
process.exit(0);
