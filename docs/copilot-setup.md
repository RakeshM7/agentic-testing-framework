# GitHub Copilot flavor — setup and platform notes

This is the Copilot companion to `docs/conventions.md`, which stays platform-agnostic. Read that first for the pipeline, artifact and feedback contracts. This doc covers only what differs when running the framework under GitHub Copilot instead of Claude Code.

## Where the Copilot agents come from

The Copilot agents in `.github/agents/*.agent.md` are **generated**. Each persona is written once in `agents/src/<agent>.md`; `node scripts/build-agents.mjs` renders it for both platforms, using `agents/manifest.yaml` for tool names and platform-only frontmatter and `config/models.yaml` for models. Never edit a file in `.github/agents/` (or `.claude/agents/`) by hand; CI rejects it. To change how an agent behaves on either platform, see "Changing an agent's behavior" in `docs/conventions.md`.

One `.agent.md` file serves all three Copilot surfaces this framework supports: **VS Code Copilot Chat**, **Copilot CLI** and the **GitHub cloud coding agent**.

## Setup

### VS Code Copilot Chat
1. Open the repo in VS Code and **trust the workspace**. MCP servers and hooks don't load in an untrusted workspace.
2. The committed `.vscode/settings.json`:
   - hides the Claude Code copies in `.claude/agents` from VS Code's agent picker (`chat.agentFilesLocations`); otherwise every agent shows up twice;
   - enables hooks from `.github/hooks/` and keeps `chat.useClaudeHooks` off, so the authorization guard runs exactly once;
   - auto-approves only non-mutating, repo-local terminal commands.
3. The Playwright MCP server `playwright` is registered in `.vscode/mcp.json`, which is generated from `agents/manifest.yaml` and installed on first use via `npx`. Its `--storage-state` file (`playwright-tests/<product>/.auth/...`) must exist for an authenticated crawl. It is produced by a human logging in once, exactly as for Claude Code.
4. Pick an agent (e.g. `orchestrator-agent`) in the Chat agent picker. The orchestrator invokes the six spokes itself as subagents (`'agent'` tool + `agents:` list).

### Copilot CLI
1. Run `copilot` from the repo root. It loads `.github/agents/` and `.github/hooks/`.
2. Register the same Playwright MCP server for the CLI (only needed for explore-agent). Use the server definition from `.vscode/mcp.json` in your CLI MCP config (`/mcp add` or `~/.copilot/mcp-config.json`), keeping the name `playwright` so the agent's `playwright/browser_*` tool names resolve.
3. Run the orchestrator as the main session: `copilot --agent orchestrator-agent --prompt "configPath: config/<your-config>.yaml"`. Or run a single spoke the same way.
4. Tool approvals: grant shell access narrowly, e.g. `--allow-tool 'shell(node:*)' --allow-tool 'shell(npx playwright:*)'`. The authorization guard blocks live k6 and mutating `curl` regardless of approvals.

### GitHub cloud coding agent
1. Assign an issue to Copilot and pick the custom agent. `AGENTS.md` is the brief it reads first.
2. `.github/workflows/copilot-setup-steps.yml` installs the scripts, Playwright and API-test dependencies, a Chromium browser and k6 before the agent starts.
3. **explore-agent does not run here.** It needs an interactive browser session and the local `.auth/` session file. The agent halts and asks for the crawl to be run in VS Code or the CLI with its artifacts committed. Every other persona works from committed artifacts.
4. **Safety:** `.github/hooks/authorization-guard.json` applies on the cloud agent too. Live k6 runs and mutating `curl` stay blocked unless a maintainer sets **both** Copilot environment variables (Settings → Environments → `copilot`):
   - `AUTHORIZATIONS_MODE=full-run`
   - `AUTHORIZATIONS_CONFIG=<path to a committed run-config whose authorizations.mode is full-run>`

   Any live target host must also be allowed in the Copilot firewall settings. Treat both as maintainer-only settings: whoever can edit the `copilot` environment can enable full-run for the named config.

## Claude Code feature → Copilot alternative

| Claude Code feature this framework uses | Copilot alternative | How the framework handles it |
|---|---|---|
| `.claude/agents/*.md` discovery | `.github/agents/*.agent.md` (VS Code, CLI, cloud agent) | Both generated from `agents/src/` |
| `tools:` with `Read`, `Write`, `Edit`, `Glob`, `Grep`, `Bash`, `WebFetch`, `WebSearch` | GitHub's tool aliases `read`, `edit`, `search`, `execute`, `web`, `agent` | Capability map in `agents/manifest.yaml` |
| `model: sonnet` | `model:` with a Copilot model display name | `config/models.yaml`, Claude model of the same tier first, so both flavors run the same model family |
| `color:` | none | Claude-only frontmatter |
| explore-agent's inline `mcpServers` (a fresh isolated browser per invocation) | No per-agent MCP server in VS Code; workspace `.vscode/mcp.json` / CLI MCP config | Explorers share one browser, so the orchestrator runs them **one at a time** on Copilot, whatever `explore_concurrency` says |
| `mcp__<server>__<tool>` tool names | `<server>/<tool>` | `{{browser:<tool>}}` token in the source |
| `Agent(a, b, …)` spawn allowlist | `'agent'` in `tools` + `agents: [a, b, …]` | Rendered from the manifest's `subagents:` list |
| Parallel / background subagents for full-product tracks | Not documented for VS Code's local agent | The orchestrator runs tracks one after another if it can't run them concurrently; same artifacts and results |
| Subagents can't spawn subagents | Same default in VS Code (`chat.subagents.allowInvocationsFromSubagents` is off) | Shared rule: only the orchestrator spawns agents |
| `AskUserQuestion` (main session only) | `vscode/askQuestions` (VS Code) and `ask_user` (Copilot CLI), both main-session only; no human on the cloud agent | `{{v:ask_tool}}`. The orchestrator's per-module walkthrough works in VS Code and the CLI. Subagents and the cloud agent halt and report |
| `claude --agent orchestrator-agent` | VS Code agent picker; `copilot --agent orchestrator-agent`; issue assignment on GitHub | Documented above |
| PreToolUse hook in `.claude/settings.json` | `.github/hooks/*.json` (`PreToolUse`, exit 2 = deny) | One script, `scripts/hooks/guard-shell.mjs`, registered for both. It accepts every platform's payload shape and filters by shell tool name itself, because VS Code ignores hook matchers |
| `$CLAUDE_PROJECT_DIR` in hook commands | hook `cwd` (relative to the repo root) | `cwd: "."` |
| `.claude/settings.local.json` permission allowlist | `chat.tools.terminal.autoApprove` (VS Code); `--allow-tool` (CLI); the cloud agent pre-approves inside its sandbox | Conservative `.vscode/settings.json`; the guard hook is the hard gate everywhere |
| `WebSearch` | None: VS Code has only `web/fetch`, and the cloud agent has no web tool | Research is fetch-only: run-config `knowledge_urls` first, then known vendor-doc URLs |
| Workspace trust for inline MCP servers | VS Code Workspace Trust (gates MCP servers and hooks) | Trust the workspace |
| Credential-leak classifier | None documented (GitHub secret scanning / push protection cover commits) | Unchanged: secrets are only ever passed as file paths |
| `CLAUDE.md` / `AGENTS.md` | `AGENTS.md` is read by all three Copilot surfaces | `AGENTS.md` is the cloud agent's brief |
| — | Cloud agent environment: `copilot-setup-steps.yml` + firewall allowlist | Committed workflow |
| — | GitHub's 30,000-character limit on a custom agent's prompt | The build fails above it (orchestrator-agent is ~25.7k) |

## Verified on 2026-10-11

Checked against VS Code 1.140.0 (built-in Copilot Chat), the local Copilot agent-host logs and GitHub's docs:
- VS Code scans `.github/agents`, `.claude/agents` and `~/.copilot/agents` by default; `chat.agentFilesLocations` with `".claude/agents": false` turns the Claude folder off.
- Shell tool names in hook payloads are `bash`, `powershell`, `local_shell`, `runInTerminal`, `run_in_terminal` and `Bash`. Copilot CLI / agent host calls its shell `bash` with `toolArgs.command`.
- VS Code exposes `vscode/askQuestions`; Copilot CLI / agent host exposes `ask_user`. Neither is available to subagents.
- GitHub documents `.github/hooks/*.json` for the CLI and cloud agent, with PascalCase `PreToolUse` giving the Claude-compatible payload, exit 2 meaning deny, and a hook error meaning deny (fail closed).

Not verified yet. Each of these has a fallback already built in:
- **Model names.** The exact Copilot model names available to your plan (`config/models.yaml`). Check them against the VS Code model picker; an unavailable name falls back to the picker's model.
- **CLI subagents.** Whether Copilot CLI lets a custom agent invoke other custom agents as subagents. If it doesn't, invoke the spokes one by one in the pipeline order from `docs/conventions.md`.
- **Parallel subagents.** Whether VS Code runs several subagents at once. If not, full-product tracks run one after another.
