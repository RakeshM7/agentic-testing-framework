// The hosts that run the agents, and what each can tell the guard about the calling agent. Per-agent permissions
// (config/permissions.yaml) can only be enforced where the guard learns who is calling, so `full-run` is honoured only
// on hosts whose identity source is not `none`; elsewhere every call is capped to readonly (scripts/lib/guard.mjs).
//
//   payload     the hook payload names the agent (Claude Code: `agent_type`)
//   agent-hook  each generated agent file carries its own hook with `--agent <name>` baked in by the build
//               (VS Code's local agent: custom-agent `hooks`, Preview); calls outside a custom agent arrive unidentified
//   none        the host's hook payload has no agent identity (Copilot CLI, VS Code chat on its Copilot CLI engine,
//               cloud coding agent)
//
// VS Code can run a chat on its Agent Host with the Copilot CLI provider (session type `agent-host-copilotcli`) instead
// of its local agent. That engine is the Copilot CLI runtime bundled in VS Code: it reads .github/hooks/, runs no
// custom-agent hooks, and VS Code sets GITHUB_COPILOT_INTEGRATION_ID=vscode-chat for it (D-032). That variable does not
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

// Best-effort guess for scripts run from an agent's shell (run.mjs init), where no hook asserts anything. Used only to
// refuse a full-run early with a clear message; the guard's per-call host cap is the actual control.
export function detectShellHost(env = process.env) {
  if (env.CLAUDECODE === "1") return "claude-code";
  if (env.GITHUB_ACTIONS === "true") return "copilot-cloud";
  return "unknown";
}
