// Claude Code adapter. Payload: { session_id, cwd, tool_name, tool_input, agent_type? } (agent_type names the calling
// subagent). Output: block = exit 2 + stderr; confirm = JSON permissionDecision "ask" on stdout, exit 0.
// Copilot CLI also reads .claude/settings.json; resolveHost() then refuses the claude-code assertion (no
// CLAUDE_PROJECT_DIR), so such calls are treated as unidentified on an unknown host.
// The framework's Claude Code plugin (packaging §3.12, PLUGIN_NAME in scripts/lib/hosts.mjs) scopes what Claude Code
// reports for it: its agents are `atf:<name>` and its MCP tools `mcp__plugin_atf_<server>__<tool>`. Both are read here
// as the framework's own (callerOf, frameworkAgent, browserActionOf); nothing else that is scoped is.
import { PLUGIN_MCP_PREFIX, PLUGIN_NAME, denyMessage, resolveHost } from "../../lib/hosts.mjs";
import { toolCall } from "../../lib/tool-call.mjs";

const KINDS = {
  Read: "read", Glob: "read", Grep: "read", LS: "read", NotebookRead: "read",
  Write: "write", Edit: "write", MultiEdit: "write", NotebookEdit: "write",
  Bash: "shell", PowerShell: "shell",
  WebFetch: "web_fetch", WebSearch: "web_search",
  Agent: "spawn", Task: "spawn",
  AskUserQuestion: "ask",
  TodoWrite: "other",
};

// An agent's name, as its source file agents/<name>.md is named (lowercase kebab-case). Unambiguous, so linear.
const AGENT_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLUGIN_SCOPE = `${PLUGIN_NAME}:`;

// The framework agent a scoped name stands for: `atf:<name>` with exactly one valid name after the plugin's scope
// (a plugin subfolder adds a segment, `atf:a:b`, which the framework's plugin never ships), else null.
const pluginAgent = (name) => {
  const rest = name.startsWith(PLUGIN_SCOPE) ? name.slice(PLUGIN_SCOPE.length) : null;
  return rest !== null && AGENT_NAME.test(rest) ? rest : null;
};

// The caller from agent_type (D-021), as the canonical call's { agent } or { unattributed: true }:
//   no agent_type, or ""      { agent: undefined }: the main session (a human's own, unless started with --agent)
//   a bare name               as given, exactly as before: a project agent's name can't hold `:`
//   `atf:<name>`              the framework plugin's agent: the bare <name>, so it gets that agent's own row
//   any other scoped name     another plugin's agent (`x:y`), a subfolder (`atf:a:b`), an empty segment (`atf:`,
//   (or not a string)         `:x`): a caller the guard can't attribute. It is never an unmanaged name (a human's own
//                             session): during a run it gets what a host that can't name its caller gets (D-035).
export function callerOf(agentType) {
  if (agentType === undefined || agentType === null || agentType === "") return { agent: undefined };
  if (typeof agentType !== "string") return { unattributed: true };
  if (!agentType.includes(":")) return { agent: agentType };
  const agent = pluginAgent(agentType);
  return agent ? { agent } : { unattributed: true };
}

// The agent a spawn starts: the framework plugin's `atf:<name>` is the framework agent <name>, so spawn allow-lists
// (bare names) apply to it; anything else as given (another scoped name matches no allow-list).
export const frameworkAgent = (name) => (typeof name === "string" && pluginAgent(name)) || name;

// The short Playwright tool name of a framework browser tool (scripts/lib/browser-tools.mjs), else undefined:
//   mcp__<server>__browser_<name>              a project server whose key holds `playwright`, as before
//   mcp__plugin_atf_<server>__browser_<name>   the same from the framework's plugin; its server key is one word of
//                                              [A-Za-z0-9-] holding `playwright` (an `_` there could be another
//                                              plugin whose name only starts with atf, `atf.x` -> `atf_x`)
// Another plugin's server (`mcp__plugin_<other>_…`) is not the framework's: its tools are unknown and fail closed
// during a run (D-036). <name> follows the last `__browser_` and is all word characters. No backtracking regex: a
// pattern with `.*` on both sides of `playwright` took seconds on a long name.
const WORD = /^\w+$/;
const SERVER_WORD = /^[A-Za-z0-9-]+$/;
const LINE_BREAK = /[\n\r\u2028\u2029]/;
const BROWSER_SEP = "__browser_";
export function browserActionOf(tool) {
  if (!tool.startsWith("mcp__")) return undefined;
  const at = tool.lastIndexOf(BROWSER_SEP);
  if (at < 0) return undefined;
  const name = tool.slice(at + BROWSER_SEP.length);
  const prefix = tool.slice(0, at);
  if (!WORD.test(name) || LINE_BREAK.test(prefix)) return undefined;
  if (prefix.startsWith(PLUGIN_MCP_PREFIX)) {
    const server = prefix.slice(PLUGIN_MCP_PREFIX.length);
    return SERVER_WORD.test(server) && server.includes("playwright") ? name : undefined;
  }
  if (prefix.startsWith("mcp__plugin_")) return undefined;
  return prefix.slice("mcp__".length).includes("playwright") ? name : undefined;
}

export const rootOf = (payload, env = process.env) => env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd();

export function normalize(payload, { env = process.env, host = "claude-code" } = {}) {
  const tool = String(payload.tool_name ?? "");
  const input = payload.tool_input ?? {};
  const resolved = resolveHost(host, env);
  const browserAction = browserActionOf(tool);
  return toolCall({
    host: resolved,
    ...(resolved === "claude-code" ? callerOf(payload.agent_type) : {}),
    kind: browserAction ? "browser" : KINDS[tool] ?? "unknown",
    tool,
    command: input.command,
    paths: [input.file_path ?? input.notebook_path],
    urls: [input.url],
    subagent: frameworkAgent(input.subagent_type),
    browserAction,
    sessionId: payload.session_id,
  });
}

// verdict: { decision: "allow" | "ask" | "deny", rule?, reason? } -> exit code
export function emit({ decision, rule, reason }) {
  if (decision === "deny") {
    process.stderr.write(`${denyMessage(rule, reason)}\n`);
    return 2;
  }
  if (decision === "ask")
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } }));
  return 0;
}
