// OpenAI Codex adapter: the Codex CLI, the Codex app (desktop) and the Codex IDE extension (--host codex, registered in
// the project's .codex/hooks.json by scripts/lib/hook-registrations.mjs). Built from the Codex documentation (read
// 2026-11-01, docs/codex-plan.md §2); Codex is not installed where this was written, so every point marked UNVERIFIED
// (Codex spike pending, docs/codex-spike/) waits for the live spike. Fixtures: scripts/fixtures/hooks/
// codex-documented-*.json (rename to `captured` once a live payload replaces one).
//
// Payload (stdin, snake_case, documented; UNVERIFIED (Codex spike pending, docs/codex-spike/)):
//   { session_id, transcript_path, cwd, hook_event_name, model, turn_id, tool_name, tool_use_id, tool_input,
//     permission_mode }
// (PostToolUse adds the tool's response as `tool_response`, which posttooluse.mjs reads for spawn telemetry.)
// `tool_input`'s keys are UNVERIFIED, so they are read tolerantly: when two keys for the same thing disagree, every
// value is judged (the command lines, the patch texts, the working directories) or the call names no subagent at all (a
// spawn the guard then refuses): the guard never picks the value the host might not run. A shell call with no command
// under a key the adapter knows is `unknown`, never judged as an empty line.
//
// Root: the payload's `cwd`, the session's working directory (the hook entry then applies hookWorkspaceRoot, D-085).
// A shell call's `workdir`/`cwd` is never the root the guard judges: the model sets it. It is read only as an extra base
// for the relative files the command writes (the call's `cwds`; guard.mjs writeUnder, decisions.mjs targetsOf), as on
// Antigravity. UNVERIFIED: relative paths (an apply_patch's, a shell's) are judged from the workspace root, while Codex
// resolves them from the session's cwd, which differs only for a session started from a subfolder.
//
// Identity: the payload never names the calling agent, and Codex has no per-agent hook (UNVERIFIED that a subagent's tool
// calls reach the hook at all), so scripts/lib/hosts.mjs gives this host identity `none` and a full-run call gets the
// run's combined ceiling (D-035). `agent` is only ever the build-baked `--agent` of a registration (D-021), never the
// payload. During a run an unclassified tool is refused for EVERY caller, readonly included (D-101,
// HOSTS.codex.unknownTools): Codex's hosted web search, computer use and any other tool the adapter doesn't map.
//
// Output (documented: exit 0 with a hookSpecificOutput deny on stdout, or exit 2 with the reason on stderr; `ask` is not
// supported; UNVERIFIED (Codex spike pending, docs/codex-spike/) that a deny at exit 0 is honoured on every surface):
//   allow      exit 0, nothing written: the host's own approval policy still applies. Never an auto-approve.
//   deny       the decision on stdout, exit 0 (as for VS Code, D-040: a decision that does not depend on the shell's
//              exit-code handling), and the reason on stderr. A host that ignored it would let the guard-check canary
//              run, which stops the run before its first stage (D-037).
//   ask        Codex can't ask, so it is a deny whose reason says the user's confirmation is needed. A governed edit
//              (docs/decisions.md) is therefore refused for agents on this host until a human makes it.
//
// Tool names (documented). An unmapped tool is `unknown`, which the guard blocks for every caller during a run (D-101).
// Deliberately unmapped, so refused during a run: hosted web search (not hookable at all, so the generated
// .codex/config.toml turns it off), computer use, every non-Playwright MCP tool, and any other tool the docs don't list.
// The aliases the docs say matchers also see (`Edit`, `Write` for apply_patch, `Agent` for spawn_agent) are unmapped too
// until the spike shows which name arrives in the payload.
import path from "node:path";
import { denyMessage, resolveHost } from "../../lib/hosts.mjs";
import { toolCall } from "../../lib/tool-call.mjs";

// UNVERIFIED (Codex spike pending, docs/codex-spike/): the tool names and the kind of each.
const KINDS = {
  Bash: "shell", exec_command: "shell",
  apply_patch: "write",
  spawn_agent: "spawn",
  update_plan: "other",
  view_image: "read", // reads a local image file; UNVERIFIED that its path argument is judged nowhere else
};

// UNVERIFIED (Codex spike pending, docs/codex-spike/): the argument keys of each tool.
const ARGS = {
  command: ["command", "cmd"],
  cwd: ["workdir", "cwd"],
  patch: ["command", "patch", "input"],
  subagent: ["agent_type", "agent", "name", "agent_name", "subagent_type", "role"],
};

// The short Playwright tool name of a Playwright MCP tool, else undefined. Codex shows MCP tools to hooks as
// `mcp__<server>__<tool>` (UNVERIFIED (Codex spike pending, docs/codex-spike/)); only that form counts. The server key
// is one word of [A-Za-z0-9-] holding `playwright` (config/mcp.yaml), the name all word characters. Anything else is
// unknown (D-070). String scans only: no backtracking.
const WORD = /^\w+$/;
const SERVER_WORD = /^[A-Za-z0-9-]+$/;
export function browserActionOf(tool) {
  if (!tool.startsWith("mcp__")) return undefined;
  const at = tool.indexOf("__browser_", 5);
  if (at < 0) return undefined;
  const server = tool.slice(5, at);
  const name = tool.slice(at + "__browser_".length);
  return SERVER_WORD.test(server) && server.includes("playwright") && WORD.test(name) ? name : undefined;
}

// tool_input as an object. A bare string (UNVERIFIED shape) is the command or patch text itself; a JSON string is parsed.
function inputOf(payload) {
  let raw = payload?.tool_input ?? {};
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return { command: raw, patch: raw };
    }
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}

// The text of one shell command value: a string as it is; an argv array [sh, "-lc" | "-c", script] with sh one of bash,
// sh, zsh (or a path ending in one) is the script; any other array is its elements joined with spaces. Else undefined.
const SHELLS = new Set(["bash", "sh", "zsh"]);
const baseName = (p) => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
function commandText(v) {
  if (typeof v === "string") return v || undefined;
  if (!Array.isArray(v) || !v.length) return undefined;
  const argv = v.map(String);
  if (argv.length === 3 && SHELLS.has(baseName(argv[0])) && (argv[1] === "-lc" || argv[1] === "-c")) return argv[2] || undefined;
  return argv.join(" ");
}

// The text of one patch value (apply_patch's `command` may be an argv array too: its elements, one per line).
const patchText = (v) => (typeof v === "string" ? v : Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : "");

// Every distinct non-empty text under the given keys, in key order.
const distinct = (items) => [...new Set(items.filter(Boolean))];

// The files an apply_patch text names: every `*** Add File: p`, `*** Update File: p`, `*** Delete File: p` and
// `*** Move to: p` line, trimmed (CRLF and leading spaces tolerated; a patch naming no file gives none). One pass over the
// lines, no backtracking. A line that only looks like a header inside a hunk counts too: that can only add a denial.
const PATCH_HEADERS = ["*** Add File:", "*** Update File:", "*** Delete File:", "*** Move to:"];
const patchLines = (text) => text.split(/\r\n|\r|\n/).map((l) => l.trim());
export function patchPaths(text) {
  const out = [];
  for (const line of patchLines(text)) {
    const h = PATCH_HEADERS.find((p) => line.startsWith(p));
    if (h) out.push(line.slice(h.length).trim());
  }
  return out;
}
const looksLikePatch = (text) => patchLines(text).some((l) => l.startsWith("*** Begin Patch")) || patchPaths(text).length > 0;

export const rootOf = (payload) => (typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : process.cwd());

export function normalize(payload, { env = process.env, host = "codex", agent } = {}) {
  const tool = String(payload?.tool_name ?? "");
  const a = inputOf(payload);
  const browserAction = browserActionOf(tool);
  const mapped = browserAction ? "browser" : Object.hasOwn(KINDS, tool) ? KINDS[tool] : "unknown";
  // two different command keys: both are judged, as one command line
  const commands = mapped === "shell" ? distinct(ARGS.command.map((k) => commandText(a[k]))) : [];
  // a patch fed to a shell (`apply_patch <<EOF`) would write files no shell heuristic sees: refused during a run
  const shellPatch = commands.some(looksLikePatch);
  const kind = mapped === "shell" && (!commands.length || shellPatch) ? "unknown" : mapped;
  // Relative names are resolved by Codex from the session's directory (payload.cwd), which may be a subfolder of the
  // workspace, never only from the workspace root the guard judges in. So the session's directory is an extra base too:
  // a shell's relative writes are read from it and from every workdir (resolved from it), and a patch's relative files
  // are judged both as written (from the root) and resolved from it. Only ever more targets, never fewer (a session
  // started in atf/ that patches `atf.json` writes atf/atf.json, and is judged so).
  const sessionDir = typeof payload?.cwd === "string" && payload.cwd ? payload.cwd : undefined;
  const fromSession = (p) => (sessionDir && !path.isAbsolute(p) ? path.resolve(sessionDir, p) : p);
  const workdirs = distinct(ARGS.cwd.map((k) => (typeof a[k] === "string" ? a[k] : undefined)));
  const cwds = kind === "shell" ? distinct([...workdirs.map(fromSession), ...workdirs, ...(sessionDir ? [sessionDir] : [])]) : [];
  const patched = kind === "write" ? distinct(ARGS.patch.flatMap((k) => patchPaths(patchText(a[k])))) : [];
  const subagents = distinct(ARGS.subagent.map((k) => (typeof a[k] === "string" ? a[k].trim() : undefined)));
  return toolCall({
    host: resolveHost(host, env),
    agent,
    kind,
    tool,
    command: kind === "shell" ? commands.join(" ; ") : undefined,
    cwds,
    // every patch text is read (never one picked), so a decoy under one key hides no file; none = a write with no target
    paths: distinct([...patched, ...patched.map(fromSession)]),
    // a spawn naming two different agents names none, so the guard refuses it
    subagent: kind === "spawn" && subagents.length === 1 ? subagents[0] : undefined,
    browserAction,
    sessionId: typeof payload?.session_id === "string" ? payload.session_id : undefined,
  });
}

export function emit({ decision, rule, reason }) {
  if (decision === "allow") return 0;
  const message =
    decision === "deny" ? denyMessage(rule, reason) : `Needs the user's confirmation, which Codex hooks can't ask for: ${reason}`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: message } }));
  process.stderr.write(`${message}\n`);
  return 0;
}
