#!/usr/bin/env node
// The ONE PreToolUse hook entry, for every host. Registered by:
//   .claude/settings.json                --host claude-code             Claude Code
//   .vscode/hooks/framework-guard.json   --host vscode                  VS Code Copilot Chat, every chat session
//   .github/agents/<name>.agent.md       --host vscode --agent <name>   VS Code, while that custom agent runs (generated)
//   .github/hooks/framework-guard.json   --host copilot                 Copilot CLI and the cloud coding agent
//   .agents/hooks.json (set atf-guard)   --host antigravity             Antigravity App, agy CLI and IDE
// Flow: the host's adapter (hosts/<adapter>.mjs) turns the payload into a canonical tool call; safety
// (scripts/lib/guard.mjs) and design-decision governance (scripts/lib/decisions.mjs) each judge it; deny beats ask
// beats allow; the adapter writes the verdict in the host's format. When the guard blocks the liveness canary, the
// blocking host/agent is recorded (scripts/lib/guard-check.mjs).
// Fails closed: if anything here fails while a product run is active, the call is blocked. Everything is imported
// dynamically inside the try, so even a broken module cannot make the hook fail open; if not even the adapter loads,
// the block is still written for the asserted host: a deny decision with exit 0 for VS Code (D-040), exit 2 elsewhere,
// and for Antigravity, whose exit-code handling is unverified (D-099), its documented stdout deny decision as well.
// Every error, blocked or not, is logged with its stack to artifacts/hook-errors.jsonl (scripts/lib/hook-log.mjs,
// D-065); a failing log changes nothing.
// The root judged is the workspace (scripts/lib/roots.mjs hookWorkspaceRoot, D-085): ATF_WORKSPACE, else the host's
// project root or the nearest atf/atf.json above it; this file's own framework is never writable when it differs. An
// adapter whose payload can name several workspaces (Antigravity's multi-root windows) gives them all (rootsOf): the
// call is judged in each, and deny beats ask beats allow across them.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Any lock in a product's state/ or an environment's envs/<env>/state/ (D-081). Kept here, not imported, so it works
// even when no module loads.
function runActive(root) {
  const artifacts = path.join(root, "artifacts");
  if (!existsSync(artifacts)) return false;
  for (const p of readdirSync(artifacts)) {
    if (existsSync(path.join(artifacts, p, "state", "lock.json"))) return true;
    const envs = path.join(artifacts, p, "envs");
    if (existsSync(envs) && readdirSync(envs).some((e) => existsSync(path.join(envs, e, "state", "lock.json")))) return true;
  }
  return false;
}

// The workspace before anything loads (D-085), inline for the same reason: the nearest directory from the host's root
// up that holds atf/atf.json, else the host's root. Refined by roots.mjs once it loads.
function workspaceOf(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "atf", "atf.json"))) return dir;
    if (path.dirname(dir) === dir) return start;
  }
}

// VS Code blocks only on a deny decision with exit 0 (D-040, hosts/vscode.mjs). Read from the raw arguments, since
// hosts/index.mjs may be what failed, and in a way that cannot throw.
const asserts = (host) => new RegExp(`(?:^| )--host[= ]${host}(?: |$)`).test(process.argv.slice(2).join(" "));

async function logError(e, outcome) {
  try {
    const { logHookError } = await import("../lib/hook-log.mjs");
    return logHookError(root, { hook: "pretooluse", args, error: e, payload, raw, outcome });
  } catch {
    return undefined;
  }
}

let payload;
let raw;
let args = {};
let root = process.env.ATF_WORKSPACE || workspaceOf(process.env.CLAUDE_PROJECT_DIR || process.cwd());
let adapter;
try {
  const { adapterFor, hookArgs } = await import("./hosts/index.mjs");
  args = hookArgs();
  adapter = await adapterFor(args.host);
  raw = readFileSync(0, "utf8");
  payload = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // Windows PowerShell 5.1 prefixes a BOM when it relays stdin
  const { hookWorkspaceRoot } = await import("../lib/roots.mjs");
  const roots = [...new Set((adapter.rootsOf ? adapter.rootsOf(payload) : [adapter.rootOf(payload)]).map((r) => hookWorkspaceRoot(r)))];
  root = roots[0];
  const call = adapter.normalize(payload, { env: process.env, host: args.host, agent: args.agent });

  const { checkTool } = await import("../lib/guard.mjs");
  let verdict;
  for (const r of roots) {
    const safety = checkTool(call, r);
    if (safety.canary) {
      const { recordCanary } = await import("../lib/guard-check.mjs");
      recordCanary(safety.canary.product, r, call);
    }
    if (!safety.allowed) verdict ??= { decision: "deny", rule: safety.rule, reason: safety.reason };
  }
  if (!verdict) {
    const { checkDecisions, confirmedIn, loadDecisions } = await import("../lib/decisions.mjs");
    verdict = roots.map((r) => checkDecisions(call, r, { ...loadDecisions(r), confirmed: confirmedIn(r, call.sessionId) })).find((v) => v.decision !== "allow") ?? { decision: "allow" };
  }
  process.exit(adapter.emit(verdict));
} catch (e) {
  let active = true;
  try {
    active = runActive(root);
  } catch {
    // cannot tell: stay closed
  }
  const log = await logError(e, active ? "blocked: a run is active" : "allowed: no active run");
  const details = log ? `; details in ${log}` : "";
  if (active) {
    const reason = `the framework guard failed (${e.message}) while a run is active; failing closed${details}`;
    if (adapter) process.exit(adapter.emit({ decision: "deny", rule: "guard-error", reason }));
    console.error(`Blocked: ${reason}`);
    if (asserts("vscode")) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `Blocked: ${reason}` } }));
      process.exit(0);
    }
    // Antigravity: its documented decision on stdout as well as exit 2 (UNVERIFIED which one it honours, D-099)
    if (asserts("antigravity")) process.stdout.write(JSON.stringify({ decision: "deny", reason: `Blocked: ${reason}` }));
    process.exit(2);
  }
  console.error(`Framework guard error (${e.message}); no run is active, so the call is allowed${details}`);
  process.exit(0);
}
