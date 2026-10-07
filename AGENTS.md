# AGENTS.md

Brief for any agent working in this repo. It is a pointer, not a copy of the pipeline logic.

## What this repo is

A platform-neutral agentic testing pipeline — 43 small agents in three layers (main orchestrator → domain orchestrators → workers) plus a deterministic scripts layer that owns run state, the artifact contract, the clarifications CSV, the ledger and the safety guard. Today the agents are implemented for Claude Code only, in `.claude/agents/`. Other runtimes are out of scope for now; if added they must follow the same contract exactly.

## Read first

1. `docs/artifact-contract.md` — layout v2 (product-level), state, stages, clarifications CSV, ledger, safety, scripts.
2. `docs/agent-architecture.md` — the 43-agent design and which domains are built.
3. `config/permissions.yaml` — what each agent may do.
4. `docs/agent-handoffs.md`, `docs/playwright-conventions.md`, `docs/k6-conventions.md` — formats and code rules.
5. `docs/conventions.md` — framework-wide rules and the feedback contract.
6. `architecture.md` — how the pieces fit.

## Hard safety rule — do not loosen this

`authorizations.mode` (resolved once into `artifacts/<product>/state/run.json`) caps every agent: `readonly` (default) is non-mutating everywhere, whatever `config/permissions.yaml` says; `full-run` must be set explicitly, per target, by a human authorized to test that target — never inferred — and then each agent gets exactly the ceiling in `config/permissions.yaml`. Even under `full-run`, destructive actions (delete/cancel/remove) are scoped to entities this run created, recorded in `state/ledger.jsonl` (`scripts/ledger.mjs`), never pre-existing or another user's data. The guard (`scripts/lib/guard.mjs`, Claude hook `.claude/hooks/guard.mjs`, keyed on the calling agent) enforces this in code; do not bypass or weaken it.

## Working rules

- Deterministic work (run state, next-stage, locks, ledger, clarifications CSV ids/dedupe, permission checks) belongs in `scripts/`, with tests (`npm test`), not in prompts.
- Never hand-edit `tools`, `mcpServers` or `model` in an agent file: they are generated from `config/permissions.yaml` and `config/models.yaml` by `node scripts/build-agents.mjs` (`npm run check` verifies).
- Never put credential values in a prompt, issue or commit; agents get a path to a `.env`-style file only.
- `artifacts/` is generated and git-ignored.
- Live browser work (`module-explorer`, `clarification-explorer`) needs an interactive Playwright MCP session; don't attempt it from a sandboxed environment.
