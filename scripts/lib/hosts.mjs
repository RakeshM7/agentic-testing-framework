// The hosts that run the agents, and what each can tell the guard about the calling agent. Per-agent permissions
// (config/permissions.yaml) can only be enforced where the guard learns who is calling, so `full-run` is honoured only
// on hosts whose identity source is not `none`; elsewhere every call is capped to readonly (scripts/lib/guard.mjs).
//
//   payload     the hook payload names the agent (Claude Code: `agent_type`)
//   agent-hook  each generated agent file carries its own hook with `--agent <name>` baked in by the build
//               (VS Code Copilot Chat: custom-agent `hooks`, Preview); calls outside a custom agent arrive unidentified
//   none        the host's hook payload has no agent identity (Copilot CLI, cloud coding agent)
//
// A hook registration ASSERTS its host with `--host` (each registration file is read by one host family only); env is
// used to tell apart hosts that share a registration file and to verify an assertion. Dependency-free.

export const HOSTS = {
  "claude-code": { identity: "payload", label: "Claude Code" },
  vscode: { identity: "agent-hook", label: "VS Code Copilot Chat" },
  "copilot-cli": { identity: "none", label: "Copilot CLI" },
  "copilot-cloud": { identity: "none", label: "Copilot cloud coding agent" },
  unknown: { identity: "none", label: "an unrecognized host" },
};

export const identityOf = (host) => (HOSTS[host] ?? HOSTS.unknown).identity;
export const canIdentify = (host) => identityOf(host) !== "none";
export const labelOf = (host) => (HOSTS[host] ?? HOSTS.unknown).label;

// The host a registration asserted, checked against the environment:
//   claude-code   only when Claude Code's own CLAUDE_PROJECT_DIR is set (Copilot CLI also reads .claude/settings.json)
//   vscode        as asserted (only VS Code reads .vscode/hooks/ and runs custom-agent hooks)
//   copilot       .github/hooks/ is read by Copilot CLI and the cloud agent; the cloud agent runs in GitHub Actions
export function resolveHost(asserted, env = process.env) {
  if (asserted === "claude-code") return env.CLAUDE_PROJECT_DIR ? "claude-code" : "unknown";
  if (asserted === "vscode") return "vscode";
  if (asserted === "copilot") return env.GITHUB_ACTIONS === "true" ? "copilot-cloud" : "copilot-cli";
  return "unknown";
}

// Best-effort guess for scripts run from an agent's shell (run.mjs init), where no hook asserts anything. Used only to
// refuse a full-run early with a clear message; the guard's per-call host cap is the actual control.
export function detectShellHost(env = process.env) {
  if (env.CLAUDECODE === "1") return "claude-code";
  if (env.GITHUB_ACTIONS === "true") return "copilot-cloud";
  return "unknown";
}
