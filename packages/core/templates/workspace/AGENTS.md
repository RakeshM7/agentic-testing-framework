# AGENTS.md

Brief for any agent working in this repository: Claude Code and every GitHub Copilot surface (VS Code Copilot Chat, Copilot CLI, the cloud coding agent) read this file at session start. It is a pointer, not a copy of the pipeline's rules.

## What this repo is

A test workspace for the agentic testing pipeline. The framework is the installed package at `{fw}/`: its agents, scripts, default config, templates and docs. This repository holds only this team's own work:
- `config/<product>.yaml`: one run-config per product under test;
- `atf/`: this workspace's settings: the marker `atf/atf.json`, config overlays and ejected config, agent add-on fragments (`atf/agents/<name>.extra.md`) and the decision log;
- `artifacts/` (run state and output, git-ignored), the generated test code in `playwright-tests/<product>/` and `k6-tests/<product>/`, and `feedback/`.

The agent files, hooks and MCP config (`.claude/agents/`, `.github/agents/`, `.mcp.json`, `.vscode/mcp.json`, the hook files and the `hooks` key of `.claude/settings.json`) are rendered from the package by `npx atf sync`, which every `npm install` also runs. They are git-ignored, except the Copilot agent and hook files when `atf/atf.json` opts in to the cloud coding agent (`"cloud_agent": true`): those are committed. Never edit them, and never edit anything under `{fw}/`: a human changes `atf/` and syncs.

## Read first

1. **`atf/decisions.md`: before you change ANY file**, except run output and generated test code (`artifacts/`, `playwright-tests/`, `k6-tests/`, `feedback/`). Follow the rules at its top. Don't read the whole log: run `node {fw}/scripts/decisions.mjs for <files you will change> --full` for the entries that govern them, and `node {fw}/scripts/decisions.mjs index` to scan the rest by title. If your change would revert, weaken, bypass or contradict a recorded decision, stop and get the user's explicit confirmation first. As a subagent, or without a human to ask, report the conflict instead of making the change.
2. `{fw}/docs/artifact-contract.md`: the artifacts layout, run state, stages, the clarifications CSV, the ledger and safety.
3. `{fw}/docs/agent-handoffs.md`, `{fw}/docs/playwright-conventions.md`, `{fw}/docs/k6-conventions.md`: formats and code rules.
4. `{fw}/docs/conventions.md`: framework-wide rules and the feedback contract.
5. `{fw}/docs/platforms.md`: the hosts, how to start a run on each, and what to do when the guard check fails.

## Hard safety rule — do not loosen this

`authorizations.mode` in a run-config (resolved once into `artifacts/<product>/state/run.json`) caps every agent:
- `readonly` (the default) is non-mutating everywhere, whatever the permissions say.
- `full-run` must be set explicitly, per target, by a human authorized to test that target, and is never inferred. Then each agent gets exactly its ceiling in the effective `permissions.yaml`: the package's, or this workspace's overlay `atf/permissions.yaml` or ejected `atf/config/permissions.yaml`.
- Even under `full-run`, destructive actions (delete/cancel/remove) are scoped to entities this run created, recorded in the run's ledger (`state/ledger.jsonl`). Never pre-existing data, and never another user's.
- Copilot CLI, VS Code chat on its Copilot CLI engine and the cloud coding agent can't tell the guard which agent is calling. On those hosts a `full-run` call gets the run's combined ceiling instead: what at least one of the run's agents may do.

The framework's guard enforces all of this in code on every tool call, through the hooks `npx atf sync` registers. Do not bypass or weaken it.

## Working rules

- `atf/` is human-only: the guard refuses every framework agent's write there. An agent that needs a change in it (an overlay, a fragment, a decision entry) proposes the exact text in its result, and a human makes it.
- Never put credential values in a prompt, issue or commit. Agents get a path to a `.env`-style file only (a run-config's `credentials_file`). `.env` files and saved browser sessions (`.auth/`) are git-ignored.
- Agents never run `npx atf`. The commands below are for humans, in their own terminal.
- Live browser work (exploring a module, checking a clarification) needs an interactive Playwright MCP session on Claude Code or VS Code. Don't attempt it from a sandboxed environment or the cloud coding agent.

## Commands (humans, from this folder)

| Command | Does |
|---|---|
| `npx atf config <product> --url <target url>` | create `config/<product>.yaml` from the package's example, then log in |
| `npx atf interview` | or: the orchestrator asks a few questions and drafts the run-config |
| `npx atf run <product>` | start a run, or continue the active one |
| `npx atf status <product>`, `npx atf next <product>` | where the run stands, and what it does next |
| `npx atf doctor <product>` | check, and install what it safely can, what every stage needs |
| `npx atf approve <product> <module>` | sign off a module's test cases |
| `npx atf sync`, `npx atf check` | render the host files from the installed package and `atf/`, or check they are current |
| `npx atf help` | every command |
