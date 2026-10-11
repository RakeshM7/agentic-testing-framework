#!/usr/bin/env node
// The ONE PreToolUse hook entry, for every host. Registered by:
//   .claude/settings.json                --host claude-code             Claude Code
//   .vscode/hooks/framework-guard.json   --host vscode                  VS Code Copilot Chat, every chat session
//   .github/agents/<name>.agent.md       --host vscode --agent <name>   VS Code, while that custom agent runs (generated)
//   .github/hooks/framework-guard.json   --host copilot                 Copilot CLI and the cloud coding agent
// Flow: the host's adapter (hosts/<adapter>.mjs) turns the payload into a canonical tool call; safety
// (scripts/lib/guard.mjs) and design-decision governance (scripts/lib/decisions.mjs) each judge it; deny beats ask
// beats allow; the adapter writes the verdict in the host's format. When the guard blocks the liveness canary, the
// blocking host/agent is recorded (scripts/lib/guard-check.mjs).
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
  if (safety.canary) {
    const { recordCanary } = await import("../lib/guard-check.mjs");
    recordCanary(safety.canary.product, root, call);
  }
  let verdict = safety.allowed ? { decision: "allow" } : { decision: "deny", rule: safety.rule, reason: safety.reason };
  if (verdict.decision === "allow") {
    const { checkDecisions, confirmedIn, loadDecisions } = await import("../lib/decisions.mjs");
    verdict = checkDecisions(call, root, { ...loadDecisions(root), confirmed: confirmedIn(root, call.sessionId) });
  }
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
