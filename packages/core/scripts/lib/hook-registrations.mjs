// The hook registrations of every host (D-020), rendered by scripts/build-agents.mjs from config/hooks.yaml (D-042):
//   .claude/settings.json                Claude Code: only the framework's own entries in its `hooks` key (below);
//                                        every other key, and every other hook entry, is kept as it is
//   .github/hooks/framework-guard.json   Copilot CLI and the cloud coding agent (a dedicated file, rendered whole)
//   .vscode/hooks/framework-guard.json   VS Code's local agent (a dedicated file, rendered whole)
// The PreToolUse guard is always registered, synchronously, on every host. Only the PostToolUse hook is configurable:
//   async  Claude Code runs it in the background (`async: true`); Copilot and VS Code have no background hooks, so
//          there it stays synchronous
//   sync   every host waits for it
//   off    not registered: every governed edit asks again, the session never remembers a confirmation
// Every command runs the framework's hook script by its path from the workspace (`{fw}`, D-085: nothing in this repo).
//
// .claude/settings.json is shared with the workspace's own Claude Code settings, its own hooks included (a client's
// lint or notification hook). The build owns only the framework's entries there: each hook whose command runs the
// framework's hook entry, scripts/hooks/pretooluse.mjs or posttooluse.mjs with --host claude-code (frameworkHook), in
// any form a version of the framework rendered: another `{fw}` (a moved or reinstalled package), the pre-move
// `scripts/hooks/…`, the older `${CLAUDE_PROJECT_DIR:-.}/…` prefix. A merge (mergeClaudeHooks):
//   - removes every framework entry, from every event, so an upgrade replaces them and never duplicates one; a matcher
//     group left with only the client's hooks stays (their hooks, in their order), one left empty goes, and an event
//     left empty by that goes too
//   - puts the framework's groups first in their events (PreToolUse, then PostToolUse unless off), then the client's
//     groups in the order they had; the framework's events first in `hooks`, then the client's events in their order
//   - always registers the PreToolUse guard: it is rendered, never read, so no entry of the client's can remove it,
//     and the merged result is checked for it before anything is returned
// A `hooks` that is not an object, an event that is not a list, or a group that is not an object with a `hooks` list
// is an error: the framework's entries can't be told apart safely, so nothing is written.
// When the merge equals what the file already holds (compared as JSON, so the client's formatting and event order are
// not drift), the file's text is kept as it is: --check reports drift only in the framework's entries, and the build
// rewrites nothing else. In this repo the file holds only the framework's entries, so its output is what it was.
// Dependency-free.
import { isDeepStrictEqual } from "node:util";
import { expandFw } from "./roots.mjs";

export const HOOKS_CONFIG = "config/hooks.yaml";
export const POST_MODES = ["async", "sync", "off"];
export const CLAUDE_SETTINGS = ".claude/settings.json";

const CLAUDE_PRE_MATCHER = "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|Agent|Task|mcp__.*playwright.*";
// Agent and Task: the spawns the PostToolUse hook records for the report's time and effort (D-079)
const CLAUDE_POST_MATCHER = "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|Agent|Task";
// .claude/settings.json is also read by Copilot CLI and VS Code's Copilot CLI engine ("repo settings"), which on Windows
// run the command through PowerShell. `${CLAUDE_PROJECT_DIR:-.}` is bash-only: PowerShell reads it as one unset
// variable, the path became /scripts/hooks/... and node crashed before the guard ran, so the host denied every matched
// call as "hook errored". `${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/}` means the same in bash (Claude Code, which sets
// the variable) and is empty in PowerShell, leaving the cwd-relative path those hosts run from the repo root.
const claudeCommand = (entry, fw) => expandFw(`node "\${CLAUDE_PROJECT_DIR:+\$CLAUDE_PROJECT_DIR/}{fw}/scripts/hooks/${entry}.mjs" --host claude-code`, fw);
const command = (entry, host, fw) => expandFw(`node {fw}/scripts/hooks/${entry}.mjs --host ${host}`, fw);

// config/hooks.yaml (parsed) -> { mode } | { error }
export function postModeOf(doc) {
  const mode = doc?.post_tool_use;
  return POST_MODES.includes(mode) ? { mode } : { error: `${HOOKS_CONFIG}: post_tool_use '${mode}' not in [${POST_MODES}]` };
}

// Pretty JSON in the repo's style: objects whose values are all primitives on one line, everything else indented.
export function formatJson(value, indent = "") {
  const inner = indent + "  ";
  if (Array.isArray(value)) return value.length ? `[\n${value.map((v) => inner + formatJson(v, inner)).join(",\n")}\n${indent}]` : "[]";
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "{}";
    if (entries.every(([, v]) => v === null || typeof v !== "object"))
      return `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}

function claudeHooks(mode, fw) {
  const hooks = { PreToolUse: [{ matcher: CLAUDE_PRE_MATCHER, hooks: [{ type: "command", command: claudeCommand("pretooluse", fw) }] }] };
  if (mode !== "off")
    hooks.PostToolUse = [{ matcher: CLAUDE_POST_MATCHER, hooks: [{ type: "command", ...(mode === "async" ? { async: true } : {}), command: claudeCommand("posttooluse", fw) }] }];
  return hooks;
}

const isMap = (v) => Object.prototype.toString.call(v) === "[object Object]";
// an own, enumerable key even when it is `__proto__` (a JSON key is data, never the object's prototype)
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const HOOK_SCRIPT = /(?:^|\/)scripts\/hooks\/(pretooluse|posttooluse)\.mjs$/;
// the project-dir prefixes a rendered command has carried: ${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/} (now),
// ${CLAUDE_PROJECT_DIR:-.}/ (before the PowerShell fix), and a plain $CLAUDE_PROJECT_DIR/
const PROJECT_DIR = /^(?:\$\{CLAUDE_PROJECT_DIR(?::?[-+=?][^}]*)?\}|\$CLAUDE_PROJECT_DIR)\/?/;

// A Claude Code hook -> "pretooluse" | "posttooluse" when it runs the framework's hook entry, else null. Recognised by
// shape, not by today's exact text: `node <path> … --host claude-code`, the path (quoted or not, either separator,
// after any project-dir prefix) ending in the segment scripts/hooks/<entry>.mjs. `--host claude-code` is what keeps a
// client's own scripts/hooks/pretooluse.mjs out: only the framework's registration passes it.
export function frameworkHook(hook) {
  if (!isMap(hook) || hook.type !== "command" || typeof hook.command !== "string") return null;
  const m = hook.command.trim().match(/^node\s+(?:"([^"]+)"|(\S+))((?:\s+\S+)*)$/);
  if (!m) return null;
  const args = m[3].trim().split(/\s+/);
  const host = args.indexOf("--host");
  if (host < 0 || args[host + 1] !== "claude-code") return null;
  const script = (m[1] ?? m[2]).replaceAll("\\", "/").replace(PROJECT_DIR, "");
  return script.match(HOOK_SCRIPT)?.[1] ?? null;
}

// The current `hooks` value of .claude/settings.json (or undefined) -> the merged `hooks` (see the header). Throws on
// a shape it can't merge safely, naming where.
export function mergeClaudeHooks(current, mode, fw = "") {
  const ours = claudeHooks(mode, fw);
  if (current === undefined) return ours;
  if (!isMap(current)) throw new Error(`'hooks' must be an object (event -> list of matcher groups), not ${describe(current)}; fix it, nothing was written`);
  const kept = {};
  for (const [event, groups] of Object.entries(current)) {
    if (!Array.isArray(groups)) throw new Error(`hooks.${event} must be a list of matcher groups, not ${describe(groups)}; fix it, nothing was written`);
    const rest = [];
    let removed = false;
    groups.forEach((group, i) => {
      if (!isMap(group) || !Array.isArray(group.hooks))
        throw new Error(`hooks.${event}[${i}] must be an object with a 'hooks' list, not ${describe(group)}; fix it, nothing was written`);
      const own = group.hooks.filter((h) => !frameworkHook(h));
      if (own.length === group.hooks.length) rest.push(group);
      else {
        removed = true;
        if (own.length) rest.push({ ...group, hooks: own });
      }
    });
    if (rest.length || !removed) put(kept, event, rest);
  }
  const merged = {};
  for (const [event, groups] of Object.entries(ours)) put(merged, event, [...groups, ...(kept[event] ?? [])]);
  for (const [event, groups] of Object.entries(kept)) if (!Object.hasOwn(merged, event)) put(merged, event, groups);
  assertGuard(merged, fw);
  return merged;
}

// The PreToolUse guard is mandatory (D-042): the first PreToolUse group is the framework's, matcher and command as
// rendered. A merge that ever lost it is a bug, so it throws rather than write a settings file without the guard.
function assertGuard(hooks, fw) {
  const [want] = claudeHooks("off", fw).PreToolUse;
  if (!isDeepStrictEqual(hooks.PreToolUse?.[0], want)) throw new Error("internal: the merged hooks lost the PreToolUse guard; nothing was written");
}

const describe = (v) => (v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "object" ? "an object" : `a ${typeof v}`);

function copilotHooks(mode, fw) {
  const entry = (name) => ({ type: "command", command: command(name, "copilot", fw), cwd: ".", timeoutSec: 30 });
  return { version: 1, hooks: { PreToolUse: [entry("pretooluse")], ...(mode !== "off" ? { PostToolUse: [entry("posttooluse")] } : {}) } };
}

function vscodeHooks(mode, fw) {
  const entry = (name) => ({ type: "command", command: command(name, "vscode", fw), cwd: ".", timeout: 30 });
  return { hooks: { PreToolUse: [entry("pretooluse")], ...(mode !== "off" ? { PostToolUse: [entry("posttooluse")] } : {}) } };
}

// -> Map(workspace-relative path -> file content). `claudeSettings` is the current .claude/settings.json text (or
// undefined); its keys other than `hooks` are kept, in their order, and in `hooks` everything but the framework's own
// entries (mergeClaudeHooks). When nothing of ours differs, its text comes back unchanged. `fw`: the framework's path
// from the workspace. Throws on settings it can't merge safely (not JSON, not an object, a malformed `hooks`).
export function renderHookRegistrations(mode, claudeSettings, fw = "") {
  return new Map([
    [CLAUDE_SETTINGS, renderClaudeSettings(mode, claudeSettings, fw)],
    [".github/hooks/framework-guard.json", formatJson(copilotHooks(mode, fw)) + "\n"],
    [".vscode/hooks/framework-guard.json", formatJson(vscodeHooks(mode, fw)) + "\n"],
  ]);
}

function renderClaudeSettings(mode, text, fw) {
  const settings = text === undefined || text.trim() === "" ? {} : JSON.parse(text);
  if (!isMap(settings)) throw new Error(`must be a JSON object, not ${describe(settings)}; fix it, nothing was written`);
  const merged = { ...settings, hooks: mergeClaudeHooks(settings.hooks, mode, fw) };
  return text?.trim() && isDeepStrictEqual(merged, settings) ? text : formatJson(merged) + "\n";
}

// Rewrites the post_tool_use line of config/hooks.yaml text, keeping its comments.
export function setPostMode(text, mode) {
  if (!POST_MODES.includes(mode)) throw new Error(`--post-hook '${mode}' not in [${POST_MODES}]`);
  const line = /^post_tool_use:[ \t]*[^\s#]*/m;
  if (!line.test(text)) throw new Error(`${HOOKS_CONFIG}: no post_tool_use line`);
  return text.replace(line, `post_tool_use: ${mode}`);
}
