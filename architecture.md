# Architecture

## Design principles

1. **Deterministic work lives in code, judgment lives in agents.** Run state, stage ordering, locks, output verification, the clarifications CSV, the created-entity ledger and permission checks are scripts with tests. Agents explore, reason and generate.
2. **One job per agent.** 34 small agents with declared inputs and outputs, in three layers: the main orchestrator → domain orchestrators → workers (native nested subagents). Workers never spawn and never talk to each other; every hand-off goes through the parent orchestrator as a file. Roster and flow: [`docs/agent-architecture.md`](docs/agent-architecture.md).
3. **Product-level knowledge.** Everything accumulates under `artifacts/<product>/` across runs (knowledge, module exploration, clarifications); per-run outcomes are archived under `results/<run-id>/`. One active run per product. Contract: [`packages/core/docs/artifact-contract.md`](packages/core/docs/artifact-contract.md).
4. **Permissions are data, enforced in code.** `packages/core/config/permissions.yaml` is the ceiling for each agent; the run's `authorizations.mode` caps everyone (readonly ⇒ read-only for all). The guard identifies the calling agent and enforces spawns, shell, HTTP/load, browser and file writes. On a host that can't name the agent, it applies the run's combined ceiling instead. Deletes are limited to entities the current run created.
5. **Platform-neutral core, generated platform shells.** Each agent is written once (`packages/core/agents/`); its Claude Code, GitHub Copilot, Google Antigravity and OpenAI Codex files are generated from it and `packages/core/config/` (tools from permissions, syntax from `packages/core/config/platforms.yaml`). Every host runs the same hook entry through a thin adapter. Hosts: [`packages/core/docs/platforms.md`](packages/core/docs/platforms.md).
6. **Intentional design is recorded.** [`docs/decisions.md`](docs/decisions.md) says why each piece is the way it is; changing a file a decision governs needs the user's confirmation, enforced by the hook.

## Components

```mermaid
flowchart LR
  CFG[config/&lt;product&gt;.yaml] --> INIT[packages/core/scripts/run.mjs init]
  PERM[packages/core/config/permissions.yaml] --> INIT
  INIT --> STATE[(artifacts/&lt;product&gt;/state/)]
  MAIN[orchestrator-agent] -->|run.mjs next: agent + prompt, stage| STATE
  MAIN --> DOM[domain orchestrators]
  DOM -->|orchestration.mjs next: agent + prompt, step| STATE
  DOM --> W[workers]
  W -->|requests.mjs add| REQ[(results/&lt;run&gt;/&lt;m&gt;/&lt;domain&gt;/requests.json)]
  REQ -->|req-n steps| DOM
  W -->|declared outputs| ART[(artifacts/&lt;product&gt;/modules, knowledge, results)]
  W -->|clarifications.mjs| CSV[(modules/&lt;m&gt;/clarifications.csv)]
  W -->|ledger.mjs add / owns| LED[(state/ledger.jsonl)]
  SRC[packages/core/agents/ + packages/core/config/] -->|npm run build-agents| GEN[.claude/agents, .github/agents, .agents/agents, .codex/agents, MCP configs, hook registrations]
  HOOK[packages/core/scripts/hooks/pretooluse.mjs + host adapters] --> GUARD[packages/core/scripts/lib/guard.mjs]
  HOOK --> DEC[packages/core/scripts/lib/decisions.mjs]
  GUARD -.reads.-> STATE
  DEC -.reads.-> LOG[(docs/decisions.md)]
```

| Layer | Where | Responsibility |
|---|---|---|
| Agent sources | `packages/core/agents/*.md` | the 34 roles in `docs/agent-architecture.md`, written once, platform-neutral |
| Platform build | `packages/core/scripts/build-agents.mjs`, `packages/core/scripts/lib/agents/`, `packages/core/scripts/lib/mcp.mjs`, `packages/core/config/platforms.yaml`, `packages/core/config/mcp.yaml` | renders `.claude/agents/`, `.github/agents/`, `.agents/agents/`, `.mcp.json`, `.vscode/mcp.json`, `.agents/mcp_config.json` and the hook registrations (`packages/core/scripts/lib/hook-registrations.mjs`); `--check` gates drift |
| Domain scripts | `packages/core/scripts/{knowledge,orchestration,results,report-data,report,gate,ui-code,api-code}.mjs`, `packages/core/scripts/lib/report.mjs`, `packages/core/templates/report/`, `packages/core/scripts/lib/testcases.mjs`, `packages/core/scripts/lib/ui-code.mjs`, `packages/core/scripts/lib/api-code.mjs`, `packages/core/scripts/lib/ts-scan.mjs`, `packages/core/scripts/lib/agent-scope.mjs`, `packages/core/scripts/lib/gate/`, `packages/core/scripts/lib/domain-flows.mjs` | knowledge registry, each domain's flow and its next step (`orchestration.mjs next`), loop bounds, normalized results, report numbers, test case checks, the UI code scaffold and its locator checks, the generated API code and its checks, the pre-review gate |
| Roots + config | `packages/core/scripts/lib/roots.mjs`, `packages/core/scripts/lib/config.mjs` | the framework root (scripts, agents, default config, templates, schemas) and the workspace root (run-configs, `artifacts/`, test code, generated host files), one directory in this repo (D-085); `{fw}` in agent sources and permissions; the one reader of the framework's config files |
| Contract + state | `packages/core/scripts/lib/contract.mjs`, `packages/core/scripts/run.mjs`, `packages/core/scripts/lib/files.mjs`, `packages/core/schemas/` | layout, stage table, output verification, lock, history; atomic, locked state writes (D-072) and resume after a crash (D-071) |
| Clarifications | `packages/core/scripts/lib/clarifications.mjs`, `packages/core/scripts/clarifications.mjs` | the product-level CSV: ids, de-dup, human-answer preservation; the module summary rendered from it |
| Safety | `packages/core/scripts/lib/{guard,permissions,ledger,hosts,tool-call,browser-tools,guard-check}.mjs`, `packages/core/scripts/ledger.mjs`, `packages/core/scripts/hooks/` | mode cap, per-agent permissions, ledger-scoped deletes, host identity, liveness check |
| Governance | `docs/decisions.md`, `packages/core/scripts/lib/decisions.mjs`, `packages/core/scripts/roster.test.mjs` | decision log; confirmation before changing governed files; docs kept in step with the agent roster |
| Config | `packages/core/config/run-config.example.yaml`, `packages/core/config/permissions.yaml`, `packages/core/config/models.yaml`, `packages/core/scripts/run-config.mjs` | per-run settings, per-agent ceilings, per-agent models per platform |
| Generated test code | `playwright-tests/<product>/` (tests/ui + tests/api), `k6-tests/<product>/` | written by the Playwright/K6 domains |

## Status

- **Done:** foundation — layout v2, run lifecycle and lock, stage verification, clarifications CSV, ledger, permissions resolution and enforcement, run-config v2 (`npm test`).
- **Done:** knowledge domain — `knowledge-generator`, `packages/core/scripts/knowledge.mjs`.
- **Done:** all other agents bottom-up to `orchestrator-agent`; `packages/core/scripts/build-agents.mjs` (frontmatter from permissions + models), `orchestration.mjs`, `results.mjs`, `report-data.mjs`; stage attempts and blocked-dependency handling in `run.mjs`.
- **Done:** GitHub Copilot support from the same sources (VS Code Copilot Chat, Copilot CLI, cloud coding agent), one hook entry for every host, the decision log and its confirmation hook, CI running `npm run check` on Linux, macOS and Windows, and the `atf` CLI for every human command (D-087).
- **Done:** end-to-end harnesses (D-084): `packages/core/scripts/pipeline.test.mjs` drives `run.mjs next` from init to a verified report with stand-in agents on every `npm test`; `atf e2e` runs the rendered foundation against a local demo app in a real browser, readonly and full-run, then the human's ledger sweep.
- **Built, not yet verified live:** Google Antigravity support (App, `agy` CLI, IDE; D-099 – D-101), from its documentation. The spike kit in `docs/antigravity-spike/` settles the provisional values.
- **Built, not yet verified live:** OpenAI Codex support (CLI, app, IDE extension; D-115, D-116), from its documentation. Generated: `.codex/agents/`, `.codex/config.toml`, `.codex/hooks.json`. The spike kit in `docs/codex-spike/` settles the provisional values.
- **Next:** verify the Copilot, Antigravity and Codex runtime facts listed in `packages/core/docs/platforms.md` on live sessions, a first agent-driven run against a real product, per-role models in `packages/core/config/models.yaml`.

## Control flow (D-060)

A run executes only the steps the human chose (D-066: explore, clarifications, testcases, playwright-ui, playwright-api, k6), plus the stages they need (knowledge, the `api-discovery` endpoint catalogue, the Playwright repo, the report); every other stage is "not chosen", never failed. Before the first stage, `run.mjs prereqs` lists each module's missing prerequisites, and the orchestrator asks the human how to fill each one: explore, ask clarifications, generate test cases, describe scenarios for the explorer, import their own test case file, or skip the step. k6 loads only the approved `@performance` cases and no longer waits for the API tests (D-068).

Both orchestrator levels are pure loops over a script's decision. `orchestrator-agent` repeats `run.mjs next`, which returns the stages to start with the agent and the exact prompt of each (run id, mode, test case format and module come from the run state; reusable knowledge is marked done by the script); it starts each agent, then calls `stage ... done`, which on a refusal returns one `retry` (agent and prompt) and fails the stage on the second. A domain orchestrator (one shared body, `packages/core/agents/_shared/domain-loop.md`) repeats `orchestration.mjs next`: it starts the agent with its prompt and marks the step. A worker that needs a shared-file change, a missing method or export or a foundation gap records it with `requests.mjs add`; `next` turns each request into a handler step with a once-limit kept in state, takes the pw-repo-owner lock so the UI and API domains never use it together, and re-runs the worker that asked. A review that fails its rounds fails the stage and blocks its dependants. When only stages waiting for a human's test case sign-off are left, `run.mjs next` offers the report, then `end` says `awaiting-approval` with the sheets to review; the next run continues from what that run completed (`carriedFrom`).
