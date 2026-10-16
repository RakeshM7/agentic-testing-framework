# AGENTS.md

Brief for any agent working in this repo: Claude Code and every GitHub Copilot surface (VS Code Copilot Chat, Copilot CLI, the cloud coding agent) read this file. It is a pointer, not a copy of the pipeline logic.

## What this repo is

A platform-neutral agentic testing pipeline. It has 36 small agents in three layers: main orchestrator → domain orchestrators → workers. A deterministic scripts layer owns run state, the artifact contract, the clarifications CSV, the ledger and the safety guard.

Each agent is written **once**, in `agents/<name>.md`. `npm run build-agents` generates the platform files from those sources and `config/`:
- `.claude/agents/` for Claude Code;
- `.github/agents/` for Copilot;
- the MCP configs.

Never edit a generated file. Hosts and setup are covered in `docs/platforms.md`.

## Read first

1. **`docs/decisions.md`: before you change ANY file**, except run output and generated test code (`artifacts/`, `playwright-tests/`, `k6-tests/`, `feedback/`). Follow the rules at its top. If your change would revert, weaken, bypass or contradict a recorded decision, stop and get the user's explicit confirmation first. As a subagent, or without a human to ask, report the conflict instead of making the change. The hook will also ask the user before any edit to a file a decision governs.
2. `docs/artifact-contract.md`: layout v2 (product-level), state, stages, clarifications CSV, ledger, safety, scripts.
3. `docs/agent-architecture.md`: the 36-agent design.
4. `config/permissions.yaml`: what each agent may do.
5. `docs/agent-handoffs.md`, `docs/playwright-conventions.md`, `docs/k6-conventions.md`: formats and code rules.
6. `docs/conventions.md`: framework-wide rules and the feedback contract.
7. `docs/platforms.md` and `architecture.md`: hosts, and how the pieces fit.

## Hard safety rule — do not loosen this

`authorizations.mode` (resolved once into `artifacts/<product>/state/run.json`) caps every agent:
- `readonly` (the default) is non-mutating everywhere, whatever `config/permissions.yaml` says.
- `full-run` must be set explicitly, per target, by a human authorized to test that target, and is never inferred. Then each agent gets exactly the ceiling in `config/permissions.yaml`.
- Even under `full-run`, destructive actions (delete/cancel/remove) are scoped to entities this run created, recorded in `state/ledger.jsonl` (`scripts/ledger.mjs`). Never pre-existing data, and never another user's.
- Some hosts can't tell the guard which agent is calling: Copilot CLI, VS Code chat on its Copilot CLI engine, and the cloud coding agent. On those hosts a `full-run` call gets the run's combined ceiling instead, which is what at least one of the run's agents may do (`docs/decisions.md` D-035).

The guard enforces all of this in code, keyed on the calling agent: `scripts/lib/guard.mjs`, reached through the single hook entry `scripts/hooks/pretooluse.mjs` on every host. Do not bypass or weaken it.

## Working rules

- Deterministic work belongs in `scripts/`, with tests (`npm test`), not in prompts: run state, next-stage, locks, ledger, clarifications CSV ids/dedupe, permission checks.
- Change an agent only in `agents/<name>.md`, then run `npm run build-agents`. Its tools, subagents, model and MCP servers come from `config/permissions.yaml`, `config/models.yaml`, `config/platforms.yaml` and `config/mcp.yaml`. `npm run check` (CI too) fails on drift or a hand-edited generated file.
- Agent bodies stay platform-neutral: never name a platform's tool in them (the build rejects it).
- Never put credential values in a prompt, issue or commit; agents get a path to a `.env`-style file only.
- `artifacts/` is generated and git-ignored.
- Live browser work (`module-explorer`, `clarification-explorer`) needs an interactive Playwright MCP session on Claude Code or VS Code. Don't attempt it from a sandboxed environment or the cloud coding agent.
