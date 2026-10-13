# Platforms and hosts

The pipeline, contracts, scripts and guard are platform-neutral. This doc is the only place for what differs per host. The reasons behind each choice are in [`decisions.md`](decisions.md) (D-018 – D-040).

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

VS Code Copilot Chat can run a chat on two engines. They behave differently for the guard, so they have separate columns (D-035, D-039).

| | Claude Code | VS Code: local agent | VS Code: Copilot CLI engine | Copilot CLI | Copilot cloud coding agent |
|---|---|---|---|---|---|
| Agent files | `.claude/agents/` | `.github/agents/` (`.claude/agents` turned off) | `.github/agents/` | `.github/agents/` | `.github/agents/` |
| Start a run | `claude --agent orchestrator-agent` | a local agent chat, then pick **orchestrator-agent** | a chat on the Copilot CLI engine (VS Code log: session type `agent-host-copilotcli`) | `copilot --agent orchestrator-agent` | assign an issue (maintenance only) |
| Nested subagents (3 layers) | yes | yes, with `chat.subagents.allowInvocationsFromSubagents` | not verified | not verified | n/a |
| Hook registration | `.claude/settings.json` | `.vscode/hooks/` + each agent's own hook | `.github/hooks/` (seen live) | `.github/hooks/` | `.github/hooks/` |
| Guard knows the calling agent | yes (`agent_type`) | yes (build-baked `--agent`) | **no** | **no** | **no** |
| `full-run` | yes, per agent | yes, per agent | yes, **combined ceiling** | yes, **combined ceiling** | yes, **combined ceiling** |
| Ask the human | `AskUserQuestion` | `vscode/askQuestions` | not verified | `ask_user` | none: stops and reports |
| Live browser (Playwright MCP) | `.mcp.json` | `.vscode/mcp.json` | starts the Playwright server (seen live) | register the server from `config/mcp.yaml` in the CLI's MCP config | none |
| Design-decision confirmation | permission prompt | permission prompt | permission prompt | permission prompt | refused, reported in the PR |

**Combined ceiling** (D-035): where the guard can't tell which agent is calling, a full-run call may do what at least one of the run's agents may do. The run's agents are the layer-0 agents and everything they can spawn, so not `feedback-implementor-agent`.
- **Still blocked:** writes outside the pipeline's paths, starting agents outside the run, deletes of entities the run didn't create, and unmapped tools.
- **Lost:** one agent can do another agent's job. For example, a reviewer could edit tests, or a test writer could change data over HTTP.
- **Readonly runs:** unchanged on these hosts.

## Setup

### Claude Code
1. `npm install` (the hooks themselves need only Node).
2. Start the session with `claude --agent orchestrator-agent` and give it `config/<product>.yaml`.
3. `.claude/settings.json` registers `scripts/hooks/pretooluse.mjs` and `posttooluse.mjs` with `--host claude-code`.

**Hook registrations on every host are generated** from `config/hooks.yaml` by `npm run build-agents` (D-042); never hand-edit them. The PreToolUse guard is always registered and blocking. The PostToolUse hook, which only remembers confirmed design decisions, is set for all hosts with:

```
npm run build-agents -- --post-hook async   # default: Claude Code runs it in the background; Copilot and VS Code wait for it
npm run build-agents -- --post-hook sync    # every host waits for it
npm run build-agents -- --post-hook off     # not registered: faster, but every governed edit asks again
```

### VS Code Copilot Chat
1. Open the repo and **trust the workspace**. VS Code loads hooks and MCP servers only in a trusted workspace. Without hooks, the guard check (step 4) stops every run.
2. The committed `.vscode/settings.json` does five things:
   - turns `.claude/agents` off, so every agent is listed once;
   - enables nested subagents;
   - loads hooks from `.vscode/hooks/` but not `.github/hooks/` or `.claude/settings.json`;
   - uses `AGENTS.md`;
   - auto-approves only repo-local, non-mutating commands.
3. Start a **local agent** chat and pick **orchestrator-agent** in the agent picker. Workers are hidden (`user-invocable: false`); the orchestrators start them.
   - VS Code 1.141 can also run a chat on its **Copilot CLI engine**: the Copilot CLI runtime that VS Code bundles. That engine doesn't follow `.vscode/settings.json`. It uses `.github/agents/` and `.github/hooks/` like Copilot CLI and runs no custom-agent hooks, so the guard can't tell which agent is calling. A full-run there gives every call the run's combined ceiling (D-035).
4. The orchestrator runs `node scripts/run.mjs guard-check <product>` first, and the guard must block it.
   - In VS Code's local agent, each custom agent's own hook names the agent to the guard. That is the Preview "custom agent hooks" feature.
   - If those hooks don't run, full-run is refused, and readonly still works.

### Copilot CLI
1. Run `copilot` from the repo root. It loads `.github/agents/` and `.github/hooks/`.
2. For live browser work, register the Playwright server from `config/mcp.yaml` in the CLI's MCP config, keeping the name `playwright`.
3. `copilot --agent orchestrator-agent`. The CLI's hooks can't tell the guard which agent is calling, so a full-run gives every call the run's combined ceiling (D-035).

### Copilot cloud coding agent
1. Assign an issue and pick an agent; `AGENTS.md` is its brief. `.github/workflows/copilot-setup-steps.yml` installs the scripts, the generated projects' dependencies and k6.
2. It is for framework maintenance and offline work only (D-030). It has no live browser. A full-run there gets the run's combined ceiling, as on the CLI (D-038). It can't answer a confirmation, so edits to decision-governed files are refused and it reports them in the PR.

## When the guard check fails

`run.mjs stage … start` refuses until the session's guard is verified (D-024).
- **"the guard did not intercept guard-check"**: hooks are not running in this session.
  - VS Code: trust the workspace, keep `chat.useHooks` on, keep `.vscode/settings.json` as committed.
  - Claude Code: check `.claude/settings.json`.
  - If the hook ran but didn't block (VS Code's Hooks log shows the guard's deny as `NonBlockingError`), the host didn't receive a block it honours. On VS Code, `scripts/hooks/hosts/index.mjs` must map `vscode` to `vscode.mjs` (D-040). If VS Code also ignores a deny decision on exit 0, its hooks don't enforce in that build: update VS Code, or run the pipeline on Claude Code.
  - Then run `run.mjs guard-check <product>` again.
- **"full-run on VS Code's local agent needs the custom agents' own hooks"**: the guard check was blocked, but not by an agent's own hook. There, an unidentified call counts as your own session and gets no per-agent limits (D-037).
  - Start the run from **orchestrator-agent** in the agent picker, keep `chat.useHooks` on, then run the guard check again. Or switch the run-config to `readonly`.
  - The host that blocked the check is in `artifacts/<product>/state/guard-check/`. In VS Code, a `vscode-agent-host--…` or `copilot-cli--…` record means the chat ran on the Copilot CLI engine, where the combined ceiling applies.
- **"unmapped tool …"** (during a run): the host has a tool the adapter doesn't know. Add it to `scripts/hooks/hosts/<adapter>.mjs` with a test, then retry.

## Verified facts (2026-10-11)

From GitHub's and VS Code's documentation:
- **VS Code agent files.** VS Code reads both `.github/agents/*.agent.md` and `.claude/agents/*.md`. Custom agents support `agents` (subagent allow-list, needs the `agent` tool), `user-invocable`, `disable-model-invocation`, `model` and `hooks` (Preview, Local harness, only while that agent is active).
- **VS Code nesting.** Nested subagents need `chat.subagents.allowInvocationsFromSubagents` (max depth 5). Local subagents have no ask-question tool.
- **Copilot tool aliases.** GitHub custom agents accept the aliases `read`, `edit`, `search`, `execute`, `web`, `agent` and `server/tool` MCP names, and ignore unknown tools. The prompt limit is 30,000 characters.
- **Copilot hook files.** Copilot CLI reads `.github/hooks/*.json` and also `.claude/settings.json`; the cloud agent reads only `.github/hooks/*.json`.
- **Copilot hook payloads.** PascalCase `PreToolUse` sends snake_case fields with Claude tool names. There is no calling-agent field.
- **Copilot CLI and cloud agent hook outcomes.** Exit 2, or any non-zero exit from a pre-tool hook, denies the call. A timeout fails open. On the cloud agent, `ask` counts as deny.
- **VS Code hook outcomes.** These differ from the CLI's:
  - exit 0: VS Code parses stdout, and a `hookSpecificOutput.permissionDecision` of `deny` blocks the call;
  - exit 2: blocks, with stderr as the reason;
  - any other exit: a non-blocking warning (`NonBlockingError` in VS Code's Hooks log), and the call runs.

  So the VS Code adapter always denies with a decision on stdout and exit 0 (D-040).

Seen live in VS Code 1.141 (2026-10-11), on a chat that ran on the Copilot CLI engine:
- **The engine.** VS Code's `agenthost.log` showed session type `agent-host-copilotcli`, the bundled `copilot-sdk` runtime, and `GITHUB_COPILOT_INTEGRATION_ID=vscode-chat` set for it. The agent's terminal does not have that variable.
- **Its files.** It used the generated `.github/agents/` file (its tool aliases) and `.github/hooks/framework-guard.json`. Neither `.vscode/hooks/` nor the agent's own hook ran.
- **Its tools.** The CLI's tool names appeared: `bash`, `view`, `rg`, `read_bash`, `ask_user`, and `task` with the subagent name in `agent_type`. These come from the session records in `~/.copilot/session-state/`.
- **Its model.** The model was `auto`, which resolved to `gpt-6-luna`, the only model offered. The agent's `model:` line was not applied.

Seen live in VS Code (2026-10-12), on the local agent on Windows:
- **Both registrations ran.** `.vscode/hooks/` (record `vscode--unidentified`) and orchestrator-agent's own hook (record `vscode--orchestrator-agent`) both judged `run_in_terminal` calls.
- **Exit 2 did not block.** VS Code's Hooks log showed every guard deny as `NonBlockingError`, and the tool ran anyway.
  - VS Code's hook executor runs a hook through `powershell.exe -Command` when `ComSpec` is `cmd.exe`. PowerShell turns a native exit 2 into 1.
  - The guard check caught it: `run.mjs` recorded `absent`, and no stage started.
  - Since D-040, the VS Code adapter denies with exit 0 and a decision on stdout.

Not yet verified on a live session. Each has a fail-safe default, and a mismatch shows up as a denied call or a refused full-run, never as a silent bypass:
- Whether the hook process receives `GITHUB_COPILOT_INTEGRATION_ID` on the Copilot CLI engine. If it doesn't, that engine is labelled "Copilot CLI", which has the same limits. The next guard check there shows which: the record is named `vscode-agent-host--…` or `copilot-cli--…`.
- VS Code's exact tool names and argument fields (`scripts/hooks/hosts/copilot.mjs`), and whether `chat.hookFilesLocations` and `chat.agentFilesLocations` behave as configured.
- Whether a custom agent's own hook runs, with its `--agent`, when that agent runs **as a subagent**. If it doesn't, VS Code full-run is refused by the guard check.
- Whether Copilot CLI supports three levels of custom-agent subagents. If it doesn't, start the domain orchestrators one by one.
- Whether Copilot accepts `gpt-6-luna` as the agents' `model:` name (`config/models.yaml`, D-034). An unknown name falls back to the surface's default model.

To verify, register a temporary audit hook that appends each payload to a git-ignored file, run one agent per host, and turn the captured payloads into fixtures for `scripts/hooks.test.mjs`.
