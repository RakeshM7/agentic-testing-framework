// The hosts that run the agents, and what each can tell the guard about the calling agent. Per-agent permissions
// (config/permissions.yaml) can only be enforced where the guard learns who is calling. On hosts whose identity source
// is `none`, a full-run call gets what at least one of the run's agents may do instead (scripts/lib/guard.mjs, D-035).
//
//   payload     the hook payload names the agent (Claude Code: `agent_type`); a name the adapter can't attribute to a
//               framework agent (another plugin's agent) is marked `unattributed` and treated like `none` (D-035)
//   agent-hook  each generated agent file carries its own hook with `--agent <name>` baked in by the build
//               (VS Code's local agent: custom-agent `hooks`, Preview); calls outside a custom agent arrive unidentified
//   none        the host's hook payload has no agent identity (Copilot CLI, VS Code chat on its Copilot CLI engine,
//               cloud coding agent)
//
// VS Code can run a chat on its Agent Host with the Copilot CLI provider (session type `agent-host-copilotcli`) instead
// of its local agent. That engine is the Copilot CLI runtime bundled in VS Code: it reads .github/hooks/, runs no
// custom-agent hooks, and VS Code sets GITHUB_COPILOT_INTEGRATION_ID=vscode-chat for it (D-035). That variable does not
// reach the agent's terminal (seen live), so only a hook can use it; run.mjs init cannot recognize this engine.
//
// A hook registration ASSERTS its host with `--host` (each registration file is read by one host family only); env is
// used to tell apart hosts that share a registration file and to verify an assertion. Dependency-free.

export const HOSTS = {
  "claude-code": { identity: "payload", label: "Claude Code" },
  vscode: { identity: "agent-hook", label: "VS Code's local agent" },
  "vscode-agent-host": { identity: "none", label: "VS Code chat on its Copilot CLI engine" },
  "copilot-cli": { identity: "none", label: "Copilot CLI" },
  "copilot-cloud": { identity: "none", label: "Copilot cloud coding agent" },
  unknown: { identity: "none", label: "an unrecognized host" },
};

// The framework's Claude Code plugin (packaging §3.12). Its name scopes what Claude Code reports for it: its agents
// arrive as agent_type `atf:<name>`, and its MCP servers' tools are named `mcp__plugin_atf_<server>__<tool>`. The Claude
// adapter (scripts/hooks/hosts/claude.mjs) reads both back as the framework's own; the plugin build names the plugin
// from here, so the two can't drift apart.
export const PLUGIN_NAME = "atf";
export const PLUGIN_MCP_PREFIX = `mcp__plugin_${PLUGIN_NAME}_`;

// Set by VS Code for the Copilot CLI runtime it hosts (VS Code agenthost.log: "Set CLI env").
const vscodeCopilotEngine = (env) => env.GITHUB_COPILOT_INTEGRATION_ID === "vscode-chat";

export const identityOf = (host) => (HOSTS[host] ?? HOSTS.unknown).identity;
export const canIdentify = (host) => identityOf(host) !== "none";
export const labelOf = (host) => (HOSTS[host] ?? HOSTS.unknown).label;

// The host a registration asserted, checked against the environment:
//   claude-code   only when Claude Code's own CLAUDE_PROJECT_DIR is set (Copilot CLI also reads .claude/settings.json)
//   vscode        as asserted (only VS Code's local agent reads .vscode/hooks/ and runs custom-agent hooks)
//   copilot       .github/hooks/ is read by Copilot CLI, VS Code chat on its Copilot CLI engine and the cloud agent;
//                 the cloud agent runs in GitHub Actions; anything else there counts as Copilot CLI (also none)
export function resolveHost(asserted, env = process.env) {
  if (asserted === "claude-code") return env.CLAUDE_PROJECT_DIR ? "claude-code" : "unknown";
  if (asserted === "vscode") return "vscode";
  if (asserted === "copilot") return env.GITHUB_ACTIONS === "true" ? "copilot-cloud" : vscodeCopilotEngine(env) ? "vscode-agent-host" : "copilot-cli";
  return "unknown";
}

// Best-effort guess for scripts run from an agent's shell (run.mjs init), where no hook asserts anything. Recorded as
// the run's `startedOnHost`; the guard decides per call from the host its hook asserted.
export function detectShellHost(env = process.env) {
  if (env.CLAUDECODE === "1") return "claude-code";
  if (env.GITHUB_ACTIONS === "true") return "copilot-cloud";
  return "unknown";
}
