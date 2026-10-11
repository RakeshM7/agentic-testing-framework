# Platforms and hosts

The pipeline, contracts, scripts and guard are platform-neutral. This doc is the only place for what differs per host. The reasons behind each choice are in [`decisions.md`](decisions.md) (D-018 – D-030).

## How one agent becomes every platform's file

```
agents/<name>.md            identity + neutral prompt body    (the ONLY hand-written copy)
config/permissions.yaml     capabilities -> tools, subagents  (per agent)
config/models.yaml          model per platform
config/platforms.yaml       each platform's tool names, output path, MCP file, limits, identity hook
config/mcp.yaml             MCP servers
      │  npm run build-agents          (npm run check / CI: fail on drift, stray or hand-edited files)
      ▼
.claude/agents/<name>.md           Claude Code
.github/agents/<name>.agent.md     VS Code Copilot Chat, Copilot CLI, cloud coding agent
.mcp.json, .vscode/mcp.json        MCP servers for Claude Code / VS Code
```

To change an agent, edit `agents/<name>.md` (body, `description`, `color`, `user_invocable`) and rebuild. To change what it may do, edit `config/permissions.yaml`, a human decision (D-013). Start a new session afterwards, since every host loads agents at session start.

## Host matrix

| | Claude Code | VS Code Copilot Chat | Copilot CLI | Copilot cloud coding agent |
|---|---|---|---|---|
| Agent files | `.claude/agents/` | `.github/agents/` (`.claude/agents` turned off) | `.github/agents/` | `.github/agents/` |
| Start a run | `claude --agent orchestrator-agent` | pick **orchestrator-agent** in the agent picker | `copilot --agent orchestrator-agent` | assign an issue (maintenance only) |
| Nested subagents (3 layers) | yes | yes, with `chat.subagents.allowInvocationsFromSubagents` | not verified | n/a |
| Hook registration | `.claude/settings.json` | `.vscode/hooks/` + each agent's own hook | `.github/hooks/` | `.github/hooks/` |
| Guard knows the calling agent | yes (`agent_type`) | yes (build-baked `--agent`) | **no** | **no** |
| `full-run` | yes | yes | **no: readonly only** | **no: readonly only** |
| Ask the human | `AskUserQuestion` | `vscode/askQuestions` | `ask_user` | none: stops and reports |
| Live browser (Playwright MCP) | `.mcp.json` | `.vscode/mcp.json` | register the server from `config/mcp.yaml` in the CLI's MCP config | none |
| Design-decision confirmation | permission prompt | permission prompt | permission prompt | refused, reported in the PR |

## Setup

### Claude Code
1. `npm install` (the hooks themselves need only Node).
2. Start the session with `claude --agent orchestrator-agent` and give it `config/<product>.yaml`.
3. `.claude/settings.json` registers `scripts/hooks/pretooluse.mjs` and `posttooluse.mjs` with `--host claude-code`.

### VS Code Copilot Chat
1. Open the repo and **trust the workspace**. VS Code loads hooks and MCP servers only in a trusted workspace. Without hooks, the guard check (step 4) stops every run.
2. The committed `.vscode/settings.json` does five things:
   - turns `.claude/agents` off, so every agent is listed once;
   - enables nested subagents;
   - loads hooks from `.vscode/hooks/` but not `.github/hooks/` or `.claude/settings.json`;
   - uses `AGENTS.md`;
   - auto-approves only repo-local, non-mutating commands.
3. Pick **orchestrator-agent** in the agent picker. Workers are hidden (`user-invocable: false`); the orchestrators start them.
4. The orchestrator runs `node scripts/run.mjs guard-check <product>` first, and the guard must block it.
   - On VS Code, each custom agent's own hook names the agent to the guard. That is the Preview "custom agent hooks" feature.
   - If those hooks don't run, full-run is refused, and readonly still works.

### Copilot CLI
1. Run `copilot` from the repo root. It loads `.github/agents/` and `.github/hooks/`.
2. For live browser work, register the Playwright server from `config/mcp.yaml` in the CLI's MCP config, keeping the name `playwright`.
3. `copilot --agent orchestrator-agent`. Runs are **readonly only**: the CLI's hooks can't tell the guard which agent is calling (D-022).

### Copilot cloud coding agent
1. Assign an issue and pick an agent; `AGENTS.md` is its brief. `.github/workflows/copilot-setup-steps.yml` installs the scripts, the generated projects' dependencies and k6.
2. It is for framework maintenance and offline work only (D-030). It has no live browser and is readonly. It can't answer a confirmation, so edits to decision-governed files are refused and it reports them in the PR.

## When the guard check fails

`run.mjs stage … start` refuses until the session's guard is verified (D-024).
- **"the guard did not intercept guard-check"**: hooks are not running in this session.
  - VS Code: trust the workspace, keep `chat.useHooks` on, keep `.vscode/settings.json` as committed.
  - Claude Code: check `.claude/settings.json`.
  - Then run `run.mjs guard-check <product>` again.
- **"full-run needs a host where the guard identifies the calling agent"**: use Claude Code or VS Code, or switch the run-config to `readonly`.
- **"unmapped tool …"** (during a run): the host has a tool the adapter doesn't know. Add it to `scripts/hooks/hosts/<adapter>.mjs` with a test, then retry.

## Verified facts (2026-10-11)

From GitHub's and VS Code's documentation:
- **VS Code agent files.** VS Code reads both `.github/agents/*.agent.md` and `.claude/agents/*.md`. Custom agents support `agents` (subagent allow-list, needs the `agent` tool), `user-invocable`, `disable-model-invocation`, `model` and `hooks` (Preview, Local harness, only while that agent is active).
- **VS Code nesting.** Nested subagents need `chat.subagents.allowInvocationsFromSubagents` (max depth 5). Local subagents have no ask-question tool.
- **Copilot tool aliases.** GitHub custom agents accept the aliases `read`, `edit`, `search`, `execute`, `web`, `agent` and `server/tool` MCP names, and ignore unknown tools. The prompt limit is 30,000 characters.
- **Copilot hook files.** Copilot CLI reads `.github/hooks/*.json` and also `.claude/settings.json`; the cloud agent reads only `.github/hooks/*.json`.
- **Copilot hook payloads.** PascalCase `PreToolUse` sends snake_case fields with Claude tool names. There is no calling-agent field.
- **Copilot hook outcomes.** Exit 2, or any non-zero exit from a pre-tool hook, denies the call. A timeout fails open. On the cloud agent, `ask` counts as deny.

Not yet verified on a live session. Each has a fail-safe default, and a mismatch shows up as a denied call or a refused full-run, never as a silent bypass:
- VS Code's exact tool names and argument fields (`scripts/hooks/hosts/copilot.mjs`), and whether `chat.hookFilesLocations` and `chat.agentFilesLocations` behave as configured.
- Whether a custom agent's own hook runs, with its `--agent`, when that agent runs **as a subagent**. If it doesn't, VS Code full-run is refused by the guard check.
- Whether Copilot CLI supports three levels of custom-agent subagents. If it doesn't, start the domain orchestrators one by one.
- The exact Copilot model name for Claude Opus 5.5 (`config/models.yaml`). An unknown name falls back to the surface's default model.

To verify, register a temporary audit hook that appends each payload to a git-ignored file, run one agent per host, and turn the captured payloads into fixtures for `scripts/hooks.test.mjs`.
