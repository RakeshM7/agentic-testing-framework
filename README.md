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
1. Install Node.js and `make` (on Windows, `make` comes with Git Bash tooling, GnuWin32 or `choco install make`). Install `k6` too if you want load tests.
2. Run `make setup`. It installs the npm dependencies and a Playwright browser.
3. Pick a host and follow its setup in [`docs/platforms.md`](docs/platforms.md). In VS Code, trust the workspace first, or the guard check (step 3) stops the run.
4. Live browser work (exploration, clarifications) needs an interactive Playwright MCP session on Claude Code or VS Code.

### 2. Prepare the run-config
**Either let the orchestrator interview you**: run `make interview`. It asks, in one message, for the product name (public or internal tool), its URL and a short description or overview link, the modules to run, links and file paths it can read (documents, sheets; export Office files to .md, .csv or .pdf), and optionally an API host or spec, whether a login is needed, which steps to run and any test case file you already have. It never asks for a secret. It then writes `config/<slug>.yaml` (always `readonly`), shows you a summary, and starts the run if you say so. If it needs a login, it offers to open the login window for you (step 4). **Or write the file by hand**, as below; both end in the same file.

1. Create it: `make config PRODUCT=<slug> URL=<target url>`. It writes `config/<slug>.yaml` from the example, with `product` and `target.url` set and `authorizations.mode: readonly`, then runs `make login` for you (step 4). Add `LOGIN=no` for a product that needs no login. [`config/run-config.freshsales.yaml`](config/run-config.freshsales.yaml) is a filled-in sample.
2. Open the file and fill in what only you know:
   - `modules`: slug, name, `entry_url` and `nav_path` for each. You list the modules, the agents don't pick them;
   - `knowledge.references`: vendor docs and help centres the knowledge base cites;
   - `testcases.output_format`: `markdown-table`, `gherkin`, `csv` or `testrail`;
   - `steps`: which of `explore`, `clarifications`, `testcases`, `playwright-ui`, `playwright-api` and `k6` to run (all six when absent; `make steps PRODUCT=<slug> STEPS=a,b` sets it);
   - your own test cases, if you have them: `modules[].testcases_file`, or one `testcases.import` file whose cases name their module (`@module:<slug>` or a Module column). Tag `@api` and `@performance` cases; untagged ones are UI.
3. Set `authorizations.mode: full-run` only for a target you own or are authorized to test. `readonly` (the default) is non-mutating everywhere.
4. Log in (`make config` already did this unless you passed `LOGIN=no`; run `make login PRODUCT=<slug>` yourself to log in again):
   - Microsoft Edge opens on the target (Google Chrome when Edge is not installed), with its own profile: sign in yourself (single sign-on, CAPTCHA and MFA included) within **60 seconds** (`WAIT=120` for more). The window **closes by itself**; don't close it yourself;
   - the session is saved to `playwright-tests/<slug>/.auth/state.json` and set in the config, along with `authenticated_crawl: true`. The profile (`playwright-tests/<slug>/.auth/browser-profile`) keeps your identity provider's sign-in, so the next login is usually quicker;
   - both are git-ignored and hold live cookies, so never share them. Log in again when the session expires, or when a stage meets a sign-in page. The orchestrator offers to open the login window for you then, after you confirm.
   - A single sign-on session often has no cookie on the target's own host. That passes the dependency check with a warning; the login is confirmed when a stage opens the target.
5. Credentials and API tokens are always a path (`credentials_file`) or a variable name (`api.auth_header`), never a value.
6. Check it: `make validate PRODUCT=<slug>`.

### 3. Start the run
1. Run `make run PRODUCT=<slug>` when you have `config/<slug>.yaml` (hand-written or drafted by `make interview`, which already offers to start the run). It opens an **orchestrator-agent** session on Claude Code with the run-config as its first prompt. On another host, start the session yourself (host commands are above) and give it `config/<product>.yaml`, or pass `AGENT="copilot --agent orchestrator-agent"` to make.
2. The agent shows the step menu (pre-selected from the config's `steps`), runs `node scripts/run.mjs init` (takes the product lock, freezes permissions and the steps), then the guard check (`run.mjs guard-check <product>`) and the dependency check (`run.mjs doctor <product>`; run `make doctor PRODUCT=<slug>` yourself any time to check and install what each stage needs).
3. Then the prerequisite check (`run.mjs prereqs <product>`): for each module whose chosen steps miss something (no exploration, no test cases of the needed type), it asks you once: **Explore the product**, **Ask clarification questions**, **Generate test cases**, **Describe scenarios to explore** (you describe them, the explorer explores only those and test cases cover only them), **Use my test case file**, or **Skip this step for this run**. For your own file it also asks whether it is already approved; if so, you run `make import PRODUCT=<slug> MODULE=<module> APPROVED=yes` in your own terminal.
4. It then loops over `run.mjs next <product>`, starting the right agent for each stage. Only the chosen steps and the stages they need run; the rest show as "not chosen" in the report.

#### Pick up from the middle (a later day, after a human step)
Run state lives in `artifacts/<product>/state/`, and a finished stage stays done while the run is active. `make` never ends a run, so there is no need to redo earlier stages. Just don't run `run.mjs end` until you're finished.

| You want to | Run |
|---|---|
| See where the run stands | `make status PRODUCT=<slug>` |
| Continue wherever it stopped | `make run PRODUCT=<slug>` |
| Continue from exploration | `make explore PRODUCT=<slug>` |
| Continue from clarifications (you answered the CSV) | `make clarifications PRODUCT=<slug>` |
| Continue from test case generation | `make testcases PRODUCT=<slug>` |
| Sign off a module's test cases (human only) | `make approve PRODUCT=<slug> MODULE=<module>` |
| Bring in your own test case file (`APPROVED=yes`: already signed off, human only) | `make import PRODUCT=<slug> MODULE=<module> [FILE=<path>] [APPROVED=yes]` |
| Change which steps run | `make steps PRODUCT=<slug> STEPS=explore,testcases,playwright-ui` |
| Generate and run Playwright UI + API tests | `make automate PRODUCT=<slug>` |
| Run load tests, or build the report | `make k6 PRODUCT=<slug>` or `make report PRODUCT=<slug>` |
| Any stage, for one module | `make resume PRODUCT=<slug> STAGE=<stage> MODULE=<module>` |

Rules that apply:
- Each target opens a session whose first prompt names the stage. The orchestrator only starts a stage whose prerequisites are done, so asking for `testcases` before `clarifications` finishes does nothing useful.
- The guard check runs again in each new session.
- If the run was ended (`run.mjs end`) the next `make run` starts a new run. It adopts finished stages only after a run that ended `awaiting-approval`, and otherwise redoes everything except unchanged knowledge. There is no make target to redo a finished stage. The run offers a stage again only when its declared outputs are gone (see `docs/artifact-contract.md`), and deleting outputs can destroy your answers or approvals, so ask before doing that by hand.

### 4. What the pipeline does
Per product, then per module, in this order; only the chosen steps and the stages they need:

| Stage | Result |
|---|---|
| `knowledge` and `module-knowledge` | cited product and module knowledge base (when explore, clarifications or testcases runs) |
| `playwright-repo` | the Playwright project skeleton, rendered from templates |
| `explore` | the module's UI states, transitions and API traffic, recorded by script (only your scenarios, if you described some) |
| `clarifications` | `clarifications.csv`: questions the product couldn't answer by itself |
| `api-discovery` | the module's endpoint catalogue (when API or performance cases or tests are needed) |
| `testcases` | script-built test cases (UI, plus `@api` with playwright-api and `@performance` with k6), reviewed case by case; or your own file, imported |
| `playwright-ui`, `playwright-api` | generated tests (one per approved case or planned scenario), a gate, review and fix loops, then a run, triage and heal loop |
| `k6` | load workloads and scripts from the approved `@performance` cases (executed only in `full-run`) |
| `report` | HTML slide deck at `artifacts/<product>/results/<run>/report/index.html` |

Review and heal loops are bounded by `limits.review_rounds` and `limits.heal_rounds`. A stage gets at most two attempts. A stage that fails twice blocks what depends on it, and the report still says what did not run.

### 5. Your two human steps
**Answer clarifications** (stage `clarifications`):
1. Open `artifacts/<product>/modules/<module>/clarifications.csv`.
2. Fill the **Answer** column and save. Agents never overwrite an answer you wrote.
3. Agent-proposed answers carry `Answer status: agent-proposed`. They count as answered, but test cases built on them are `@assumption` until you approve them.
4. Re-invoke the orchestrator. With `clarifications.unresolved_policy: stop`, the stage isn't complete until every row has an answer.

**Approve test cases** (nothing is automated without this):
1. When a module's test cases pass review, its automation stages show `awaiting-approval`, each until a case of its type is approved (UI for Playwright UI, `@api` for Playwright API, `@performance` for k6), and the run can end that way with the report still produced. Imported cases go through the same sheet unless you imported them with `APPROVED=yes`.
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
| `config/` | run-config example, `permissions.yaml`, `models.yaml`, `platforms.yaml`, `mcp.yaml`; your `<product>.yaml` run-configs (and the git-ignored `interview-answers.json` the interview leaves) |
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
