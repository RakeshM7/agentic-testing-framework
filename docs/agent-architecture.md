# Agent architecture v2

Status: **implemented** — all 34 agents, written once in `agents/` and generated for Claude Code (`.claude/agents/`) and GitHub Copilot (`.github/agents/`) by `scripts/build-agents.mjs` from `config/` ([`platforms.md`](platforms.md)), the scripts layer and the contracts ([`artifact-contract.md`](artifact-contract.md), [`agent-handoffs.md`](agent-handoffs.md), [`playwright-conventions.md`](playwright-conventions.md), [`k6-conventions.md`](k6-conventions.md)). Not yet exercised end to end against a real product.

## Principles (decided)
1. One job per agent, with declared inputs and outputs; small prompts; paths in, never pasted content.
2. **Hierarchy via native nested subagents** (Claude Code: default; VS Code Copilot Chat: `chat.subagents.allowInvocationsFromSubagents`): layer 0 main orchestrator → layer 1 domain orchestrators and product-level workers → layer 2 workers. Workers get no subagent tool.
3. **No agent talks to a sibling.** Every hand-off goes through the parent orchestrator, using files as the medium (e.g. triager writes `triage.md`; the orchestrator then starts the fixer with that path).
4. Permissions per agent live in `config/permissions.yaml` and are enforced in code (generated tool lists and subagent allow-lists per platform; the guard keyed on the calling agent, which each host adapter learns from a trusted source; write allow-list), not only in prompts.
5. Single writer per file/cell wherever possible; agents never overwrite human-entered answers.
6. Concurrency is **sequential by default**, configurable in the run-config.

## Roster (34 agents)

Roster v3 ([`decisions.md`](decisions.md) D-043): one fixer per automation domain; each side's foundation built once per product; the clarification-explorer records its own row. `scripts/roster.test.mjs` keeps this table, the counts in the docs and every agent name in the repo in step with `config/permissions.yaml`.

| Domain | Orchestrator | Workers |
|---|---|---|
| Product level | `orchestrator-agent` (layer 0) | `knowledge-generator`, `module-explorer`, `report-generator` |
| Clarification | `clarification-orchestrator` | `clarification-explorer` |
| Test cases | `testcase-orchestrator` | `testcase-writer`, `testcase-reviewer` |
| Shared Playwright repo | — (spawned by `orchestrator-agent` for the skeleton, by either Playwright orchestrator for change requests) | `pw-repo-owner` (sole owner of package.json, playwright.config.ts, tsconfig, .env.example, .gitignore, README, utils/shared/, rendered from templates with its cited overlay) |
| Playwright UI | `playwright-ui-orchestrator` | `pw-ui-scaffolder` (the UI foundation's cited overlay, rendered from templates), `pw-ui-pom-writer` (the page objects `ui-code.mjs` requires), `pw-ui-tests-writer` (the step bodies of the generated skeleton), `pw-ui-reviewer`, `pw-ui-fixer`, `pw-ui-test-runner-triager` |
| Playwright API | `playwright-api-orchestrator` | `api-discoverer`, `api-test-planner`, `pw-api-scaffolder` (the API foundation's cited overlay, rendered from templates), `pw-api-client-writer` (a cited overlay and composite helpers over the clients `api-code.mjs` generates), `pw-api-tests-writer` (the payload and glue slots of the tests `api-code.mjs` generates, one per plan scenario), `pw-api-reviewer`, `pw-api-fixer`, `pw-api-test-runner-triager` |
| K6 | `k6-orchestrator` | `k6-workload-designer` (a cited overlay over the workload `workload.mjs` builds), `k6-lib-writer` (the k6 lib's cited overlay, rendered from templates), `k6-script-writer` (the data slots of the scripts `k6-code.mjs` generates, one per workload scenario), `k6-reviewer`, `k6-fixer`, `k6-runner-triager` |
| Framework maintenance | — | `feedback-implementor-agent` (existing; fixes agent prompts/framework from `feedback/`) |

## Layout v2 (decided): everything is product-level, no `artifacts/<run-id>/` directory

```
artifacts/<product>/
  knowledge/                         # knowledge-generator output, reusable, refreshed each run
  modules/<module>/                  # latest working state per module
    explore/                         # explore.mjs: state model, frontier, sitemap, pages/, interactions, network inventory; the agent's flows/, module-summary
    clarifications.csv               # product-level; columns below
    clarification-evidence/<ID>/     # per-row observation notes + screenshots
    clarifications-summary.md
    testcases/                       # testcases.mjs output; the writer's cases.json; the human's approval.csv
    api/                             # discovered-endpoints.json, coverage.json, drift.json, registry.json, sources/ (endpoints.mjs), overlay.json (api-discoverer), plan.json, plan-coverage.json, plan-registry.json, api-test-plan.md (api-plan.mjs), plan-overlay.json (api-test-planner)
    k6/                              # workload.json, workload-coverage.json, workload-registry.json (workload.mjs); workload-overlay.json (k6-workload-designer); code-plan.json, parked.json, legacy/ (k6-code.mjs)
  state/
    run.json                         # current run: id, mode, stage status      (replaces artifacts/<run-id>/run.json)
    ledger.jsonl                     # created entities, each entry tagged with runId; deletes scoped to the CURRENT run's entries
    lock.json                        # one active run per product; run.mjs init refuses/offers resume if held
    orchestration/<domain>-<module>.json   # loop counters (review/heal rounds, max 3 each)
    config.resolved.json
    history/<run-id>.json            # compact summary per finished run
  results/<run-id>/                  # per-run archive (still no top-level run-id dir): <module>/{testcases,playwright-ui,playwright-api,k6}/{review-findings.md, results.json, triage.md}, report/
playwright-tests/<product>/          # ONE repo: tests/ui + tests/api (plus pages/, clients/, helpers/{ui,api}/, fixtures/{ui,api}/, config/api/)
k6-tests/<product>/                  # lib/, scripts/, results/
```
Working files under `modules/` always represent the latest state and are overwritten by later runs; anything that must stay comparable between runs (reviews, results, triage, report) goes under `results/<run-id>/`.

## Flow

```
config ──► run.mjs init
main orchestrator:
  1 knowledge-generator, product pass -> artifacts/<product>/knowledge/{overview,glossary,sources}.md   (built)
    knowledge-generator, one module pass per module -> knowledge/modules/<m>/{overview,glossary,notes,sources}.md
    (cited sources from a product-wide registry; reused unless inputs changed; live product only if needed)
  2 module-explorer  (per module, in config order; modules come from the run-config)
        -> artifacts/<product>/modules/<m>/explore/{sitemap.json, pages/, flows/, module-summary.md, interactions + network inventory}
        -> artifacts/<product>/modules/<m>/clarifications.csv   (product-level; new rows for unconfirmed behavior)
  3 clarification-orchestrator (per module):
        clarification-explorer (one per row open at the start, one at a time, fresh browser session each)
                               -> executes Steps live, captures clarification-evidence/, records its row through
                               clarifications.mjs record --file (checked against the evidence; Answer is agent-proposed)
                               [script] no valid record -> one retry, then blocked; follow-ups wait for the next run
        then clarifications-summary.md, rendered from the CSV by the script
        [gate] unresolved rows: human edits the Answer column, re-invoke resumes
  4 testcase-orchestrator: testcase-writer (cases.json; testcases.mjs build/check) -> gate script | testcase-reviewer (a verdict per case; verdict derived) -> testcase-writer (max N rounds); then a human approves cases (approval.csv + testcases.mjs approve), and only approved cases are automated (D-053)
  5 pw-repo-owner (once per product, any time before step 6): shared repo skeleton for ui + api, rendered from templates/ (foundation.mjs, D-054)
  6 playwright-ui-orchestrator and playwright-api-orchestrator (independent; both need testcases + the repo)
        build:  scaffolder (cited overlay -> foundation.mjs render + check; skipped while the verified stamp is current) -> pom|client writer -> tests-writer
                (UI: ui-code.mjs build scaffolds one test per approved case and the page objects per touched page template;
                 each writer ends with ui-code.mjs check, whose stamp the step needs, D-055;
                 API: api-code.mjs build generates the clients and one test per plan scenario; the writers fill
                 the overlays and slots and end with api-code.mjs check, whose stamp the step needs, D-056)
        review loop: gate script -> (fail: gate findings -> fixer) | reviewer -> findings -> fixer (max N rounds)
        run loop:    runner-triager -> triage.md -> fixer -> re-run (max N rounds)
        every domain orchestrator follows `orchestration.mjs next`, which holds these flows (scripts/lib/domain-flows.mjs)
        API additionally starts with api-discoverer -> api-test-planner
  7 k6-orchestrator (needs the API plan): workload-designer (cited overlay -> workload.mjs build + check, run=<run-id>) -> lib-writer (cited overlay -> foundation.mjs render + check; skipped while verified) -> script-writer (slots -> k6-code.mjs build + check) -> review loop -> run/fix loop
  8 report-generator -> HTML slide deck
```

## Contracts decided so far

**`clarifications.csv`** is **product-level knowledge**, not run output: `artifacts/<product>/modules/<module>/clarifications.csv` (evidence beside it in `clarification-evidence/<ID>/`, summary in `clarifications-summary.md`). It accumulates across runs; `artifacts/<product>/` is separate from the per-run `artifacts/<run-id>/` tree.
- Columns, in order: `ID`, `Module`, `Question`, `Steps to execute`, `Answer`, `Answer status`, `Clarification agent notes`, `Run ID`.
- `ID` = `<module>-<n>` (e.g. `contacts-7`): module slug plus a per-module sequence number assigned by a script, never reused.
- `Steps to execute`: detailed, human-readable steps that someone who has never seen the product can follow.
- `Answer`: filled by the row's clarification-explorer when behavior is confirmed (a structured, evidence-checked answer), or by a human; never overwritten once non-empty.
- `Answer status`: `agent-proposed` (an assumption downstream until a human approves it), `human-approved` or `human` (D-048).
- `Clarification agent notes`: why a row is still unconfirmed, what was tried, evidence path.
- `Run ID`: the run that **created** the row (stamped by the CSV script; never changed afterwards).
- Re-runs: existing rows are **trusted as is**. A row is updated (Answer/notes) only when an incoming requirement changes the recorded behavior; the module-explorer appends only genuinely new questions (script de-duplication).
- Writers (one per cell): module-explorer appends new rows and refines Question/Steps of unanswered rows; the per-row clarification-explorer writes its evidence under `clarification-evidence/` and fills its own row's Answer/notes; the script stamps Run ID and renders `clarifications-summary.md`.
- A script (not an LLM) will own CSV I/O: ID assignment, de-duplication of new rows against existing ones, quoting, and a file lock so two runs can't corrupt the product-level file.

**Playwright repo**: UI and API share `playwright-tests/<product>/`, separated by `tests/ui` and `tests/api` (two Playwright projects in one config). Two orchestrators and two full agent sets are kept. `pw-repo-owner` is the only owner of shared repo files: it creates the skeleton (stage `playwright-repo`) and applies change requests the Playwright orchestrators hand it. **Foundations are script-built (D-054):** every fixed file of the repo, of each side and of the k6 lib is rendered by `scripts/foundation.mjs` from the framework's `templates/`, with a drift check; `pw-repo-owner`, the UI and API scaffolders and `k6-lib-writer` each write only a cited overlay (and their side's extension files), and a gap or change request is a structured overlay entry followed by a re-render. **The UI code is script-scaffolded (D-055):** `scripts/ui-code.mjs` writes one test skeleton per approved case (its title, tags and one step per case step), the page-object list per touched page template with class shells, the fixture registration and a readonly locator smoke; `pw-ui-pom-writer` writes the page objects with names verbatim from the state snapshots, `pw-ui-tests-writer` fills the step bodies, and `check` verifies both. **The API code is generated (D-056):** `scripts/api-code.mjs` writes the clients, types, schemas, client fixtures and one literal test per plan scenario as managed files the guard denies writing; `pw-api-client-writer` writes a cited overlay and composite helpers, `pw-api-tests-writer` fills the payload and glue slots, and `check` verifies both. The UI and API scaffolders add only their own side's scaffolding, and every other agent writes only inside its own side's folders (ownership table in `config/permissions.yaml`).

**Run lock**: one active run per product (`state/lock.json`).

**Permissions** (`config/permissions.yaml`): the run's `authorizations.mode` caps every agent. `readonly` reduces all `mutate`/`run` to `read`/`none`; `full-run` applies the file as written. Project roots, per product: `playwright-tests/<product>/` and `k6-tests/<product>/`. Limits: review rounds 3, heal rounds 3.

**Run-config additions** (to be implemented): `knowledge.references[]` (URLs, doc paths, KB links), `modules[]` (explicit list: slug, name, entry URL / nav path), `permissions_file`, project roots (`ui_project`, `api_project`, `k6_project`), `testcases.output_format`, `limits.review_rounds`, `limits.heal_rounds`, `concurrency.{modules,clarification_rows}` (default 1).

**Stage table**: one stage per domain, defined in `STAGES` in `scripts/lib/contract.mjs` (and described in [`artifact-contract.md`](artifact-contract.md)); the steps inside a domain belong to its orchestrator. Each stage keeps declared, schema-verified outputs, so `run.mjs next` stays the only source of "what runs next".

**Report**: HTML slide deck from `report.json` (modules explored, clarifications answered/unconfirmed, test cases, Playwright UI/API specs, k6 scripts, execution results per framework).

## Rollout (domain by domain, each tested before the next)
knowledge-generator → module-explorer → clarification domain → testcase domain → Playwright UI → Playwright API → K6 → report.
