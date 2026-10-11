#!/usr/bin/env node
// The ONE PreToolUse hook entry, for every host. Registered by:
//   .claude/settings.json                --host claude-code             Claude Code
// Flow: the host's adapter (hosts/<adapter>.mjs) turns the payload into a canonical tool call; the safety guard
// (scripts/lib/guard.mjs) judges it; the adapter writes the verdict in the host's format.
// Fails closed: if anything here fails while a product run is active, the call is blocked. Everything is imported
// dynamically inside the try, so even a broken module cannot make the hook fail open.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

function runActive(root) {
  const artifacts = path.join(root, "artifacts");
  return existsSync(artifacts) && readdirSync(artifacts).some((p) => existsSync(path.join(artifacts, p, "state", "lock.json")));
}

let payload;
let root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let adapter;
try {
  const { adapterFor, hookArgs } = await import("./hosts/index.mjs");
  const args = hookArgs();
  adapter = await adapterFor(args.host);
  payload = JSON.parse(readFileSync(0, "utf8"));
  root = adapter.rootOf(payload);
  const call = adapter.normalize(payload, { env: process.env, host: args.host, agent: args.agent });

  const { checkTool } = await import("../lib/guard.mjs");
  const safety = checkTool(call, root);
  const verdict = safety.allowed ? { decision: "allow" } : { decision: "deny", rule: safety.rule, reason: safety.reason };
  process.exit(adapter.emit(verdict));
} catch (e) {
  if (runActive(root)) {
    const reason = `the framework guard failed (${e.message}) while a run is active; failing closed`;
    if (adapter) process.exit(adapter.emit({ decision: "deny", rule: "guard-error", reason }));
    console.error(`Blocked: ${reason}`);
    process.exit(2);
  }
  process.exit(0);
}
