# Agent architecture v2 (design — decisions from the interview, not yet implemented)

Status: **foundation implemented** (layout v2 state, lock, ledger, clarifications CSV, per-agent permissions in the guard — see [`artifact-contract.md`](artifact-contract.md)). Agents are implemented domain by domain (order below); until a domain is built, its prompts in `claude-agents/` are the old pre-v2 ones.

## Principles (decided)
1. One job per agent, with declared inputs and outputs; small prompts; paths in, never pasted content.
2. **Hierarchy via native nested subagents** (Claude Code default depth 3): layer 0 main orchestrator → layer 1 domain orchestrators and product-level workers → layer 2 workers. Workers do not have the `Agent` tool.
3. **No agent talks to a sibling.** Every hand-off goes through the parent orchestrator, using files as the medium (e.g. triager writes `triage.md`; the orchestrator then starts the healer with that path).
4. Permissions per agent live in `config/permissions.yaml` and are enforced in code (tools frontmatter, guard keyed on the hook's `agent_type`, write allow-list), not only in prompts.
5. Single writer per file/cell wherever possible; agents never overwrite human-entered answers.
6. Concurrency is **sequential by default**, configurable in the run-config.

## Roster (43 agents)

| Domain | Orchestrator | Workers |
|---|---|---|
| Product level | `orchestrator-agent` (layer 0) | `knowledge-generator`, `module-explorer`, `report-generator` |
| Clarification | `clarification-orchestrator` | `question-writer`, `clarification-explorer`, `clarification-writer` |
| Test cases | `testcase-orchestrator` | `testcase-writer`, `testcase-reviewer` |
| Shared Playwright repo | — (spawned by `orchestrator-agent` for the skeleton, by either Playwright orchestrator for change requests) | `pw-repo-owner` (sole writer of package.json, playwright.config.ts, tsconfig, .env.example, .gitignore, README, utils/shared/) |
| Playwright UI | `playwright-ui-orchestrator` | `pw-ui-scaffolder`, `-helper-writer`, `-fixtures-writer`, `-pom-writer`, `-tests-writer`, `-reviewer`, `-feedback-implementor`, `-test-runner-triager`, `-healer` |
| Playwright API | `playwright-api-orchestrator` | `api-discoverer`, `api-test-planner`, `pw-api-scaffolder`, `-helper-writer`, `-fixtures-writer`, `-client-writer` (the API analogue of the POM), `-tests-writer`, `-reviewer`, `-feedback-implementor`, `-test-runner-triager`, `-healer` |
| K6 | `k6-orchestrator` | `k6-workload-designer`, `k6-lib-writer`, `k6-script-writer`, `k6-reviewer`, `k6-feedback-implementor`, `k6-runner-triager`, `k6-healer` |
| Framework maintenance | — | `feedback-implementor-agent` (existing; fixes agent prompts/framework from `feedback/`) |

## Layout v2 (decided): everything is product-level, no `artifacts/<run-id>/` directory

```
artifacts/<product>/
  knowledge/                         # knowledge-generator output, reusable, refreshed each run
  modules/<module>/                  # latest working state per module
    explore/                         # sitemap, pages/, flows/, module-summary, interactions + network inventory
    clarifications.csv               # product-level; columns below
    clarification-evidence/<ID>/     # per-row observation notes + screenshots
    clarifications-summary.md
    testcases/                       # writer output
    api/                             # discovered-endpoints.json, api-test-plan.md, plan.json
    k6/                              # workload.json
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
  1 knowledge-generator            -> knowledge/<product>/   (reusable per product; refreshed, cites sources; live product only if needed)
  2 module-explorer  (per module, in config order; modules come from the run-config)
        -> artifacts/<product>/modules/<m>/explore/{sitemap.json, pages/, flows/, module-summary.md, interactions + network inventory}
        -> artifacts/<product>/modules/<m>/clarifications.csv   (product-level; new rows for unconfirmed behavior)
  3 clarification-orchestrator (per module):
        question-writer  -> polishes Question + detailed human-readable Steps
        clarification-explorer (one per row, sequential) -> executes Steps live, writes clarification-evidence/
        clarification-writer -> Answer / "Clarification agent notes" and Run ID in the CSV + clarifications-summary.md
        [gate] unresolved rows: human edits the Answer column, re-invoke resumes
  4 testcase-orchestrator: testcase-writer <-> testcase-reviewer
  5 pw-repo-owner (once per product, any time before step 6): shared repo skeleton for ui + api
  6 playwright-ui-orchestrator and playwright-api-orchestrator (independent; both need testcases + the repo)
        build:  scaffolder -> helper / fixtures / pom|client writers -> tests-writer
        review loop: reviewer -> findings -> feedback-implementor (max N rounds, via the orchestrator)
        run loop:    runner-triager -> triage.md -> healer -> re-run (max N rounds, via the orchestrator)
        API additionally starts with api-discoverer -> api-test-planner
  7 k6-orchestrator (needs the API plan): workload-designer -> lib-writer -> script-writer -> review loop -> run/heal loop
  8 report-generator -> HTML slide deck
```

## Contracts decided so far

**`clarifications.csv`** is **product-level knowledge**, not run output: `artifacts/<product>/modules/<module>/clarifications.csv` (evidence beside it in `clarification-evidence/<ID>/`, summary in `clarifications-summary.md`). It accumulates across runs; `artifacts/<product>/` is separate from the per-run `artifacts/<run-id>/` tree.
- Columns, in order: `ID`, `Module`, `Question`, `Steps to execute`, `Answer`, `Clarification agent notes`, `Run ID`.
- `ID` = `<module>-<n>` (e.g. `contacts-7`): module slug plus a per-module sequence number assigned by a script, never reused.
- `Steps to execute`: detailed, human-readable steps that someone who has never seen the product can follow.
- `Answer`: filled by the clarification-writer when behavior is confirmed, or by a human; never overwritten once non-empty.
- `Clarification agent notes`: why a row is still unconfirmed, what was tried, evidence path.
- `Run ID`: the run that **created** the row (stamped by the CSV script; never changed afterwards).
- Re-runs: existing rows are **trusted as is**. A row is updated (Answer/notes) only when an incoming requirement changes the recorded behavior; the module-explorer appends only genuinely new questions (script de-duplication).
- Writers (one per cell): module-explorer appends new rows; question-writer edits Question/Steps of unanswered rows; clarification-writer fills Answer/notes/Run ID; the per-row clarification-explorer writes only under `clarification-evidence/`.
- A script (not an LLM) will own CSV I/O: ID assignment, de-duplication of new rows against existing ones, quoting, and a file lock so two runs can't corrupt the product-level file.

**Playwright repo**: UI and API share `playwright-tests/<product>/`, separated by `tests/ui` and `tests/api` (two Playwright projects in one config). Two orchestrators and two full agent sets are kept. `pw-repo-owner` is the only writer of shared repo files: it creates the skeleton (stage `playwright-repo`) and applies change requests the Playwright orchestrators hand it. The UI and API scaffolders add only their own side's scaffolding, and every other agent writes only inside its own side's folders (ownership table in `config/permissions.yaml`).

**Run lock**: one active run per product (`state/lock.json`).

**Permissions** (`config/permissions.yaml`): the run's `authorizations.mode` caps every agent. `readonly` reduces all `mutate`/`run` to `read`/`none`; `full-run` applies the file as written. Project roots, per product: `playwright-tests/<product>/` and `k6-tests/<product>/`. Limits: review rounds 3, heal rounds 3.

**Run-config additions** (to be implemented): `knowledge.references[]` (URLs, doc paths, KB links), `modules[]` (explicit list: slug, name, entry URL / nav path), `permissions_file`, project roots (`ui_project`, `api_project`, `k6_project`), `testcases.output_format`, `limits.review_rounds`, `limits.heal_rounds`, `concurrency.{modules,clarification_rows}` (default 1).

**Stage table**: grows per domain (knowledge, explore, clarify-{write,explore,finalize}, testcases-{write,review}, pw-ui-*, pw-api-*, k6-*, report). Each stage keeps declared, schema-verified outputs, so `run.mjs next` stays the only source of "what runs next".

**Report**: HTML slide deck from `report.json` (modules explored, clarifications answered/unconfirmed, test cases, Playwright UI/API specs, k6 scripts, execution results per framework).

## Rollout (domain by domain, each tested before the next)
knowledge-generator → module-explorer → clarification domain → testcase domain → Playwright UI → Playwright API → K6 → report.
