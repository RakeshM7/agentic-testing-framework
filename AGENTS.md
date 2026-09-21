# AGENTS.md

Instructions for GitHub Copilot's cloud coding agent (and any other AGENTS.md-aware agent) working in this repo. This is a condensed, repo-wide brief — the authoritative, per-persona detail lives in `.github/agents/*.agent.md` (symlinked from `copilot-agents/`) and `docs/conventions.md`.

## What this repo is

Seven testing-pipeline personas (explore, requirements-clarification, testcase-generation, Playwright automation, API testing, feedback-implementation, plus an orchestrator) defined twice: once for Claude Code (`claude-agents/`, discovered via the `.claude/agents` symlink) and once for GitHub Copilot (`copilot-agents/`, discovered via the `.github/agents` symlink). Both flavors read and write the exact same shared artifact tree — see `docs/conventions.md` for the full contract. Don't duplicate pipeline logic into this file; it's a pointer, not a third copy.

## If you're picking up an issue assigned here

1. Read `docs/conventions.md` first — artifact paths, the pipeline stage order, and the feedback-file contract are all defined there and apply regardless of which flavor invoked you.
2. Check `config/run-config.example.yaml` (or a target-specific config under `config/`) for the run this issue concerns. `authorizations.mode` is the master safety switch — see the rule below before doing anything against a live target.
3. `.github/agents/orchestrator-agent.agent.md` is the entry point for a full pipeline run if one hasn't started yet; otherwise, invoke the single persona the issue actually calls for.
4. Live browser crawling (`explore-agent`) needs an interactive Playwright MCP session and is scoped `target: vscode` — it does not run in this sandboxed cloud environment. If an issue needs fresh exploration of a target, ask for it to be run interactively in VS Code first and its artifacts committed, rather than attempting it here.

## Hard safety rule — do not loosen this

`authorizations.mode` in a run-config gates every mutating/destructive action across every agent, in both flavors: `readonly` (default) is non-mutating everywhere; `full-run` must be set explicitly, per target, by a human authorized to test that target — never inferred or assumed. Even under `full-run`, destructive actions (delete/cancel/remove) are scoped to entities that run's own agent created (tracked in each stage's `created-entities.json`) — never pre-existing or another user's data. Full detail: `docs/conventions.md`'s "Standing safety guardrails".

## Model / provider configuration

Which model each agent uses, per platform, is controlled centrally by `config/models.yaml` and applied via `node scripts/sync-agent-models.mjs`. Never hand-edit the `model:` frontmatter line in a `claude-agents/*.md` or `copilot-agents/*.agent.md` file directly — the next sync overwrites it.

## Secrets

Never put credential values inline in a prompt, issue, or commit. Every agent that needs to authenticate against a target reads credentials from a `.env`-style file path it's given — only the path is ever passed around.
