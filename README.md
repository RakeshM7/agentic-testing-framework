# Agentic Testing Framework

A hierarchy of small agents, for Claude Code and GitHub Copilot from one source, that takes a web product from "unknown" to researched, explored, clarified, test-cased, automated (Playwright UI + API) and load-tested (k6), with an HTML slide-deck report — driven by one run-config file and backed by a deterministic scripts layer that owns run state, the clarifications CSV, the created-entity ledger and per-agent permissions.

> **Status:** redesign on `framework-major-redesign`, with Copilot support on `feature/copilot-support`. All 34 agents, the scripts layer and the contracts are implemented and the scripts are tested; the pipeline has not yet been run end to end against a real product. See [`architecture.md`](architecture.md).

Start a run with the **orchestrator-agent** as the session's agent (Claude Code: `claude --agent orchestrator-agent`; VS Code Copilot Chat: pick it in the agent picker; Copilot CLI: `copilot --agent orchestrator-agent`), then give it `config/<product>.yaml`. Hosts and setup: [`docs/platforms.md`](docs/platforms.md).

## Read

- [`docs/decisions.md`](docs/decisions.md) — why things are the way they are; read before changing anything
- [`docs/agent-architecture.md`](docs/agent-architecture.md) — the 34 agents, layers and flow
- [`docs/platforms.md`](docs/platforms.md) — Claude Code, VS Code Copilot Chat, Copilot CLI, cloud coding agent
- [`docs/artifact-contract.md`](docs/artifact-contract.md) — where everything lives, stages, CSV, ledger, safety
- [`config/permissions.yaml`](config/permissions.yaml) — what each agent may do
- [`config/run-config.example.yaml`](config/run-config.example.yaml) — what a run needs

## Quick start: step by step

### 1. Set up once
1. Install Node.js, then run `npm install` in the repo root. Install `k6` too if you want load tests.
2. Pick a host and follow its setup in [`docs/platforms.md`](docs/platforms.md). In VS Code, trust the workspace first, or the guard check (step 3) stops the run.
3. Live browser work (exploration, clarifications) needs an interactive Playwright MCP session on Claude Code or VS Code.

### 2. Prepare the run-config
1. Copy the example: `cp config/run-config.example.yaml config/<product>.yaml`. [`config/run-config.freshsales.yaml`](config/run-config.freshsales.yaml) is a filled-in sample.
2. Fill in:
   - `product`: the slug used for every folder;
   - `target.url`;
   - `modules`: slug, name, `entry_url` and `nav_path` for each. You list the modules, the agents don't pick them;
   - `knowledge.references`: vendor docs and help centres the knowledge base cites;
   - `testcases.output_format`: `markdown-table`, `gherkin`, `csv` or `testrail`.
3. Set `authorizations.mode`:
   - `readonly` (default) is non-mutating everywhere.
   - `full-run` only for a target you own or are authorized to test.
4. For a logged-in product, a human logs in once, out-of-band (including any CAPTCHA/MFA), and saves the Playwright `storageState` to `session_state_file` (for example `playwright-tests/<product>/.auth/state.json`, which is git-ignored). Set `authenticated_crawl: true`.
5. Credentials and API tokens are always a path (`credentials_file`) or a variable name (`api.auth_header`), never a value.
6. Validate it: `node scripts/run-config.mjs validate config/<product>.yaml`.

### 3. Start the run
1. Start a session with **orchestrator-agent** (host commands are above).
2. Give it `config/<product>.yaml`.
3. It runs `node scripts/run.mjs init` (takes the product lock, freezes permissions), then the guard check (`run.mjs guard-check <product>`). It then loops over `run.mjs next <product>`, starting the right agent for each stage. Use `--resume` to continue an active run.

### 4. What the pipeline does
Per product, then per module, in this order:

| Stage | Result |
|---|---|
| `knowledge` and `module-knowledge` | cited product and module knowledge base |
| `playwright-repo` | the Playwright project skeleton, rendered from templates |
| `explore` | the module's UI states, transitions and API traffic, recorded by script |
| `clarifications` | `clarifications.csv`: questions the product couldn't answer by itself |
| `testcases` | script-built test cases, reviewed case by case |
| `playwright-ui`, `playwright-api` | generated tests (one per approved case or planned scenario), a gate, review and fix loops, then a run, triage and heal loop |
| `k6` | load workloads and scripts (executed only in `full-run`) |
| `report` | HTML slide deck at `artifacts/<product>/results/<run>/report/index.html` |

Review and heal loops are bounded by `limits.review_rounds` and `limits.heal_rounds`. A stage gets at most two attempts. A stage that fails twice blocks what depends on it, and the report still says what did not run.

### 5. Your two human steps
**Answer clarifications** (stage `clarifications`):
1. Open `artifacts/<product>/modules/<module>/clarifications.csv`.
2. Fill the **Answer** column and save. Agents never overwrite an answer you wrote.
3. Agent-proposed answers carry `Answer status: agent-proposed`. They count as answered, but test cases built on them are `@assumption` until you approve them.
4. Re-invoke the orchestrator. With `clarifications.unresolved_policy: stop`, the stage isn't complete until every row has an answer.

**Approve test cases** (nothing is automated without this):
1. When a module's test cases pass review, its automation stages show `awaiting-approval`, and the run can end that way with the report still produced.
2. Open `artifacts/<product>/modules/<module>/testcases/approval.csv` and record a decision per case.
3. Commit the decisions yourself, in an interactive terminal of your own: `node scripts/testcases.mjs approve <product> <module>`. You type the module slug to confirm. The guard denies agents this command and writes to `approval.csv` or `approvals.json`.
4. Start a new run (`run.mjs init`, or re-invoke the orchestrator). It adopts the earlier run's completed stages and picks the module up from the approved cases.

### 6. Read the results
- Report: `artifacts/<product>/results/<run>/report/index.html`.
- Per module: `results/<run>/<module>/{playwright-ui,playwright-api,k6}/results.json`, plus triage with evidence-backed bug drafts.
- Generated tests: `playwright-tests/<product>/` and `k6-tests/<product>/`.
- What the run created and hasn't cleaned up: `node scripts/ledger.mjs list <product> --live`.

### 7. Finish
`node scripts/run.mjs end <product>` archives the run to `state/history/` and releases the lock. Use `--abandon` to release a lock without finishing.

## Useful commands

```bash
node scripts/run.mjs status <product>                     # every stage, with output verification
node scripts/run.mjs next <product>                       # what can run now
node scripts/clarifications.mjs status <product>          # answered / unconfirmed per module
node scripts/testcases.mjs status <product> <module>      # totals, assumptions, approved / rejected cases
node scripts/ledger.mjs list <product> --live             # created and not cleaned up
npm run build-agents                                      # regenerate platform agent + MCP files from agents/ and config/
npm run check                                             # drift check + test suite (CI runs this)
npm test                                                  # the test suite only
```

After `npm run build-agents`, start a new session: hosts load agents at session start.

## Safety

- `authorizations.mode: readonly` (default) caps **every** agent at read-only.
- `full-run` — set explicitly, per target, by a human authorized to test it — applies `config/permissions.yaml` as written. Some hosts can't identify the calling agent: Copilot CLI, VS Code chat on its Copilot CLI engine, and the cloud coding agent. There each call gets what at least one of the run's agents may do.
- Deletes are always limited to entities the current run created (`state/ledger.jsonl`).
- The guard enforces all of this in code per calling agent: spawns, shell, HTTP/load, browser actions and file writes. The environment can only downgrade the mode. Every run first proves the guard is live (`run.mjs guard-check`).
- Edits to files a recorded design decision governs need the user's confirmation ([`docs/decisions.md`](docs/decisions.md)).
- Credentials are always a path to a file a human prepared, never inline values.

## Repo map

| Path | What |
|---|---|
| `agents/` | the 34 agent definitions — the only hand-written copy |
| `.claude/agents/`, `.github/agents/`, `.mcp.json`, `.vscode/mcp.json` | generated per platform by `npm run build-agents`; never edit |
| `scripts/hooks/` | the one hook entry for every host, plus thin host adapters |
| `scripts/`, `schemas/` | run state machine, clarifications CSV, ledger, permissions, guard, config validation; JSON Schemas; tests |
| `config/` | run-config example, `permissions.yaml`, `models.yaml`, `platforms.yaml`, `mcp.yaml` |
| `docs/` | architecture, contract, conventions |
| `artifacts/<product>/` | generated product knowledge, module state, run state and per-run results (git-ignored) |
| `playwright-tests/<product>/`, `k6-tests/<product>/` | generated test projects |

## Limitations

- Agents load at session start: after `npm run build-agents`, start a new session.
- On Copilot CLI, VS Code chat on its Copilot CLI engine and the cloud coding agent, the guard can't tell agents apart. In a full-run there, one agent can do another agent's job, though never more than some agent of the run may do.
- The cloud agent does no live browser work.
- Live browser work needs an interactive Playwright MCP session.
- CAPTCHA/MFA is a reported blocker, never bypassed; authenticated work starts from a session-state file a human produced.
- `shell: project` agents could in principle reach the network through a script the guard can't parse; generated test projects add a second layer (mutation-guard fixtures, k6 host allow-lists).
