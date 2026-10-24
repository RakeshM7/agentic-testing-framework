// The hook registrations of every host (D-020), rendered by scripts/build-agents.mjs from config/hooks.yaml (D-042):
//   .claude/settings.json                Claude Code (only its `hooks` key; any other key is kept as it is)
//   .github/hooks/framework-guard.json   Copilot CLI and the cloud coding agent
//   .vscode/hooks/framework-guard.json   VS Code's local agent
// The PreToolUse guard is always registered, synchronously, on every host. Only the PostToolUse hook is configurable:
//   async  Claude Code runs it in the background (`async: true`); Copilot and VS Code have no background hooks, so
//          there it stays synchronous
//   sync   every host waits for it
//   off    not registered: every governed edit asks again, the session never remembers a confirmation
// Dependency-free.

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
const claudeCommand = (entry) => `node "\${CLAUDE_PROJECT_DIR:+\$CLAUDE_PROJECT_DIR/}scripts/hooks/${entry}.mjs" --host claude-code`;
const command = (entry, host) => `node scripts/hooks/${entry}.mjs --host ${host}`;

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

function claudeHooks(mode) {
  const hooks = { PreToolUse: [{ matcher: CLAUDE_PRE_MATCHER, hooks: [{ type: "command", command: claudeCommand("pretooluse") }] }] };
  if (mode !== "off")
    hooks.PostToolUse = [{ matcher: CLAUDE_POST_MATCHER, hooks: [{ type: "command", ...(mode === "async" ? { async: true } : {}), command: claudeCommand("posttooluse") }] }];
  return hooks;
}

function copilotHooks(mode) {
  const entry = (name) => ({ type: "command", command: command(name, "copilot"), cwd: ".", timeoutSec: 30 });
  return { version: 1, hooks: { PreToolUse: [entry("pretooluse")], ...(mode !== "off" ? { PostToolUse: [entry("posttooluse")] } : {}) } };
}

function vscodeHooks(mode) {
  const entry = (name) => ({ type: "command", command: command(name, "vscode"), cwd: ".", timeout: 30 });
  return { hooks: { PreToolUse: [entry("pretooluse")], ...(mode !== "off" ? { PostToolUse: [entry("posttooluse")] } : {}) } };
}

// -> Map(repo-relative path -> file content). `claudeSettings` is the current .claude/settings.json text (or undefined);
// its keys other than `hooks` are kept, in their order.
export function renderHookRegistrations(mode, claudeSettings) {
  const settings = claudeSettings ? JSON.parse(claudeSettings) : {};
  return new Map([
    [CLAUDE_SETTINGS, formatJson({ ...settings, hooks: claudeHooks(mode) }) + "\n"],
    [".github/hooks/framework-guard.json", formatJson(copilotHooks(mode)) + "\n"],
    [".vscode/hooks/framework-guard.json", formatJson(vscodeHooks(mode)) + "\n"],
  ]);
}

// Rewrites the post_tool_use line of config/hooks.yaml text, keeping its comments.
export function setPostMode(text, mode) {
  if (!POST_MODES.includes(mode)) throw new Error(`--post-hook '${mode}' not in [${POST_MODES}]`);
  const line = /^post_tool_use:[ \t]*[^\s#]*/m;
  if (!line.test(text)) throw new Error(`${HOOKS_CONFIG}: no post_tool_use line`);
  return text.replace(line, `post_tool_use: ${mode}`);
}
