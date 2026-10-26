// GitHub Copilot adapter: VS Code Copilot Chat, Copilot CLI and the cloud coding agent.
// Payloads come in two casings: PascalCase events give { session_id, cwd, tool_name, tool_input } (Claude tool names on
// the CLI and cloud agent), camelCase events give { sessionId, cwd, toolName, toolArgs } (toolArgs may be a JSON string).
// The payload never names the calling agent: identity comes ONLY from the `--agent` argument the build bakes into each
// generated agent's own hook (config/platforms.yaml identity_hook), never from anything the model controls.
// Output, for Copilot CLI and the cloud agent: block = exit 2 + stderr + a deny decision on stdout; confirm = an ask
// decision on stdout, exit 0 (the cloud agent treats ask as deny). VS Code's local agent reads its payloads here too but
// needs its own output, never an exit code (./vscode.mjs, D-040). VS Code ignores hook matchers, so every tool call
// arrives here.
//
// Tool names: Claude's and the CLI's are documented; VS Code's are from its Local harness and must be re-checked with
// an audit hook when VS Code changes them (docs/platforms.md). An unmapped tool is `unknown`, which the guard blocks
// during a run for managed agents and, in full-run, for every call it cannot attribute (D-036) -- add it here, with a
// fixture in scripts/fixtures/hooks/.
import { resolveHost } from "../../lib/hosts.mjs";
import { toolCall } from "../../lib/tool-call.mjs";

const KINDS = {
  // Claude names (PascalCase hooks on Copilot CLI and the cloud agent)
  Read: "read", Glob: "read", Grep: "read", LS: "read", NotebookRead: "read",
  Write: "write", Edit: "write", MultiEdit: "write", NotebookEdit: "write",
  Bash: "shell", PowerShell: "shell", WebFetch: "web_fetch", WebSearch: "web_search", Agent: "spawn", Task: "spawn",
  AskUserQuestion: "ask", TodoWrite: "other",
  // Copilot CLI / cloud agent native names
  view: "read", glob: "read", grep: "read", create: "write", edit: "write", bash: "shell", powershell: "shell",
  web_fetch: "web_fetch", task: "spawn", ask_user: "ask", rg: "read", read_bash: "read",
  // Loads deferred tools' definitions (e.g. the Playwright MCP tools) and runs nothing; each loaded tool is judged on use.
  tool_search_tool: "other",
  // Autopilot's end-of-turn signal (args: { summary }); runs nothing and touches no run state (seen 2026-10-19).
  task_complete: "other",
  // VS Code Copilot Chat (Local harness)
  read_file: "read", view_image: "read", list_dir: "read", file_search: "read", grep_search: "read", semantic_search: "read",
  get_errors: "read", get_changed_files: "read", test_failure: "read", get_terminal_output: "read",
  terminal_last_command: "read", terminal_selection: "read",
  create_file: "write", create_directory: "write", replace_string_in_file: "write", multi_replace_string_in_file: "write",
  insert_edit_into_file: "write", edit_file: "write", apply_patch: "write", edit_notebook_file: "write",
  run_in_terminal: "shell", runInTerminal: "shell", local_shell: "shell",
  fetch_webpage: "web_fetch", runSubagent: "spawn", run_subagent: "spawn",
  vscode_askQuestions: "ask", ask_questions: "ask", manage_todo_list: "other",
};
const BROWSER = /playwright.*?browser_(\w+)$/i;


// Copilot CLI's apply_patch arrives as `Edit` whose arguments are the bare patch text, not an object: read it as a patch.
const PATCH = /^\s*\*\*\* Begin Patch\b/;

function argsOf(payload) {
  let raw = payload.tool_input ?? payload.toolArgs ?? {};
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      // not JSON: a bare command or patch
    }
  }
  if (typeof raw === "string") return PATCH.test(raw) ? { input: raw } : { command: raw };
  return raw ?? {};
}


// Every file a write call touches, across the hosts' argument shapes (incl. multi-file edits and apply_patch text).
function pathsOf(a) {
  const out = [a.file_path, a.filePath, a.path, a.notebook_path, a.dirPath];
  for (const r of Array.isArray(a.replacements) ? a.replacements : []) out.push(r?.filePath ?? r?.file_path);
  const patch = typeof a.input === "string" ? a.input : typeof a.patch === "string" ? a.patch : "";
  for (const m of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) out.push(m[1].trim());
  return out;
}

export const rootOf = (payload) => payload?.cwd || process.cwd();

export function normalize(payload, { env = process.env, host = "copilot", agent } = {}) {
  const tool = String(payload.tool_name ?? payload.toolName ?? "");
  const a = argsOf(payload);
  const browser = BROWSER.exec(tool);
  return toolCall({
    host: resolveHost(host, env),
    agent,
    kind: browser ? "browser" : KINDS[tool] ?? "unknown",
    tool,
    command: a.command,
    paths: pathsOf(a),
    urls: [a.url, ...(Array.isArray(a.urls) ? a.urls : [])],
    subagent: a.subagent_type ?? a.agent_type ?? a.agentName ?? a.agent_name ?? a.agent,
    browserAction: browser?.[1],
    sessionId: payload.session_id ?? payload.sessionId,
  });
}

export function emit({ decision, rule, reason }) {
  if (decision === "allow") return 0;
  const message = decision === "deny" ? `Blocked by the framework guard (${rule}): ${reason}` : reason;
  // Both shapes: top-level for camelCase hooks, hookSpecificOutput for PascalCase (Claude-compatible) hooks.
  process.stdout.write(
    JSON.stringify({
      permissionDecision: decision,
      permissionDecisionReason: message,
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: decision, permissionDecisionReason: message },
    })
  );
  if (decision === "deny") {
    process.stderr.write(`${message}\n`);
    return 2;
  }
  return 0;
}
