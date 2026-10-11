// Claude Code adapter. Payload: { session_id, cwd, tool_name, tool_input, agent_type? } (agent_type names the calling
// subagent). Output: block = exit 2 + stderr; confirm = JSON permissionDecision "ask" on stdout, exit 0.
// Copilot CLI also reads .claude/settings.json; resolveHost() then refuses the claude-code assertion (no
// CLAUDE_PROJECT_DIR), so such calls are treated as unidentified on an unknown host.
import { resolveHost } from "../../lib/hosts.mjs";
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
const BROWSER = /^mcp__.*playwright.*__browser_(\w+)$/;

export const rootOf = (payload, env = process.env) => env.CLAUDE_PROJECT_DIR || payload?.cwd || process.cwd();

export function normalize(payload, { env = process.env, host = "claude-code" } = {}) {
  const tool = String(payload.tool_name ?? "");
  const input = payload.tool_input ?? {};
  const resolved = resolveHost(host, env);
  const browser = BROWSER.exec(tool);
  return toolCall({
    host: resolved,
    agent: resolved === "claude-code" ? payload.agent_type : undefined,
    kind: browser ? "browser" : KINDS[tool] ?? "unknown",
    tool,
    command: input.command,
    paths: [input.file_path ?? input.notebook_path],
    urls: [input.url],
    subagent: input.subagent_type,
    browserAction: browser?.[1],
    sessionId: payload.session_id,
  });
}

// verdict: { decision: "allow" | "ask" | "deny", rule?, reason? } -> exit code
export function emit({ decision, rule, reason }) {
  if (decision === "deny") {
    process.stderr.write(`Blocked by the framework guard (${rule}): ${reason}\n`);
    return 2;
  }
  if (decision === "ask")
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } }));
  return 0;
}
