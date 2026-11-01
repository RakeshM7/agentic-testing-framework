// The hook registrations of every host (D-020), rendered by scripts/build-agents.mjs from config/hooks.yaml (D-042):
//   .claude/settings.json                Claude Code: only the framework's own entries in its `hooks` key (below);
//                                        every other key, and every other hook entry, is kept as it is
//   .github/hooks/framework-guard.json   Copilot CLI and the cloud coding agent (a dedicated file, rendered whole)
//   .vscode/hooks/framework-guard.json   VS Code's local agent (a dedicated file, rendered whole)
//   .agents/hooks.json                   Antigravity: only the framework's named hook set, `atf-guard` (below); every
//                                        other set is kept as it is
//   .codex/hooks.json                    Codex: only the framework's own entries in its `hooks` key, merged like Claude's
//                                        (below); every other key and hook entry is kept as it is
// The PreToolUse guard is always registered, synchronously, on every host. Only the PostToolUse hook is configurable:
//   async  Claude Code runs it in the background (`async: true`); Copilot, VS Code, Antigravity and Codex have no
//          background hooks, so there it stays synchronous
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
//
// .agents/hooks.json is shared the same way with the workspace's own Antigravity hooks, but the file is an object of
// named hook sets ({ "<set>": { enabled, PreToolUse: [...], PostToolUse: [...] } }), so the framework's part is one
// whole set, `atf-guard` (mergeAntigravityHooks):
//   - `atf-guard` is rendered, never read: whatever it held is replaced, and it is always the first key
//   - every other set is kept, as it is, in the order it had
//   - the merged result is checked for the guard (first key, PreToolUse as rendered) before anything is returned
// A file that is not a JSON object, or a set that is not an object, is an error: nothing is written. The file's text is
// kept as it is when the merge equals it (as JSON) and `atf-guard` is already first; a guard moved down is drift.
// Its commands run cwd-relative, from the workspace root (`{fw}` as for Copilot and VS Code).
// UNVERIFIED (Antigravity spike pending, docs/antigravity-spike/): that the hook runs from the workspace root, and that
// the sets run in key order, so the guard listed first runs first.
//
// .codex/hooks.json is shared with the workspace's own Codex hooks in Claude's shape ({ "hooks": { event: [matcher
// groups] } }), and merged by the same rules (mergeCodexHooks = the Claude merge, generalised by host): the framework
// owns only the hooks whose command runs scripts/hooks/pretooluse.mjs or posttooluse.mjs with `--host codex`, in any
// `{fw}` form; a Claude entry is never taken for a Codex one, nor the reverse. Entries: matcher `.*`, timeout 30 s,
// PostToolUse omitted when off, async rendered as sync (Codex has no background hooks). Its commands run from the
// session's cwd (`{fw}` as for Copilot and VS Code).
// UNVERIFIED (Codex spike pending, docs/codex-spike/): that the command's cwd-relative path works, and what happens
// when a session starts from a subfolder of the workspace.
//
// The pinned Node.js (lib/sync.mjs, atf/machine.json "node"): in a client's workspace whose PATH node is older than
// MIN_NODE, sync renders every hook command with that Node's absolute path in place of `node` (`node` option, a
// nodeWord), except in the files `plainNode` names (what the cloud-agent opt-in commits: GitHub's runner has its own
// Node). This repository's committed files never get one: the build passes no `node` here. frameworkHook() knows a
// framework entry under either program word, so a sync that pins or unpins replaces the entries, never adds to them.
// Dependency-free.
import { isDeepStrictEqual } from "node:util";
import { expandFw } from "./roots.mjs";

export const HOOKS_CONFIG = "config/hooks.yaml";
export const POST_MODES = ["async", "sync", "off"];
export const CLAUDE_SETTINGS = ".claude/settings.json";
export const ANTIGRAVITY_HOOKS = ".agents/hooks.json";
export const ANTIGRAVITY_SET = "atf-guard";
export const CODEX_HOOKS = ".codex/hooks.json";

const CLAUDE_PRE_MATCHER = "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|WebFetch|WebSearch|Agent|Task|mcp__.*playwright.*";
// Agent and Task: the spawns the PostToolUse hook records for the report's time and effort (D-079)
const CLAUDE_POST_MATCHER = "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit|Agent|Task";
// .claude/settings.json is also read by Copilot CLI and VS Code's Copilot CLI engine ("repo settings"), which on Windows
// run the command through PowerShell. `${CLAUDE_PROJECT_DIR:-.}` is bash-only: PowerShell reads it as one unset
// variable, the path became /scripts/hooks/... and node crashed before the guard ran, so the host denied every matched
// call as "hook errored". `${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/}` means the same in bash (Claude Code, which sets
// the variable) and is empty in PowerShell, leaving the cwd-relative path those hosts run from the repo root.
const claudeCommand = (entry, fw, node = "node") => `${node} ${expandFw(`"\${CLAUDE_PROJECT_DIR:+\$CLAUDE_PROJECT_DIR/}{fw}/scripts/hooks/${entry}.mjs"`, fw)} --host claude-code`;
const command = (entry, host, fw, node = "node") => `${node} ${expandFw(`{fw}/scripts/hooks/${entry}.mjs`, fw)} --host ${host}`;

// A pinned Node.js's absolute path as a hook command's program word: `/` separators on every OS (bash, PowerShell and
// Git Bash all take them), bare when it holds only characters no shell reads specially, else in double quotes. A path
// with a quote, `$`, a backtick, `%`, `!` or a control character can't be written safely for every shell the hosts run
// hooks in: it throws, and sync leaves the commands as `node`.
export function nodeWord(file) {
  const p = String(file ?? "").replaceAll("\\", "/");
  if (!p || /["$`%!\x00-\x1f]/.test(p)) throw new Error(`the Node.js path ${JSON.stringify(String(file ?? ""))} can't be written into a hook command safely`);
  return /^[A-Za-z0-9_/.:@+,=~-]+$/.test(p) ? p : `"${p}"`;
}

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

function claudeHooks(mode, fw, node) {
  const hooks = { PreToolUse: [{ matcher: CLAUDE_PRE_MATCHER, hooks: [{ type: "command", command: claudeCommand("pretooluse", fw, node) }] }] };
  if (mode !== "off")
    hooks.PostToolUse = [{ matcher: CLAUDE_POST_MATCHER, hooks: [{ type: "command", ...(mode === "async" ? { async: true } : {}), command: claudeCommand("posttooluse", fw, node) }] }];
  return hooks;
}

// Codex's hooks: no background hooks, so async renders as sync; off omits PostToolUse.
function codexHooks(mode, fw, node) {
  const group = (name) => [{ matcher: ".*", hooks: [{ type: "command", command: command(name, "codex", fw, node), timeout: 30 }] }];
  return { PreToolUse: group("pretooluse"), ...(mode !== "off" ? { PostToolUse: group("posttooluse") } : {}) };
}

const isMap = (v) => Object.prototype.toString.call(v) === "[object Object]";
// an own, enumerable key even when it is `__proto__` (a JSON key is data, never the object's prototype)
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });
const HOOK_SCRIPT = /(?:^|\/)scripts\/hooks\/(pretooluse|posttooluse)\.mjs$/;
// the project-dir prefixes a rendered command has carried: ${CLAUDE_PROJECT_DIR:+$CLAUDE_PROJECT_DIR/} (now),
// ${CLAUDE_PROJECT_DIR:-.}/ (before the PowerShell fix), and a plain $CLAUDE_PROJECT_DIR/
const PROJECT_DIR = /^(?:\$\{CLAUDE_PROJECT_DIR(?::?[-+=?][^}]*)?\}|\$CLAUDE_PROJECT_DIR)\/?/;

// The program word of a framework hook command: `node`, or a pinned Node.js by its path (nodeWord: bare or quoted,
// either separator, `node` or `node.exe` as its last segment).
const NODE_PROGRAM = String.raw`(?:node(?:\.exe)?|"[^"]*[\\/]node(?:\.exe)?"|[^\s"]*[\\/]node(?:\.exe)?)`;
const FRAMEWORK_COMMAND = new RegExp(String.raw`^${NODE_PROGRAM}\s+(?:"([^"]+)"|(\S+))((?:\s+\S+)*)$`, "i");

// A Claude Code hook -> "pretooluse" | "posttooluse" when it runs the framework's hook entry, else null. Recognised by
// shape, not by today's exact text: `node <path> … --host claude-code` (or a pinned Node.js's path in place of `node`),
// the path (quoted or not, either separator, after any project-dir prefix) ending in the segment
// scripts/hooks/<entry>.mjs. `--host claude-code` is what keeps a client's own scripts/hooks/pretooluse.mjs out: only
// the framework's registration passes it.
export function frameworkHook(hook, host = "claude-code") {
  if (!isMap(hook) || hook.type !== "command" || typeof hook.command !== "string") return null;
  const m = hook.command.trim().match(FRAMEWORK_COMMAND);
  if (!m) return null;
  const args = m[3].trim().split(/\s+/);
  const hostAt = args.indexOf("--host");
  if (hostAt < 0 || args[hostAt + 1] !== host) return null;
  const script = (m[1] ?? m[2]).replaceAll("\\", "/").replace(PROJECT_DIR, "");
  return script.match(HOOK_SCRIPT)?.[1] ?? null;
}

// The current `hooks` value of .claude/settings.json (or undefined) -> the merged `hooks` (see the header). Throws on
// a shape it can't merge safely, naming where. `node`: the commands' program word (nodeWord of a pinned Node.js).
export const mergeClaudeHooks = (current, mode, fw = "", node = "node") => mergeHostHooks(current, claudeHooks(mode, fw, node), "claude-code");

// The same merge for .codex/hooks.json's `hooks` value.
export const mergeCodexHooks = (current, mode, fw = "", node = "node") => mergeHostHooks(current, codexHooks(mode, fw, node), "codex");

// The merge both share: `ours` is the framework's rendered `hooks`, `host` the --host its entries carry.
function mergeHostHooks(current, ours, host) {
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
      const own = group.hooks.filter((h) => !frameworkHook(h, host));
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
  assertGuard(merged, ours);
  return merged;
}

// The PreToolUse guard is mandatory (D-042): the first PreToolUse group is the framework's, matcher and command as
// rendered. A merge that ever lost it is a bug, so it throws rather than write a settings file without the guard.
function assertGuard(hooks, ours) {
  const [want] = ours.PreToolUse;
  if (!isDeepStrictEqual(hooks.PreToolUse?.[0], want)) throw new Error("internal: the merged hooks lost the PreToolUse guard; nothing was written");
}

const describe = (v) => (v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "object" ? "an object" : `a ${typeof v}`);

function copilotHooks(mode, fw, node) {
  const entry = (name) => ({ type: "command", command: command(name, "copilot", fw, node), cwd: ".", timeoutSec: 30 });
  return { version: 1, hooks: { PreToolUse: [entry("pretooluse")], ...(mode !== "off" ? { PostToolUse: [entry("posttooluse")] } : {}) } };
}

function vscodeHooks(mode, fw, node) {
  const entry = (name) => ({ type: "command", command: command(name, "vscode", fw, node), cwd: ".", timeout: 30 });
  return { hooks: { PreToolUse: [entry("pretooluse")], ...(mode !== "off" ? { PostToolUse: [entry("posttooluse")] } : {}) } };
}

// Antigravity's set. It has no background hooks: async renders as sync, off omits PostToolUse.
function antigravitySet(mode, fw, node) {
  const group = (name) => [{ matcher: ".*", hooks: [{ type: "command", command: command(name, "antigravity", fw, node), timeout: 30 }] }];
  return { enabled: true, PreToolUse: group("pretooluse"), ...(mode !== "off" ? { PostToolUse: group("posttooluse") } : {}) };
}

// The parsed .agents/hooks.json (or undefined) -> the merged sets (see the header). Throws on a shape it can't merge
// safely, naming where.
export function mergeAntigravityHooks(current, mode, fw = "", node = "node") {
  if (current !== undefined && !isMap(current))
    throw new Error(`must be a JSON object (set name -> hook set), not ${describe(current)}; fix it, nothing was written`);
  const merged = {};
  put(merged, ANTIGRAVITY_SET, antigravitySet(mode, fw, node));
  for (const [name, set] of Object.entries(current ?? {})) {
    if (name === ANTIGRAVITY_SET) continue; // ours: replaced, whatever it held
    if (!isMap(set)) throw new Error(`set '${name}' must be an object, not ${describe(set)}; fix it, nothing was written`);
    put(merged, name, set);
  }
  assertAntigravityGuard(merged, fw, node);
  return merged;
}

// The guard is mandatory (D-042, D-092): `atf-guard` is the first set and its first PreToolUse group is as rendered.
function assertAntigravityGuard(sets, fw, node) {
  const [want] = antigravitySet("off", fw, node).PreToolUse;
  if (Object.keys(sets)[0] !== ANTIGRAVITY_SET || sets[ANTIGRAVITY_SET]?.enabled !== true || !isDeepStrictEqual(sets[ANTIGRAVITY_SET].PreToolUse?.[0], want))
    throw new Error(`internal: the merged hook sets lost the '${ANTIGRAVITY_SET}' guard; nothing was written`);
}

function renderAntigravityHooks(mode, text, fw, node) {
  let current;
  if (text !== undefined && text.trim() !== "") {
    try {
      current = JSON.parse(text);
    } catch (e) {
      throw new Error(`not valid JSON (${e.message}); fix it, nothing was written`);
    }
  }
  const merged = mergeAntigravityHooks(current, mode, fw, node);
  // unchanged only when it is the same as JSON AND the guard is already first: the position is ours, so a moved guard is drift
  const same = current !== undefined && isDeepStrictEqual(merged, current) && Object.keys(current)[0] === ANTIGRAVITY_SET;
  return same ? text : formatJson(merged) + "\n";
}

// a shared file's error names that file (e.file), for the build's message
function inFile(file, render) {
  try {
    return render();
  } catch (e) {
    e.file = file;
    throw e;
  }
}

// -> Map(workspace-relative path -> file content). `claudeSettings` is the current .claude/settings.json text (or
// undefined); its keys other than `hooks` are kept, in their order, and in `hooks` everything but the framework's own
// entries (mergeClaudeHooks). `codexHooks` is the current .codex/hooks.json text (or undefined), merged the same way
// for `--host codex` (mergeCodexHooks). `antigravityHooks` is the current .agents/hooks.json text (or undefined); every set but
// `atf-guard` is kept (mergeAntigravityHooks). When nothing of ours differs, a shared file's text comes back unchanged.
// `fw`: the framework's path from the workspace. `node`: the commands' program word, `node` unless sync pins a Node.js
// (nodeWord); `plainNode`: the files that keep `node` even then. Throws on a shared file it can't merge safely (not
// JSON, not an object, a malformed `hooks` or set), with `e.file` naming that file.
export const COPILOT_HOOKS = ".github/hooks/framework-guard.json";
export const VSCODE_HOOKS = ".vscode/hooks/framework-guard.json";
export function renderHookRegistrations(mode, claudeSettings, fw = "", opts = {}) {
  const { antigravityHooks, codexHooks: codexHooksText, node = "node", plainNode = [] } = opts;
  const word = (file) => (plainNode.includes(file) ? "node" : node);
  return new Map([
    [CLAUDE_SETTINGS, inFile(CLAUDE_SETTINGS, () => renderClaudeSettings(mode, claudeSettings, fw, word(CLAUDE_SETTINGS)))],
    [COPILOT_HOOKS, formatJson(copilotHooks(mode, fw, word(COPILOT_HOOKS))) + "\n"],
    [VSCODE_HOOKS, formatJson(vscodeHooks(mode, fw, word(VSCODE_HOOKS))) + "\n"],
    [ANTIGRAVITY_HOOKS, inFile(ANTIGRAVITY_HOOKS, () => renderAntigravityHooks(mode, antigravityHooks, fw, word(ANTIGRAVITY_HOOKS)))],
    // Codex's file is rendered only when the caller names it (even as `codexHooks: undefined` for a missing file)
    ...("codexHooks" in opts ? [[CODEX_HOOKS, inFile(CODEX_HOOKS, () => renderCodexHooks(mode, codexHooksText, fw, word(CODEX_HOOKS)))]] : []),
  ]);
}

// .codex/hooks.json: { hooks }, the file's other keys kept (the Claude settings rules, with --host codex)
function renderCodexHooks(mode, text, fw, node) {
  let file = {};
  if (text !== undefined && text.trim() !== "") {
    try {
      file = JSON.parse(text);
    } catch (e) {
      throw new Error(`not valid JSON (${e.message}); fix it, nothing was written`);
    }
  }
  if (!isMap(file)) throw new Error(`must be a JSON object, not ${describe(file)}; fix it, nothing was written`);
  const merged = { ...file, hooks: mergeCodexHooks(file.hooks, mode, fw, node) };
  return text?.trim() && isDeepStrictEqual(merged, file) ? text : formatJson(merged) + "\n";
}

function renderClaudeSettings(mode, text, fw, node) {
  const settings = text === undefined || text.trim() === "" ? {} : JSON.parse(text);
  if (!isMap(settings)) throw new Error(`must be a JSON object, not ${describe(settings)}; fix it, nothing was written`);
  const merged = { ...settings, hooks: mergeClaudeHooks(settings.hooks, mode, fw, node) };
  return text?.trim() && isDeepStrictEqual(merged, settings) ? text : formatJson(merged) + "\n";
}

// Rewrites the post_tool_use line of config/hooks.yaml text, keeping its comments.
export function setPostMode(text, mode) {
  if (!POST_MODES.includes(mode)) throw new Error(`--post-hook '${mode}' not in [${POST_MODES}]`);
  const line = /^post_tool_use:[ \t]*[^\s#]*/m;
  if (!line.test(text)) throw new Error(`${HOOKS_CONFIG}: no post_tool_use line`);
  return text.replace(line, `post_tool_use: ${mode}`);
}
