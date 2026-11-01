// The hosts that run the agents, and what each can tell the guard about the calling agent. Per-agent permissions
// (config/permissions.yaml) can only be enforced where the guard learns who is calling. On hosts whose identity source
// is `none`, a full-run call gets what at least one of the run's agents may do instead (scripts/lib/guard.mjs, D-035).
//
//   payload     the hook payload names the agent (Claude Code: `agent_type`); a name the adapter can't attribute to a
//               framework agent (another plugin's agent) is marked `unattributed` and treated like `none` (D-035)
//   agent-hook  each generated agent file carries its own hook with `--agent <name>` baked in by the build
//               (VS Code's local agent: custom-agent `hooks`, Preview); calls outside a custom agent arrive unidentified
//   none        the host's hook payload has no agent identity (Copilot CLI, VS Code chat on its Copilot CLI engine,
//               cloud coding agent, Antigravity, Codex)
//
// Antigravity (App, `agy` CLI, IDE) reads .agents/hooks.json. Its documented payload has no agent identity, and whether
// it runs a hook carried by a generated agent is UNVERIFIED (Antigravity spike pending, docs/antigravity-spike/), so it
// is `none` until the spike shows a trusted source: a full-run there gets the run's combined ceiling (D-035).
//
// Codex (CLI, app and IDE extension) reads the project's .codex/hooks.json. Its documented PreToolUse payload has no
// agent identity either, and nothing is known to make a subagent's calls carry one, so it is `none` until the spike
// (docs/codex-spike/) shows a trusted source: a full-run there gets the run's combined ceiling (D-035). Hosted web
// search and computer use can't be hooked or classified, so unknown tools are refused during every run (below).
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
  antigravity: { identity: "none", label: "Antigravity", unknownTools: "deny-in-run" },
  codex: { identity: "none", label: "Codex", unknownTools: "deny-in-run" },
  unknown: { identity: "none", label: "an unrecognized host" },
};

// `unknownTools: "deny-in-run"`: during an active run (readonly included) a tool the host's adapter can't classify is
// refused for EVERY caller, attributed or not, a stricter form of D-036 (D-101). Antigravity and Codex only: the
// Antigravity built-in browser tools drive the user's own Chrome without the framework's network guard and are unmapped
// by design, and Codex has tools the hooks can't classify (computer use, other MCP servers' tools). Every other host
// keeps D-036 as recorded. This only ever adds denials; it never allows a call D-036 would refuse.
export const deniesUnknownInRun = (host) => (HOSTS[host] ?? HOSTS.unknown).unknownTools === "deny-in-run";

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
//   antigravity   as asserted: no Antigravity environment variable is documented to verify it with (UNVERIFIED,
//                 Antigravity spike pending, docs/antigravity-spike/). Accepting it grants nothing: its identity is
//                 `none`, as for `unknown`; only the label differs (and unknown tools are refused in a run, D-101).
//   codex         as asserted, likewise: no Codex environment variable is documented to verify it with (UNVERIFIED
//                 (Codex spike pending, docs/codex-spike/)). Accepting it grants nothing: identity `none`; the label and
//                 the stricter unknown-tool rule are all it changes, and the latter only adds denials.
export function resolveHost(asserted, env = process.env) {
  if (asserted === "claude-code") return env.CLAUDE_PROJECT_DIR ? "claude-code" : "unknown";
  if (asserted === "vscode") return "vscode";
  if (asserted === "copilot") return env.GITHUB_ACTIONS === "true" ? "copilot-cloud" : vscodeCopilotEngine(env) ? "vscode-agent-host" : "copilot-cli";
  if (asserted === "antigravity") return "antigravity";
  if (asserted === "codex") return "codex";
  return "unknown";
}

// Best-effort guess for scripts run from an agent's shell (run.mjs init), where no hook asserts anything. Recorded as
// the run's `startedOnHost`; the guard decides per call from the host its hook asserted. Antigravity documents no
// environment variable for its terminal (UNVERIFIED, Antigravity spike pending, docs/antigravity-spike/), so a run it
// starts records `unknown` until the spike finds one.
export function detectShellHost(env = process.env) {
  if (env.CLAUDECODE === "1") return "claude-code";
  if (env.GITHUB_ACTIONS === "true") return "copilot-cloud";
  return "unknown";
}
