// Google Antigravity adapter: the Antigravity App, the `agy` CLI and the IDE (--host antigravity, registered as the
// framework's named hook set `atf-guard` in .agents/hooks.json by scripts/lib/hook-registrations.mjs).
// Built from antigravity.google/docs (read 2026-10-27); Antigravity is not installed where this was written, so every
// point marked UNVERIFIED waits for the live spike (docs/antigravity-spike/). Fixtures: scripts/fixtures/hooks/
// antigravity-documented-*.json (rename to `captured` once a live payload replaces one).
//
// Payload (stdin, camelCase, documented):
//   { toolCall: { name, args }, stepIdx, conversationId, workspacePaths: [..], transcriptPath, artifactDirectoryPath,
//     modelName }
// `args` may arrive as a JSON string (read either way). Its keys are UNVERIFIED, so they are read tolerantly (see ARGS);
// when two keys for the same thing disagree, every value is judged (paths, urls, the command) or the call names no
// subagent at all (a spawn the guard then refuses): the guard never picks the value the host might not run.
// run_command's `Cwd` is never the root the guard judges (rootOf): the model sets it. It is read only as an extra base
// for the relative files the command writes (the call's `cwds`; guard.mjs writeUnder, decisions.mjs targetsOf), since
// Antigravity runs the line there: `echo x > atf.json` with Cwd <root>/atf is judged as a write to atf/atf.json. The
// command itself is judged as written, as on the other hosts.
//
// Multi-root windows: the call is judged against every listed folder that holds an active run (rootsOf, which the hook
// entry evaluates in full, deny winning), so a decoy folder listed first can't hide a run.
//
// Identity: the payload never names the calling agent, and no generated agent carries its own hook yet (UNVERIFIED that
// Antigravity runs one), so scripts/lib/hosts.mjs gives this host identity `none` and a full-run call gets the run's
// combined ceiling (D-035). `agent` is only ever the build-baked `--agent` of a registration (D-021), never the payload.
//
// Output (documented: stdout JSON { decision: "deny" | "ask" | "allow", reason }; exit codes undocumented, UNVERIFIED):
//   allow      exit 0, nothing written: the host's own permission policy still applies. Never an auto-approve.
//   deny/ask   the decision on stdout, exit 0 (as for VS Code, D-040: a decision that does not depend on the shell's
//              exit-code handling); a deny also goes to stderr. A host that ignored it would let the guard-check canary
//              run, which stops the run before its first stage (D-037).
//
// Tool names (documented). An unmapped tool is `unknown`, which the guard blocks during a run for managed agents and, in
// full-run, for every call it cannot attribute (D-036). Deliberately unmapped, so refused during a full-run:
//   define_subagent      it would create agents outside the generated roster
//   send_message, manage_subagents, schedule, generate_image
//   every built-in browser tool (browser_subagent, built-in browser_*, evaluate_script, Chrome DevTools MCP tools):
//                        framework agents use only the Playwright MCP server's Chromium (D-070)
// Mapped `other`: list_permissions, ask_permission, manage_task (UNVERIFIED: manage_task manages background command
// tasks; if it can send input to a running command, unmap it, like Copilot's write_bash, D-036).
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stateDirs } from "../../lib/guard.mjs";
import { resolveHost } from "../../lib/hosts.mjs";
import { hookWorkspaceRoot } from "../../lib/roots.mjs";
import { toolCall } from "../../lib/tool-call.mjs";

const KINDS = {
  view_file: "read", list_dir: "read", grep_search: "read", find_by_name: "read",
  write_to_file: "write", replace_file_content: "write", multi_replace_file_content: "write",
  run_command: "shell",
  read_url_content: "web_fetch", search_web: "web_search",
  invoke_subagent: "spawn",
  ask_question: "ask",
  // UNVERIFIED (Antigravity spike pending, docs/antigravity-spike/)
  list_permissions: "other", ask_permission: "other", manage_task: "other",
};

// UNVERIFIED (Antigravity spike pending, docs/antigravity-spike/): the argument keys of each tool.
const ARGS = {
  command: ["CommandLine", "command"],
  cwd: ["Cwd", "cwd"],
  paths: ["TargetFile", "AbsolutePath", "FilePath", "file_path", "path", "DirectoryPath", "SearchPath", "SearchDirectory"],
  urls: ["Url", "url"],
  subagent: ["Name", "name", "AgentName", "agentName", "agent", "subagent", "SubagentName"],
};

// The short Playwright tool name of a Playwright MCP tool, else undefined. Documented template `mcp_{server}_browser_
// {tool}` (UNVERIFIED (Antigravity spike pending, docs/antigravity-spike/)); Claude's `mcp__{server}__browser_{tool}`
// is read too. The server key is one word of [A-Za-z0-9-] holding `playwright` (config/mcp.yaml), the name all word
// characters. Anything else, built-in browser tools included, is unknown (D-070). String scans only: no backtracking.
const WORD = /^\w+$/;
const SERVER_WORD = /^[A-Za-z0-9-]+$/;
const MCP_FORMS = [["mcp__", "__browser_"], ["mcp_", "_browser_"]];
export function browserActionOf(tool) {
  for (const [prefix, sep] of MCP_FORMS) {
    if (!tool.startsWith(prefix)) continue;
    const at = tool.indexOf(sep, prefix.length);
    if (at < 0) continue;
    const server = tool.slice(prefix.length, at);
    const name = tool.slice(at + sep.length);
    if (SERVER_WORD.test(server) && server.includes("playwright") && WORD.test(name)) return name;
  }
  return undefined;
}

function argsOf(payload) {
  let raw = payload?.toolCall?.args ?? {};
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {}; // not an object: nothing to read (a write then has no target and is refused for a managed caller)
    }
  }
  return raw && typeof raw === "object" ? raw : {};
}

// Every distinct non-empty string under the given keys, in key order.
const valuesOf = (a, keys) => [...new Set(keys.map((k) => a[k]).filter((v) => typeof v === "string" && v))];

// A workspace path as a file path: the docs show plain paths; a file:// URI is read too (UNVERIFIED).
function asPath(p) {
  if (typeof p !== "string" || !p) return undefined;
  if (!p.startsWith("file://")) return p;
  try {
    return fileURLToPath(p);
  } catch {
    return undefined;
  }
}

// Whether a folder, or the workspace it belongs to (D-085), holds a run lock (scripts/lib/guard.mjs stateDirs, as
// findActiveRuns reads them). A folder that can't be read counts as active: it is judged, never skipped.
function hasActiveRun(dir) {
  try {
    return [...new Set([dir, hookWorkspaceRoot(dir, { env: {} })])].some((d) => stateDirs(d).some(({ state }) => existsSync(path.join(state, "lock.json"))));
  } catch {
    return true;
  }
}

// The workspaces the call is judged in. A multi-root window may list several folders: every one holding an active run,
// in the payload's order (the hook entry judges the call in each, and a deny in any wins), so a decoy folder listed
// first can't hide the run. With no active run: the first folder holding atf/atf.json or artifacts/, else the first,
// else the payload's cwd, else the hook's own.
export function rootsOf(payload) {
  const paths = [...new Set((Array.isArray(payload?.workspacePaths) ? payload.workspacePaths : []).map(asPath).filter(Boolean))];
  const active = paths.filter(hasActiveRun);
  if (active.length) return active;
  const marked = paths.find((p) => existsSync(path.join(p, "atf", "atf.json")) || existsSync(path.join(p, "artifacts")));
  return [marked || paths[0] || payload?.cwd || process.cwd()];
}

// The workspace the call belongs to (the PostToolUse hook's, and the first the PreToolUse hook judges).
export const rootOf = (payload) => rootsOf(payload)[0];

export function normalize(payload, { env = process.env, host = "antigravity", agent } = {}) {
  const tool = String(payload?.toolCall?.name ?? "");
  const a = argsOf(payload);
  const browserAction = browserActionOf(tool);
  const commands = valuesOf(a, ARGS.command);
  const mapped = browserAction ? "browser" : Object.hasOwn(KINDS, tool) ? KINDS[tool] : "unknown";
  // a command line under no key the adapter knows can't be judged (it would pass as an empty line): unknown, so it is
  // refused during a run (D-101) until the spike names the key
  const kind = mapped === "shell" && !commands.length ? "unknown" : mapped;
  // two different cwd keys: the written files are read from both
  const cwds = kind === "shell" ? valuesOf(a, ARGS.cwd).map(asPath).filter(Boolean) : [];
  const subagents = valuesOf(a, ARGS.subagent);
  return toolCall({
    host: resolveHost(host, env),
    agent,
    kind,
    tool,
    // two different command keys: both are judged, as one command line
    command: commands.length ? commands.join(" ; ") : undefined,
    cwds,
    paths: valuesOf(a, ARGS.paths),
    urls: valuesOf(a, ARGS.urls),
    // a spawn naming two different agents names none, so the guard refuses it
    subagent: kind === "spawn" && subagents.length === 1 ? subagents[0] : undefined,
    browserAction,
    sessionId: typeof payload?.conversationId === "string" ? payload.conversationId : undefined,
  });
}

export function emit({ decision, rule, reason }) {
  if (decision === "allow") return 0;
  const message = decision === "deny" ? `Blocked by the framework guard (${rule}): ${reason}` : reason;
  process.stdout.write(JSON.stringify({ decision, reason: message }));
  if (decision === "deny") process.stderr.write(`${message}\n`);
  return 0;
}
