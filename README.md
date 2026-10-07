# Agentic Testing Framework

A hierarchy of small Claude Code subagents that takes a web product from "unknown" to researched, explored, clarified, test-cased, automated (Playwright UI + API) and load-tested (k6), with an HTML slide-deck report — driven by one run-config file and backed by a deterministic scripts layer that owns run state, the clarifications CSV, the created-entity ledger and per-agent permissions.

> **Status:** redesign on `framework-major-redesign`. All 43 agents, the scripts layer and the contracts are implemented and the scripts are tested; the pipeline has not yet been run end to end against a real product. See [`architecture.md`](architecture.md).

Start a run in a new Claude Code session: `claude --agent orchestrator-agent`, then give it `config/<product>.yaml`.

## Read

- [`docs/agent-architecture.md`](docs/agent-architecture.md) — the 43 agents, layers and flow
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
npm test                                                   # script test suite
```

Unconfirmed clarifications: open `artifacts/<product>/modules/<module>/clarifications.csv`, fill the **Answer** column, save, and re-invoke. Agents never overwrite an answer you wrote.

## Safety

- `authorizations.mode: readonly` (default) caps **every** agent at read-only.
- `full-run` — set explicitly, per target, by a human authorized to test it — applies `config/permissions.yaml` as written.
- Deletes are always limited to entities the current run created (`state/ledger.jsonl`).
- The guard enforces all of this in code per calling agent: spawns, shell, HTTP/load, browser actions and file writes. The environment can only downgrade the mode.
- Credentials are always a path to a file a human prepared, never inline values.

## Repo map

| Path | What |
|---|---|
| `.claude/agents/` | the 43 agent definitions (frontmatter generated: `npm run build-agents`) |
| `scripts/`, `schemas/` | run state machine, clarifications CSV, ledger, permissions, guard, config validation; JSON Schemas; tests |
| `config/` | run-config example, `permissions.yaml`, `models.yaml` |
| `docs/` | architecture, contract, conventions |
| `artifacts/<product>/` | generated product knowledge, module state, run state and per-run results (git-ignored) |
| `playwright-tests/<product>/`, `k6-tests/<product>/` | generated test projects |

## Limitations

- Custom agents load at session start: after editing `.claude/agents/`, start a new Claude Code session.
- Live browser work needs an interactive Playwright MCP session.
- CAPTCHA/MFA is a reported blocker, never bypassed; authenticated work starts from a session-state file a human produced.
- `shell: project` agents could in principle reach the network through a script the guard can't parse; generated test projects add a second layer (mutation-guard fixtures, k6 host allow-lists).
