# AGENTS.md

Brief for any agent working in this repo. It is a pointer, not a copy of the pipeline logic.

## What this repo is

A platform-neutral agentic testing pipeline — seven personas (orchestrator, explore, requirements-clarification, testcase-generation, Playwright automation, API testing, feedback-implementation) plus a deterministic scripts layer that owns run state, the artifact contract and the safety guard. Today the personas are implemented for Claude Code only (`claude-agents/`, discovered via the `.claude/agents` symlink). Other runtimes are out of scope for now; if added they must follow the same contract exactly.

## Read first

1. `docs/artifact-contract.md` — layout v2 (product-level), state, stages, clarifications CSV, ledger, safety, scripts.
2. `docs/agent-architecture.md` — the 43-agent design and which domains are built.
3. `config/permissions.yaml` — what each agent may do.
4. `docs/conventions.md` — feedback contract (other sections partly superseded).
5. `architecture.md` — how the pieces fit.

## Hard safety rule — do not loosen this

`authorizations.mode` (resolved once into `artifacts/<product>/state/run.json`) caps every agent: `readonly` (default) is non-mutating everywhere, whatever `config/permissions.yaml` says; `full-run` must be set explicitly, per target, by a human authorized to test that target — never inferred — and then each agent gets exactly the ceiling in `config/permissions.yaml`. Even under `full-run`, destructive actions (delete/cancel/remove) are scoped to entities this run created, recorded in `state/ledger.jsonl` (`scripts/ledger.mjs`), never pre-existing or another user's data. The guard (`scripts/lib/guard.mjs`, Claude hook `.claude/hooks/guard.mjs`, keyed on the calling agent) enforces this in code; do not bypass or weaken it.

## Working rules

- Deterministic work (run state, next-stage, locks, ledger, clarifications CSV ids/dedupe, permission checks) belongs in `scripts/`, with tests (`npm test`), not in prompts.
- Never hand-edit a `model:` line in an agent file; edit `config/models.yaml` and run `node scripts/sync-agent-models.mjs` (`npm run check` in CI).
- Never put credential values in a prompt, issue or commit; agents get a path to a `.env`-style file only.
- `artifacts/` is generated and git-ignored.
- Live browser crawling (`explore-agent`) needs an interactive Playwright MCP session; don't attempt it from a sandboxed environment.
