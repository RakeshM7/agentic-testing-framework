# Agentic Testing Framework

A hierarchy of small agents, for Claude Code and GitHub Copilot from one source, that takes a web product from "unknown" to researched, explored, clarified, test-cased, automated (Playwright UI + API) and load-tested (k6), with an HTML slide-deck report — driven by one run-config file and backed by a deterministic scripts layer that owns run state, the clarifications CSV, the created-entity ledger and per-agent permissions.

> **Status:** redesign on `framework-major-redesign`, with Copilot support on `feature/copilot-support`. All 43 agents, the scripts layer and the contracts are implemented and the scripts are tested; the pipeline has not yet been run end to end against a real product. See [`architecture.md`](architecture.md).

Start a run with the **orchestrator-agent** as the session's agent (Claude Code: `claude --agent orchestrator-agent`; VS Code Copilot Chat: pick it in the agent picker; Copilot CLI: `copilot --agent orchestrator-agent`), then give it `config/<product>.yaml`. Hosts and setup: [`docs/platforms.md`](docs/platforms.md).

## Read

- [`docs/decisions.md`](docs/decisions.md) — why things are the way they are; read before changing anything
- [`docs/agent-architecture.md`](docs/agent-architecture.md) — the 43 agents, layers and flow
- [`docs/platforms.md`](docs/platforms.md) — Claude Code, VS Code Copilot Chat, Copilot CLI, cloud coding agent
- [`docs/artifact-contract.md`](docs/artifact-contract.md) — where everything lives, stages, CSV, ledger, safety
- [`config/permissions.yaml`](config/permissions.yaml) — what each agent may do
- [`config/run-config.example.yaml`](config/run-config.example.yaml) — what a run needs

## Use the scripts

```bash
npm install
cp config/run-config.example.yaml config/<product>.yaml     # product, target, modules, references, mode
node scripts/run-config.mjs validate config/<product>.yaml
node scripts/run.mjs init config/<product>.yaml            # takes the product lock, freezes permissions
node scripts/run.mjs next <product>                        # what can run now
node scripts/clarifications.mjs status <product>           # answered / unconfirmed per module
node scripts/ledger.mjs list <product> --live              # what this run created and hasn't cleaned up
node scripts/run.mjs end <product>                         # archive to history, release the lock
npm run build-agents                                       # regenerate platform agent + MCP files from agents/ and config/
npm run check                                              # drift check + test suite (CI runs this)
```

Unconfirmed clarifications: open `artifacts/<product>/modules/<module>/clarifications.csv`, fill the **Answer** column, save, and re-invoke. Agents never overwrite an answer you wrote.

## Safety

- `authorizations.mode: readonly` (default) caps **every** agent at read-only.
- `full-run` — set explicitly, per target, by a human authorized to test it — applies `config/permissions.yaml` as written, only on hosts where the guard can identify the calling agent (Claude Code, VS Code).
- Deletes are always limited to entities the current run created (`state/ledger.jsonl`).
- The guard enforces all of this in code per calling agent: spawns, shell, HTTP/load, browser actions and file writes. The environment can only downgrade the mode. Every run first proves the guard is live (`run.mjs guard-check`).
- Edits to files a recorded design decision governs need the user's confirmation ([`docs/decisions.md`](docs/decisions.md)).
- Credentials are always a path to a file a human prepared, never inline values.

## Repo map

| Path | What |
|---|---|
| `agents/` | the 43 agent definitions — the only hand-written copy |
| `.claude/agents/`, `.github/agents/`, `.mcp.json`, `.vscode/mcp.json` | generated per platform by `npm run build-agents`; never edit |
| `scripts/hooks/` | the one hook entry for every host, plus thin host adapters |
| `scripts/`, `schemas/` | run state machine, clarifications CSV, ledger, permissions, guard, config validation; JSON Schemas; tests |
| `config/` | run-config example, `permissions.yaml`, `models.yaml`, `platforms.yaml`, `mcp.yaml` |
| `docs/` | architecture, contract, conventions |
| `artifacts/<product>/` | generated product knowledge, module state, run state and per-run results (git-ignored) |
| `playwright-tests/<product>/`, `k6-tests/<product>/` | generated test projects |

## Limitations

- Agents load at session start: after `npm run build-agents`, start a new session.
- Copilot CLI and the cloud coding agent run readonly only (their hooks can't identify the calling agent); the cloud agent does no live browser work.
- Live browser work needs an interactive Playwright MCP session.
- CAPTCHA/MFA is a reported blocker, never bypassed; authenticated work starts from a session-state file a human produced.
- `shell: project` agents could in principle reach the network through a script the guard can't parse; generated test projects add a second layer (mutation-guard fixtures, k6 host allow-lists).
