# Artifact contract — layout v2 (implemented: foundation)

The single definition of where things live, how stages hand off, and how state and safety work. It is implemented in code — `scripts/lib/{contract,clarifications,ledger,permissions,guard,csv,endpoints,explore,foundation,ui-code,api-code,workload,k6-code}.mjs` and the CLIs `scripts/{run,clarifications,ledger,run-config,endpoints,explore,foundation,ui-code,api-code,workload,k6-code}.mjs` — and validated by JSON Schemas in `schemas/`. Agent prompts must never contradict this file; when they differ, this file and the scripts win. The agent roster and responsibilities are in [`agent-architecture.md`](agent-architecture.md).

## Layout: everything is product-level

```
artifacts/hook-errors.jsonl           # every PreToolUse/PostToolUse hook error, with its stack (D-065; one .1 generation)
artifacts/<product>/                  # git-ignored; accumulates across runs
  knowledge/                          # knowledge-generator: reusable, cited product knowledge (see below)
    overview.md glossary.md           # the agent's (product pass)
    sources.md sources.json inputs.json coverage.json open-points.json   # knowledge.mjs
    sources/S<n>.txt sources/index.json   # knowledge.mjs snapshot: cached source text for quote checks
    captures/                         # the agent's captures of pages the script can't fetch
    modules/<module>/{overview,glossary,notes}.md                 # the agent's (module pass)
    modules/<module>/{sources.md,coverage.json,open-points.json,rule-facts.json}   # knowledge.mjs
  modules/<module>/                   # latest working state, overwritten by later runs
    explore/                          # explore.mjs: sitemap.json model.json coverage.json interactions.json network-inventory.json
                                      # explore-model.md log.jsonl registry/ pages/<slug>/{dom-snapshot.md,states/<ST>.md};
                                      # flows/ module-summary.md new-questions.json overlay.json captures/ are the module-explorer's
    clarifications.csv                # product-level clarifications (format below)
    clarification-evidence/<ID>/      # what the clarification-explorer observed per row
    clarifications-summary.md
    scenarios.json                    # scenario mode (D-066): the human's scenarios with stable SC ids, written by `run.mjs scenarios`
    testcases/   api/   k6/           # domain working files; testcases/imported.json is the human's own file parsed by
                                      # `testcases.mjs import` (schema testcases-imported, script-owned)
    ui-code/                          # ui-code.mjs (D-055): plan.json coverage.json parked.json -- all script-owned
    api-code/                         # api-code.mjs (D-056): plan.json coverage.json parked.json (script-owned);
                                      # client-overlay.json is pw-api-client-writer's, tests-overlay.json pw-api-tests-writer's
    api/                              # endpoints.mjs (stage api-discovery, D-067): discovered-endpoints.json coverage.json
                                      # drift.json registry.json sources/; overlay.json is the api-discoverer's (see below)
                                      # api-plan.mjs: plan.json plan-coverage.json plan-registry.json api-test-plan.md;
                                      # plan-overlay.json is the api-test-planner's
    k6/                               # workload.mjs (D-068, from the approved @performance cases): workload.json workload-coverage.json workload-registry.json;
                                      # workload-overlay.json is the k6-workload-designer's
                                      # k6-code.mjs: code-plan.json parked.json legacy/ -- all script-owned
    triage/                           # triage.mjs (D-058): triage-registry.json (the BUG ids), script-owned
  known-issues.json                   # HUMAN-edited (schema known-issues): signatures of defects already tracked; no agent writes it
  foundation/                         # foundation.mjs (D-054): <side>-manifest.json (rendered files, verified stamp);
                                      # <side>-overlay.json for side repo|ui|api|k6 is that side's agent's
  state/
    run.json                          # the current (or last) run: id, mode, modules, steps, caseTypes, stage status
    scenario-answers.json             # the orchestrator's scenario interview (D-066), turned into modules/<m>/scenarios.json
    lock.json                         # present only while a run is active -- one active run per product
    ledger.jsonl                      # entities created in the target, every entry tagged with runId
    config.resolved.json              # the validated run-config the current run started from (hand-written, or drafted from
                                      # the orchestrator's interview by `run-config.mjs draft`, D-063; `about.visibility` included)
    permissions.resolved.json         # frozen copy of config/permissions.yaml for the current run
    orchestration/<domain>-<module>.json   # domain orchestrators' loop counters (review/heal rounds)
    guard-check/                      # guard liveness records for the current session (run.mjs guard-check)
    doctor.json                       # the current session's dependency check (run.mjs doctor, D-064)
    history/<run-id>.json             # summary of every ended run
  results/<run-id>/                   # per-run archive: <module>/{testcases,playwright-ui,playwright-api,k6}/..., report/
playwright-tests/<product>/           # ONE Playwright repo: tests/ui + tests/api
k6-tests/<product>/                   # lib/ (rendered), scripts/<m>-*.js (k6-code.mjs), scripts/slots/<m>.js, results/
```

There is no `artifacts/<run-id>/` directory. Run ids are `<product>-<YYYYMMDD>-<HHmm>` (suffixed `-2`, `-3`… if reused).

## Runs

```bash
node scripts/run.mjs init config/<product>.yaml [--resume]   # validate config + permissions, take the lock, write state/
node scripts/run.mjs guard-check <product>                   # liveness canary: a working guard BLOCKS this
node scripts/run.mjs doctor <product>                        # what each stage needs on this machine; {checks, blockedStages}
node scripts/run.mjs prereqs <product>                       # per module and chosen step: ok | missing (with the gap menu) | awaiting-approval
node scripts/run.mjs steps <product> [--add a,b] [--remove c] [--import-mode m] [--reopen m]   # the gap menu's answer (an option's args)
node scripts/run.mjs scenarios <product> [--file <answers>]  # state/scenario-answers.json -> modules/<m>/scenarios.json (SC ids)
node scripts/run.mjs next <product>                          # {actions: [{stage, module, agent, prompt, attempt, retry}], concurrency, end?}
node scripts/run.mjs stage <product> <stage> start|done|fail [--module M] [--error MSG]
node scripts/run.mjs status <product>                        # every stage with output verification
node scripts/run.mjs end <product> [--abandon]               # history/<run-id>.json, release the lock
node scripts/run.mjs validate <product>                      # schema-check state, ledger, sitemaps, CSVs
```

- `init` refuses while another run holds the product's lock (`--resume` returns the active run; `end --abandon` releases it).
- `--resume` turns every stage still `running` into a failed attempt with `interrupted: true` (D-071): the session that ran it has ended, so nothing else would ever mark it. `next` offers it again while it has attempts left, and the result lists it under `interrupted`.
- Every read-modify-write of `run.json` (`stage`, `steps`, `--resume`, carry-forward) holds `state/run.json.lock`, and every state file is written atomically through `scripts/lib/files.mjs` (D-072). `concurrency.modules` is capped at 1 until parallel modules are safe.
- `config/permissions.yaml` is validated and frozen into `state/permissions.resolved.json` at `init`; edits take effect on the next run.
- `init` records `startedOnHost`.
- Guard liveness: `init` and `--resume` clear `state/guard-check/`; the orchestrator then runs `run.mjs guard-check <product>`, which every working hook blocks — the hook entry records the blocking host/agent there; if the command runs instead, it records `absent.json`. `stage … start` refuses until a record fits the mode. Any hook's record counts, with one exception: a full-run on VS Code's local agent needs a record from an agent's own hook.
- Dependencies (D-064): `init` and `--resume` also clear `state/doctor.json`; the orchestrator then runs `run.mjs doctor <product>`. `stage … start` refuses a stage while a check it needs fails (`STAGE_NEEDS` in `scripts/lib/doctor.mjs`), or once the product repo was built after the check. A human fixes it (`make doctor PRODUCT=<product>` applies the safe installs), then the check runs again.

### Stages (the main orchestrator's view — one per domain)

| Stage | Scope | Needs | Declared outputs (verified on `done`) |
|---|---|---|---|
| `knowledge` | product | — | `knowledge/{overview,glossary,sources}.md`, `sources.json`, `coverage.json`, `open-points.json` (schemas) — every knowledge check passes and the verified stamp is current |
| `module-knowledge` | module | knowledge | `knowledge/modules/<m>/{overview,glossary,notes,sources}.md`, `coverage.json`, `open-points.json`, `rule-facts.json` (schemas) — every knowledge, glossary-merge and sources check passes and the verified stamp is current |
| `playwright-repo` | product | — | `playwright-tests/<product>/package.json`, `playwright.config.ts` — the repo side's verified stamp of `foundation.mjs check` is current |
| `explore` | module | module-knowledge | `modules/<m>/explore/sitemap.json` (schema), `module-summary.md` — the verified stamp of `explore.mjs check` is current |
| `clarifications` | module | explore (after module-knowledge) | `modules/<m>/clarifications.csv` (check below), `clarifications-summary.md` |
| `api-discovery` | module | explore | `modules/<m>/api/discovered-endpoints.json` (schema; `endpoints.mjs check` passes), `coverage.json` (schema), `drift.json` — run by `api-discoverer`, started by the orchestrator; an empty catalogue is a valid outcome |
| `testcases` | module | explore; api-discovery when the run derives `@api` or `@performance` cases (after module-knowledge and clarifications, when chosen) | `modules/<m>/testcases/<m>-testcases.<ext>` + `testcases-summary.md` — `Total test cases: N` must equal the cases in the file. Completes once the review passes; approval comes later |
| `playwright-ui` | module | testcases, playwright-repo, **a human-approved UI test case** | `results/<run>/<m>/playwright-ui/results.json` (schema `results`, written by `results.mjs`) |
| `playwright-api` | module | testcases, playwright-repo, api-discovery, **a human-approved `@api` test case** | `results/<run>/<m>/playwright-api/results.json` (schema `results`) |
| `k6` | module | testcases, api-discovery, **a human-approved `@performance` test case** | `results/<run>/<m>/k6/results.json` (schema `results`; `not-run` in readonly runs) |
| `report` | product | every other stage complete, exhausted or blocked | `results/<run>/report/report.json` (by `report-data.mjs`, schema `report`) + `index.html` (by `report.mjs render`; `done` needs the verified stamp `report-check.json` of `report.mjs check`) |

"Needs" are hard needs; "after" is a soft order: a stage waits for it only while it is chosen for this run and not settled, and is never blocked by it.

**Steps (D-066).** A run executes only the steps the human chose (`steps:` in the run-config, one set for every module; absent = all six: `explore`, `clarifications`, `testcases`, `playwright-ui`, `playwright-api`, `k6`), frozen with the case types they derive (`caseTypes`: `ui` always, `api` with playwright-api, `performance` with k6, plus `testcases.types`) into `run.json` at `init`. The run's stages are the chosen steps plus what they need automatically: knowledge and module-knowledge for explore, clarifications and testcases; api-discovery when API or performance cases or tests are needed; playwright-repo for either Playwright step; the report always. Every other stage is `not-chosen`: `next` never offers it, `stage … start` refuses it, it is never failed or blocked, `end.notChosen` lists it, and the report shows it as "Not chosen for this run". A need on a not-chosen stage is met by that stage's outputs verifying from an earlier run, or, for test cases, by the human's imported file (`satisfiedBy: earlier-run | import`); otherwise its dependant is blocked with `unmet`.
- **Prerequisites up front.** After `doctor`, `run.mjs prereqs` checks every module against the chosen steps (exit 1 while a gap is open): one gap per module and need (`explore` or `testcases`), with the gap menu's options `{id, label, adds|removes, importMode?, reopen?, args?}`: Explore the product · Ask clarification questions · Generate test cases · Describe scenarios to explore · Use my test case file · Skip this step for this run; a `link` gap (imported UI cases not linked while no testcases stage runs for the module) offers **Link my imported cases to the explored screens** (`--import-mode <m>`), and a step added after the module's testcases stage completed without its case type offers **Generate @api / @performance cases** (`--add testcases --reopen <m>`: the stage goes back to pending; approvals of unchanged cases stand). `run.mjs steps <p> <args>` applies the answer to the run (a step whose stages started can't be removed); after an add, `run-config.mjs set --steps <configSteps>` keeps the config's own steps plus the added ones (a skip never leaves the config).
- **`run-config.mjs set <config> [--steps a,b] [--testcases-file <m>=<path>] [--testcases-import <path>] [--testcases-types ui,api]`** validates first, then rewrites only those keys of the file; every other byte and comment stays. It is the one change a script makes to an existing run-config (D-063's drafts are never written over a file).
- **Scenario mode.** `run.mjs scenarios` turns `state/scenario-answers.json` (`{"modules": {"<m>": [{title, goal, start, steps}]}}`, written by the orchestrator) into `modules/<m>/scenarios.json` (schema `scenarios`, stable `SC-<m>-<n>` ids by title); `[]` returns a module to a whole-module exploration. The exploration is then scenario-scoped (`explore/coverage.json` `scope`), and the test cases cover only those scenarios' flows.
- **Imports.** `testcases.mjs import <p> <m> [--file]` parses the human's file (`modules[].testcases_file`, else the product-level `testcases.import` split by `@module:<slug>` or a Module column) in a framework format into `testcases/imported.json`; any other document is converted by testcase-writer's import mode into `cases.json` cases citing it verbatim. Imported cases enter `approval.csv` like generated ones; `import … --approved` is human-only (a terminal and the typed module slug; the guard denies it to every tool call).
- **Import mode (`run.json` `testcasesMode`).** Without the `testcases` step, a module whose imported cases must be converted or linked runs its testcases stage in import mode, for that module only (`run.mjs steps --import-mode <m>`; the other modules have no testcases stage). The writer converts and links only; every coverage item no case covers is `deferred` with reason `import`; `check` verifies the imported cases (overlay, verbatim quotes, links; with `playwright-ui` chosen, every imported UI case linked, in either mode). With `testcases` chosen every module is `generate`: generated and imported cases.

A stage is complete only if `run.json` marks it `done` **and** every declared output exists, is non-empty and passes its schema or check; `done` is refused otherwise, and a stage whose outputs later disappear is offered again by `next`. Sub-steps inside a domain (build steps, gate → reviewer → fixer, runner-triager → fixer) belong to the domain orchestrator, not this table: it follows `node scripts/orchestration.mjs next <product> <domain> <module>`, which reads the domain's flow from `scripts/lib/domain-flows.mjs` and the files on disk, runs the script steps itself (the pre-review gate, the clarification summary), and spends the bounded review and heal rounds.

`next` returns, per stage, the agent and the exact prompt (run id, mode, test case format, module), marks reusable knowledge done itself (`reused`), and, with nothing left to start, `end`: `completed`, `awaiting-approval` (with `sheets`) or `incomplete` (`failed`, `blocked`, `running`). A refused `done` returns `retry: {agent, prompt}` the first time and fails the stage the second (`doneRefusals`; a clarifications refusal waits for a human instead). A domain whose review used up its rounds is failed at `done` (`reviewFailed`, `findings`) and blocks its dependants at once.

Each stage gets at most **two attempts** per run (`attempts` in `run.json`; an `interrupted` attempt counts); a stage that failed twice is *exhausted*, everything depending on it is *blocked*, and `next` no longer offers either — so the report still becomes ready and states what did not run.

**`awaiting-approval` (D-053, per type since D-066).** Once a module's test cases are complete, each automation stage is `awaiting-approval` while no case of its type is approved by a human: `playwright-ui` waits for a UI case, `playwright-api` for an `@api` case, `k6` for an `@performance` case (an imported UI case also needs its exploration states linked). Such a stage is never offered, `stage … start` refuses it without spending an attempt, and it counts as settled, so the report still runs; `next` offers the report stage, and `end` reports the run `awaiting-approval` (listing the approval sheets) when nothing else is left. A new run for the product then adopts that run's complete stages whose product-level outputs still verify (`carriedFrom`, D-060; consistent with D-003: the first run has ended and released the lock). A later run picks the module up once cases are approved.

## Knowledge base

`artifacts/<product>/knowledge/`, built by `knowledge-generator`: a **product pass** (stage `knowledge`) then one **module pass** per module (stage `module-knowledge`).

- **Sources** — one product-wide registry, `sources.json` (`schemas/sources.schema.json`), written only by `node scripts/knowledge.mjs add-source`; the same (normalized) URL or path always gets the same id `S<n>`. `sources.md` files are rendered from it: the product one lists every source, a module one lists what that module cites.
- **Citations** — every content line of overview/glossary/notes cites at least one registered source (`[S3]`, or `[S3 "exact words"]` with a quote); lines under `## Open points` are exempt (unconfirmed items, candidates for clarification). Enforced by `knowledge.mjs check` and on stage `done`.
- **Verified quotes for rule facts (D-051)** — in a module's `notes.md`, these lines carry a citation with a quote of at least 3 words: every content line under `## Business rules and validations`, `## Roles and permissions` and `## Limits and constraints`, and every line under `## Key entities and fields` that names a constraint (`CONSTRAINT_RE` in `scripts/lib/knowledge.mjs`). `check` finds the quote in `sources/S<n>.txt`, ignoring whitespace, case and curly quotes. `knowledge.mjs snapshot <p> S<n>` fills that cache:
  - a URL: one plain GET with no credentials, never to a `target.url` or `target.api_urls` host or a subdomain of one, with hosts normalized (case, trailing dot; any port) and redirects checked too. An HTML page with fewer than 20 readable words, or binary content, is a failed fetch;
  - a repo file: read directly, never a credentials, session or `.env` file;
  - `--from-file captures/<file>`: the agent's capture, recorded `captured_by: agent` and counted by `check`. It is accepted only for a `live-product` source, or after the script's own fetch of that source failed in this run; the failure is kept in the entry's `fetchError`;
  - text cached in an earlier run (the entry's `runId`) is fetched again. If that fails, the old text is kept with `status: stale`, and `check` reports the stale count.
  - **Evidence.** A rule fact whose quotes rest only on an agent capture or on stale text is allowed but weaker. `check` writes `modules/<m>/rule-facts.json` (schema `knowledge-rule-facts`) with each rule fact's `evidence` (`script-fetched`, `agent-capture` or `stale`), and lists the weaker ones under `agentCapturedRuleFacts` and `staleRuleFacts`. The stamp covers the file, and the stage refuses it when it no longer matches the notes and the cache.
- **Input ledger (D-051)** — `coverage.json` (product pass) and `modules/<m>/coverage.json` (module pass), schema `knowledge-coverage`, built on `scripts/lib/coverage.mjs`. The configured inputs are `feature.requirement_docs` and `knowledge.references`, plus the module's `references` in a module pass. Each becomes read when a source with its normalized location is registered, or is marked `failed` or `excluded` with a reason by `knowledge.mjs input`. `check` fails while one is unaccounted for. A ledger from an earlier run starts over when a later run rebuilds the pass.
- **Extra-source budget (D-051)** — sources that are neither configured inputs nor `live-product` are capped per pass at `knowledge.max_extra_sources` (default 20). A `live-product` source must be a page on a `target.url` or `target.api_urls` host; `add-source` refuses any other. Over the cap, `add-source` registers nothing, returns `{deferred: true}` and records the source `deferred: budget` in the ledger.
- **Fact checklist (D-051)** — the product overview has its fixed headings and exactly one `## Main areas` bullet per configured module, matched by name. The module overview and `notes.md` have theirs; `notes.md` adds `## Limits and constraints`. Only the fixed headings are allowed, each once: an extra `##`, a second `#` (or any `#` in `notes.md`), or content outside the `##` sections fails. Each fact category (`entities`, `flows`, `rules`, `roles`, `limits`, `dependencies`) has a cited line in its `notes.md` section or an open point tagged `(<category>)`. Code fences fail, and each open point is a single bullet line.
- **Open point ids (D-051)** — `render` and `check` write `open-points.json` (schema `knowledge-open-points`): one id per open point from `scripts/lib/registry.mjs`, `KQ-<m>-<n>` or `KQ-product-<n>` (the module slug `product` is reserved), keyed by the normalized text, with its text and category tag. A removed point is kept as `gone`, and ids are never reused. The agent's markdown is never rewritten.
- **Verified** — a passing `knowledge.mjs check` stamps the pass's files into its `coverage.json` (`scripts/lib/verified.mjs`): the product overview, its open points and the product-scope glossary rows; or the module's overview, glossary, notes, `sources.md` and open points. The stage's `done`, and `plan`'s `reuse`, refuse a missing or stale stamp.
- **Glossaries** — product: `| Term | Definition | Scope | Sources |`; module: `| Term | Definition | Sources |`, merged into the product glossary with Scope = module slug by `knowledge.mjs merge-glossary`.
- **Reuse unless inputs changed** — `knowledge.mjs plan <product>` compares fingerprints in `inputs.json` (recorded automatically when a knowledge stage is marked `done`) with the current config: product-wide `knowledge.references` and `feature.requirement_docs` (local files by content) affect the product and every module; a module's own entry (`name`, `entry_url`, `nav_path`, `references`) affects only that module. Unchanged parts with valid files are `reuse` — the orchestrator marks their stage `done` without invoking the agent.

## `clarifications.csv`

`artifacts/<product>/modules/<module>/clarifications.csv`, columns in this exact order:

| Column | Written by | Rule |
|---|---|---|
| `ID` | script | `<module>-<n>`, per-module sequence, never reused |
| `Module` | script | module slug |
| `Question` | module-explorer (new rows; refines unanswered rows) | |
| `Steps to execute` | same | detailed, human-readable, followable by someone who has never seen the product |
| `Answer` | clarification-explorer (its own row, through `record --file`), or a human directly in the file | never overwritten once non-empty, except for a requirement change. An agent's answer is structured: `Basis:`, `Context:`, `Action:`, `Result:`, `Scope:` lines |
| `Answer status` | script (`agent-proposed` for every agent answer), then a human (`human-approved`, or `human` after rewriting the answer) | `agent-proposed` answers are assumptions downstream until a human approves them; empty on an answered row = `human` (D-048) |
| `Clarification agent notes` | clarification-explorer (its own row), rendered by the script | `[<run>] <verdict> (<reason>): <summary>`, the evidence path, and a final `Next step:` line for a human |
| `Run ID` | script | the run that **created** the row; never changed |

Files in the older 7-column layout (no `Answer status`) are read as is and rewritten in the current layout on the next write.

All agent writes go through `node scripts/clarifications.mjs` (`append`, `set-steps`, `record`, `list`, `status`, `summary`), which locks the file, de-duplicates new questions against existing ones, preserves human edits (Excel BOM/CRLF are fine) and reports clearly if the file is open in Excel. `summary` renders `clarifications-summary.md` from the CSV alone (totals, every row, a `## Needs a human` list built from each unanswered row's `Next step:`, and an `## Awaiting approval` list of agent-proposed answers), so the two never disagree.

The clarification-explorer records a row with `record <p> <m> <ID> --file clarification-evidence/<ID>/outcome.json` (format: `docs/agent-handoffs.md` §2). The script records nothing unless the outcome holds up against the evidence:
- the verdict and reason fit (a reason from the verdict's list; no `needs-full-run` in a full-run);
- every evidence file exists, including `observation.md`, whose `Verdict:` line matches;
- each basis has its capture (`observed`: a capture of this row; `network`: `network-<n>.txt`; `dom`: a snapshot; `documented:S<n>`: a registered source);
- every listed quote, and every "quoted" text in the Result, appears verbatim in a captured text file;
- every created entity is in the ledger for this run.

It then writes the row, appends the outcome's `followUps` as new rows (notes say they wait for the next run), and writes `clarification-evidence/<ID>/record.json`, the proof `orchestration.mjs` checks.

**The clarifications domain** (`orchestration.mjs next <p> clarifications <m>`) explores only the rows open when it started, one at a time. A finished explorer without a valid `record.json` of this run is offered once more, and then the script records the row `blocked (no-valid-record)`. Answered rows are **trusted as is**; `record --requirement-change` is the only way to change one, and it stamps `[<run-id>] updated: incoming requirement changed this behavior` into the notes.

Stage check: with `clarifications.unresolved_policy: stop` (default) every row needs an Answer — a human fills the remaining ones and re-invokes; with `continue-flagged`, unanswered rows are allowed but must carry agent notes. An `agent-proposed` answer counts as answered, so the run goes on; test cases that rely on it are `@assumption` until a human approves it. An unknown `Answer status` value fails the check.

## Ledger

`state/ledger.jsonl`, append-only, one JSON line per event (`schemas/ledger-entry.schema.json`), each tagged with the run id taken from `state/run.json`. An entity is *live* while its `created` event has no later `deleted` event.

```bash
node scripts/ledger.mjs add     <product> --type T --ref R --module M --stage S --agent A [--label --url --note]
                                [--cleanup-endpoint EP-<m>-<n> --cleanup-param P]   # the delete that removes it (D-075)
node scripts/ledger.mjs deleted <product> --type T --ref R --module M --stage S --agent A
node scripts/ledger.mjs owns    <product> --type T --ref R      # exit 0 only if the CURRENT run created it and it is live
node scripts/ledger.mjs owns    <product> --ref R [--ref R2 …]  # the same for any type and any of the refs (D-074)
node scripts/ledger.mjs list    <product> [--live] [--all-runs]
node scripts/ledger.mjs sweep   <product> [--run RUN] [--dry-run]   # HUMAN-ONLY, between runs (D-075)
```

Agents record immediately after creating anything, run `owns` before any delete/cancel/remove, and record `deleted` after. `ref` is the id the product itself uses for the entity, so the run-time guard can match it in a URL.

**Run time (D-074).** In a full-run, the generated UI guard (`fixtures/ui/base.ts`, through `destructiveRefusal` in `utils/shared/ledger.ts`) aborts a destructive request to a product host — any DELETE, or another non-safe method whose path names a destructive action — unless one of its path segments or query values is a live entity of this run (`owns --ref`), and fails the test with `Delete blocked by the ledger guard (D-005)`; triage classifies that as a healable `test-bug` (rule `ledger-guard`). The API side needs no such guard: the generated sender refuses any change to an entity the test did not create, and `api-code.mjs check` keeps raw requests and deletes out of agent code (D-056).

**Leftovers (D-075).** An entity an ended run left live (a crash, an abandoned run, a type without a delete) can't be deleted by a later run. Between runs, a human may run `ledger.mjs sweep` (`make sweep PRODUCT=<p>`) in their own terminal: with no active run, and with the run-config the last run started from in `full-run`, it deletes each live entity whose recorded cleanup recipe names a delete endpoint of the module's catalogue on a product host (with the run-config's credentials, no redirects; 2xx, 404 and 410 count as gone) and records `deleted` (`stage: sweep`, `agent: human-sweep`). Every other leftover is listed for manual cleanup. It needs an interactive terminal and the typed product slug, `--dry-run` sends nothing, and the guard denies it to every tool call.

## Module exploration

`node scripts/explore.mjs state|frontier|ingest-network|build|check|paths <product> <module>` (`scripts/lib/explore.mjs`) owns `modules/<m>/explore/` except the module-explorer's `flows/`, `module-summary.md`, `new-questions.json`, `overlay.json` and `captures/`. The format is in [`agent-handoffs.md`](agent-handoffs.md) §1, and the design is decision D-052. The script never touches the product: the agent acts in the browser and saves its captures, and the script records them.

- **A state machine.** A state is a page template plus a structural fingerprint of its accessibility snapshot (roles and data-free names of controls, headings, dialogs, tabs, alerts; sort, filter, selected option and empty lists; values, counts, record names and refs ignored). `state --via <ST> --action …` records the transition too, including into a known state. Each state records how to reach it.
- **Stable ids** from `explore/registry/` (`scripts/lib/registry.mjs`): `ST-`, `PG-`, `FR-` (frontier items) and `NI-<m>-<n>` (network inventory entries), never renumbered or reused.
- **The frontier ledger.** Every candidate control of every state is explored, derived away by the script (logout, external, out-of-module, duplicate, disabled, not allowed in readonly), excluded in the overlay with one of the agent's cited reasons, or `deferred: budget`. `explore.max_states` (150) and `explore.max_pages` (40) cap new states and pages per module.
- **The question audit.** Every active knowledge open point (`KQ-<m>-<n>`, `KQ-product-<n>`) is observed (a state or `observation:` evidence), asked (a CSV id) or dismissed (a reason); every untried input has a question or a reason; every question in `new-questions.json` is in the CSV (`clarifications.mjs` stays the only CSV writer).
- **The network inventory** keeps method, host, path template and key names only; the raw capture is deleted after `ingest-network` reads it.
- **Verified.** A passing `check` stamps `coverage.json`; the `explore` stage's done refuses a missing or stale stamp. Entities the run created while exploring and left live are reported, not a failure (D-005 limits deletes, it does not require them).

## API endpoint catalogue

`node scripts/endpoints.mjs find-spec|introspect|build|probe|check <product> <module>` (`scripts/lib/{endpoints,openapi,graphql,probe,api-discovery}.mjs`) owns `modules/<m>/api/` except `overlay.json`. The format is in [`agent-handoffs.md`](agent-handoffs.md) §4, and the design is decision D-045. The catalogue is built by its own module stage, `api-discovery` (`api-discoverer`, started by the orchestrator, D-067), whenever a chosen step needs it: `@api` or `@performance` test cases, the Playwright API tests or k6.

- **Stable ids.** Ids come from `registry.json`: one `EP-<m>-<n>` per endpoint key, never renumbered or reused. An inventory input is cited by its `NI-<m>-<n>` id (`explore/network-inventory.json#NI-…`); an older inventory without ids by its index.
- **Coverage.** `build` fails unless every input appears exactly once in `coverage.json`, either mapped or excluded with a reason code. The inputs are spec operations, GraphQL root fields, inventory entries and docs endpoints.
- **Overlay.** The agent's `overlay.json` is schema-validated before `build` uses it.
- **Network requests** from the script are guarded GETs (`scripts/lib/probe.mjs`):
  - only to the product's hosts (`target.url` + `target.api_urls`);
  - no side-effect paths or action parameters;
  - ids only from list responses already received, never guessed;
  - a per-module budget, a delay, and `Retry-After` honored;
  - redirects are not followed;
  - only shapes are recorded.
- **Credentials.** The run's `session_state_file` cookies and `api.auth_header` (a variable name in `credentials_file`) are read by path. They are sent only to the product's hosts and never printed or written.
- **An empty catalogue** says `empty` or `blocked` (with `blockedReason`), and `orchestration.mjs next` reports which.

## API test plan

`node scripts/api-plan.mjs build|check <product> <module>` (`scripts/lib/api-plan.mjs`) owns the plan files in `modules/<m>/api/`: `plan.json`, `plan-coverage.json`, `plan-registry.json` and `api-test-plan.md`. The only exception is `plan-overlay.json`, which belongs to the api-test-planner. The format is in [`agent-handoffs.md`](agent-handoffs.md) §4, and the design is decision D-046. The script never sends a request to the product.

- **Scenarios.** A fixed rule catalogue enumerates them from the catalogue:
  - partitions and 2-value boundaries per spec constraint, one fault per negative;
  - authentication per security scheme;
  - object-, property- and function-level authorization;
  - CRUD flows over the links;
  - HTTP semantics, GraphQL-over-HTTP, and drift contracts.

  Endpoints that share a request schema get field negatives once. `api.plan_budget` caps the plan, and the lowest-priority boundary and HTTP scenarios go first. Their coverage items are `deferred` (reason `budget`), never dropped (D-050).
- **Stable ids.** `plan-registry.json` holds one `API-<m>-<n>` per scenario key (`<endpoint key>|<rule>|<target>`), never renumbered or reused.
- **Expectations** each name a source: `spec`, `observed`, `rfc9110`, `graphql-over-http`, a citation (`clarification:`, `testcase:`, `knowledge:`), or `class-only`. A class-only status raises one clarification question per fault class, through `clarifications.mjs`'s library.
- **Coverage.** Every coverage item ends up mapped to scenario ids, excluded with a reason code, deferred over the budget, or pending. The items are operations, parameter and field constraints, documented statuses, security schemes, flows, drift findings, `@api` test cases and answered questions. `check` fails while anything is pending; deferred items count as resolved, and `check` reports how many there are.
- **Verified.** When `check` passes, it stamps `verified` (the sha256 of the plan and the catalogue) into `plan-coverage.json`. `orchestration.mjs next` fails the plan step when that stamp is missing or stale.
- **Safety.** Anything that can change data is `mutates: true` and `requires: [full-run]`. Its path ids come only from a create in the same run (D-005). It names its cleanup endpoint, or is flagged `leavesData`. Scenarios that need another user get `requires: [identity:<name>]` from `authorizations.identities`, which holds paths only (D-012).

## Test cases

`node scripts/testcases.mjs` (`scripts/lib/testcases.mjs`) owns `modules/<m>/testcases/` (format: [`agent-handoffs.md`](agent-handoffs.md) §3; decision D-053):

| File | Owner |
|---|---|
| `cases.json` | testcase-writer (its only file; in import mode it also holds the converted cases and the `links` of imported UI cases to exploration states) |
| `imported.json` (schema `testcases-imported`) | the script: `testcases.mjs import` parses the human's own file in a framework format (D-066) |
| `approval.csv` | **human only**: rendered by `build`, filled in Excel or an editor |
| `approvals.json` | **human only**, through `node scripts/testcases.mjs approve <product> <module>` (or `import <product> <module> --approved` for a file already approved) in an interactive terminal (the slug typed to confirm) |
| `coverage.json`, `registry/{items,cases}.json`, `<m>-testcases.<ext>`, `testcases-summary.md`, `approval-findings.md` | the script |
| `results/<run>/<m>/testcases/review.json` | testcase-reviewer; `review-findings.md` beside it is rendered by `review-check` (a managed file since D-059: no agent writes it) |

The guard denies `testcases.mjs approve` and any write to `approval.csv` or `approvals.json` for every tool call it sees, on every host and in every mode, inside or outside a run. Only approved cases are automated: the Playwright gates trace approved cases only (a test for an unapproved case must be absent or `test.fixme` "awaiting approval"), and the API plan's `testcase:` items cover approved `@api` cases only.

## Foundations

`node scripts/foundation.mjs render|check|install|paths <product> [--side repo|ui|api|k6]` (`scripts/lib/foundation.mjs`) renders the fixed files of `playwright-tests/<product>/` (sides `repo`, `ui`, `api`) and `k6-tests/<product>/` (side `k6`) from the framework's `templates/`, with each side's cited overlay in `artifacts/<product>/foundation/`. The formats are in [`agent-handoffs.md`](agent-handoffs.md) §10, and the design is decision D-054.

- **Managed files** carry a "Generated by scripts/foundation.mjs — do not edit" header; JSON files are listed in `.foundation-managed.json`. They are listed in `config/permissions.yaml` `managed_files`, and during a run the guard denies every caller, named or not, a direct write (any spelling of the path: case, trailing dots, streams, short names). Templates are LF-only, so a render is the same bytes on every OS. Rendering is deterministic.
- **Dependencies** are named without a version; `install` runs `npm install`, and `package-lock.json` pins what it resolved. A re-render keeps the versions in `package.json` and never bumps one; the drift check ignores those versions and the lockfile.
- **Extension files** (`helpers/<side>/`, `lib/ext/`) are hand-written. `fixtures/<side>/index.ts` is generated from the module registrations (D-056) and managed.
- **Verified.** A passing `check` (static rules plus `tsc`, `playwright test --list` or `k6 inspect`) stamps `<side>-manifest.json` over the overlay, the templates, the run-config inputs and every managed file; a failing one clears it. The `playwright-repo` stage, and the UI, API and k6 flows' foundation steps, refuse a missing or stale stamp, and skip the step while it is current. The gate also flags drift between renders.

## UI code

`node scripts/ui-code.mjs build|check|paths <product> <module> [--pages] [--static]` (`scripts/lib/ui-code.mjs`) scaffolds a module's UI test code from the cases a human approved and the exploration's page templates (format: [`agent-handoffs.md`](agent-handoffs.md) §11; design: [`playwright-conventions.md`](playwright-conventions.md) and decision D-055). It never touches the product.

| File | Owner |
|---|---|
| `modules/<m>/ui-code/plan.json` (schema `ui-code-plan`): the required tests and page objects | the script |
| `modules/<m>/ui-code/coverage.json` (schema `ui-code-coverage`): the ledger, the build's input digests, the `verified` stamps (`pages`, `tests`) | the script |
| `modules/<m>/ui-code/parked.json` (schema `ui-code-parked`): step bodies of tests no longer generated | the script |
| `playwright-tests/<p>/tests/ui/<m>/cases.spec.ts` outside its marked regions; `tests/ui/<m>/_locators.smoke.spec.ts`; `fixtures/ui/pages/<m>.ts` | the script |
| the marked regions of `cases.spec.ts`; `helpers/ui/<m>.data.ts` | pw-ui-tests-writer |
| `pages/<m>/**` (shells seeded once by the script) | pw-ui-pom-writer |
| `fixtures/ui/index.ts` (and `fixtures/api/index.ts`): every module's registration spread on `./base`, generated and managed (D-056) | `foundation.mjs` `renderIndex`, written by the scripts |

- **Only approved cases** (D-053) get a test; unapproved ones are reported as awaiting approval, `@api` ones belong to the API side, and approved ones over `testcases.max_cases` are `deferred: budget`.
- **Verified.** A passing `check --pages` stamps `verified.pages`; a passing full `check` (every gate rule, `tsc` and `playwright --list`) stamps both. The `playwright-ui` flow's `pages` and `tests` steps refuse a missing or stale stamp when they are first seen done; from then on the gate re-checks every rule each review round. `--static` skips the compile commands and stamps nothing. A build whose inputs (the cases, the approvals, the model, the flows, the run-config) changed is stale until rebuilt.

## API code

`node scripts/api-code.mjs build|check|paths <product> <module> [--clients] [--static]` (`scripts/lib/api-code.mjs`) generates a module's Playwright API code from the endpoint catalogue and the verified API plan (format: [`agent-handoffs.md`](agent-handoffs.md) §12; design: [`playwright-conventions.md`](playwright-conventions.md) and decision D-056). It never sends a request to the product.

| File | Owner |
|---|---|
| `modules/<m>/api-code/plan.json` (schema `api-code-plan`): the clients, the tests, the payload and glue slots | the script |
| `modules/<m>/api-code/coverage.json` (schema `api-code-coverage`): the ledger, the build's input digests, the `verified` stamps (`clients`, `tests`) | the script |
| `modules/<m>/api-code/parked.json` (schema `api-code-parked`): slot bodies no longer generated | the script |
| `playwright-tests/<p>/clients/<m>/**`, `config/api/schemas/<m>/**`, `fixtures/api/clients/<m>.ts`, `tests/api/<m>/**`: managed (`config/permissions.yaml` `managed_files`), never written by an agent | the script |
| `helpers/api/<m>.payloads.ts` and `helpers/api/<m>.glue.ts` outside their slots | the script |
| their slots; `modules/<m>/api-code/tests-overlay.json` (schema `api-code-tests-overlay`) | pw-api-tests-writer |
| `modules/<m>/api-code/client-overlay.json` (schema `api-code-client-overlay`); `helpers/api/<m>.composite.ts` (seeded once) | pw-api-client-writer |
| `modules/<m>/api-code/legacy/**`: what `build --adopt` moved out of the generated folders | the script |

- **Only planned scenarios** get a test, one each; the plan holds only approved test cases (D-053). Blocked and parked scenarios are `test.fixme` with the reason; the plan's coverage items over its budget are `deferred: budget` in the ledger.
- **Verified.** A passing `check --clients` stamps `verified.clients`; a passing full `check` (every rule and gate rule, `tsc` and `playwright --list`) stamps both. The `playwright-api` flow's `clients` and `tests` steps refuse a missing or stale stamp when they are first seen done; from then on the gate re-checks every rule each review round. `--static` skips the compile commands and stamps nothing. A build whose inputs (the catalogue, the plan, the test cases, the approvals, an overlay, the run-config) changed is stale until rebuilt, and `check` fails while the plan is not verified.

## k6 workload and scripts

`node scripts/workload.mjs build|check|paths <product> <module> [--run <run-id>]` (`scripts/lib/workload.mjs`) builds a module's load workload from its human-approved `@performance` test cases only, one load unit per case, and `node scripts/k6-code.mjs build [--adopt]|check|paths <product> <module>` (`scripts/lib/k6-code.mjs`) generates its k6 scripts from the verified workload (formats: [`agent-handoffs.md`](agent-handoffs.md) §5; design: [`k6-conventions.md`](k6-conventions.md) and decision D-068). Neither sends a request to the product or runs load.

| File | Owner |
|---|---|
| `modules/<m>/k6/workload.json` (schema `workload`): the scenarios, their sizing, thresholds and exact k6 `options` | the script (workload.mjs) |
| `modules/<m>/k6/workload-coverage.json` (schema `workload-coverage`): the ledger over every approved `@performance` case (loaded, excluded with a reason, `deferred: budget`), the input digests, the `verified` stamp | the script (workload.mjs) |
| `modules/<m>/k6/workload-registry.json`: the stable `K6-<m>-<n>` ids | the script (workload.mjs) |
| `modules/<m>/k6/workload-overlay.json` (schema `workload-overlay`): cited priorities, mixes, think time, data needs, exclusions, write flows | k6-workload-designer |
| `modules/<m>/k6/code-plan.json` (schema `k6-code-plan`): the scripts, their requests, the slots, the `verified` stamp | the script (k6-code.mjs) |
| `modules/<m>/k6/parked.json` (schema `k6-code-parked`): slot bodies no longer generated | the script (k6-code.mjs) |
| `modules/<m>/k6/legacy/**`: hand-written scripts `build --adopt` moved out of `scripts/` | the script (k6-code.mjs) |
| `k6-tests/<p>/scripts/<m>-*.js`: one generated script per scenario | the script (k6-code.mjs) |
| `k6-tests/<p>/scripts/slots/<m>.js` outside its slots / inside them | the script / k6-script-writer |

- **Managed.** The script-owned files above are in `config/permissions.yaml` `managed_files`: during a run the guard denies every caller a direct write.
- **Verified.** A passing `workload.mjs check` stamps `workload-coverage.json`; a passing `k6-code.mjs check` stamps `code-plan.json` (over the workload, its coverage, the catalogue, the plan, the k6 overlay, the slots and every script). The k6 flow's `workload` and `scripts` steps refuse a missing or stale stamp, and the k6 gate requires the scripts' stamp to be current on every review round.

## Review and fix

`node scripts/review.mjs check|render|paths <product> <module> <domain>` and `node scripts/fix.mjs snapshot|check|paths <product> <module> <domain>` (`scripts/lib/review.mjs`, `scripts/lib/fix.mjs`, D-059; `<domain>` = `playwright-ui`, `playwright-api` or `k6`). The formats are in [`agent-handoffs.md`](agent-handoffs.md) §6, the rubric in [`conventions.md`](conventions.md).

| File (`results/<run>/<m>/<domain>/`) | Owner |
|---|---|
| `review.json` (schema `review`): a rubric verdict per test | the code reviewer (its only file) |
| `review-findings.md`, rendered from `review.json` with the derived verdict | the script (review.mjs) |
| `review-check.json`: the stamp (round, verdict, counts, hashes of `review.json`, the plan and every code file) | the script (review.mjs) |
| `fix-report.json` (schema `fix-report`): one entry per blocker, major or healable row | the fixer |
| `fix-snapshot.json`: file hashes taken before the fix or heal round | the script (orchestration.mjs next) |

- **Managed.** `review-check.json`, `fix-snapshot.json` and `review-findings.md` are in `managed_files`: no agent writes them. The reviewers run only `review.mjs check`, and write only `review.json`; the fixers run `fix.mjs check` (never `snapshot`).
- **Verified.** `review.mjs check` refuses a test not reviewed in this round or code newer than `review.json`; the orchestration reads the verdict only from a stamp that matches the round, `review.json` and the current code. `fix.mjs check` runs when a fix or heal step is done; a failure fails the step.

## Triage

`node scripts/triage.mjs prepare|build|check|paths <product> <module> --domain ui|api|k6` (`scripts/lib/triage.mjs`, D-058) triages a run's results. The format, the classes and the rules are in [`agent-handoffs.md`](agent-handoffs.md) §7.

| File | Owner |
|---|---|
| `results/<run>/<m>/<framework>/results.json` (schema `results`), with ids, attempts and `passedOnRetry` | the script (results.mjs) |
| `results/<run>/<m>/<framework>/triage.json` (schema `triage`) and the rendered `triage.md` | the script (triage.mjs) |
| `results/<run>/<m>/<framework>/triage-overlay.json` (schema `triage-overlay`): classes, fix hints, bug drafts | the runner-triager |
| `modules/<m>/triage/triage-registry.json`: the stable `BUG-<m>-<n>` ids, keyed by domain and signature | the script (triage.mjs) |
| `known-issues.json` (schema `known-issues`) | a human only |

- **`prepare`** clears the module's stale output before a run: k6 `results/<m>-*.{summary,created,untracked}.json` (another module's files, even of a longer name, are left alone) and the module's `test-results/<side>/<m>/` and `<m>-report.json` (the run passes `--output=test-results/<side>/<m>`, so other modules' evidence stays). It removes only paths the triager may already write.
- **Managed.** `results.json`, `triage.json`, `triage.md`, the registry and `known-issues.json` are in `managed_files`: no agent writes them.
- **Verified.** A passing `check` stamps `triage.json` (over the results, the overlay and `known-issues.json`). `orchestration.mjs next` fails the run step while the stamp is missing or stale, so a heal round never starts from an unverified triage. `report-data.mjs` carries the class counts and the product-bug clusters.

## Report

`node scripts/report-data.mjs <product>` collects `results/<run>/report/report.json` (schema `report`, D-061): totals, per-module rows, bug drafts by cluster, the human queues (test cases awaiting approval with their sign-off sheet path, clarifications awaiting approval or an answer), coverage per ledger and technique with everything deferred or excluded, assumptions (assumed k6 thresholds, `@assumption` cases, agent-captured or stale rule facts, the D-052 known limits, k6 leftovers), failed, blocked and awaiting-approval stages, and `missing[]` for data that could not be collected. `node scripts/report.mjs render|check|paths <product>` (`scripts/lib/report.mjs`, templates in `templates/report/`) works from the run state alone.
- **Files.** `report.json` (report-data), `narrative.json` (the report-generator, its only output; schema `report-narrative`: `executiveSummary`, `risks` with a severity, `recommendations`, each statement `{text, cites[]}` with at least one cite), `index.html` and `report-check.json` (scripts). `report.json`, `index.html` and the stamp are managed files: no agent writes them.
- **Render.** One self-contained, deterministic file (no network, no CDN; light and dark; inline SVG charts) from `templates/report/{deck.html,deck.css,deck.js}`: every number, table and chart comes from `report.json`.
- **Check.** `narrative.json` is schema-valid, every cited path exists in `report.json`, every number in a statement equals a number at a cited path (or an array length), and `index.html` equals what `render` makes of the two. A pass stamps `report-check.json` over all three; a failure removes the stamp. The `report` stage's `done` refuses a missing or stale stamp (`reportUnverified`), so a failed or stale report is retried like any stage (D-011).
- **Counting.** A module's k6 scripts are the `<module>-<scenario>.js` files of the scenarios in its `workload.json` (a module `deals` never counts `deals-pipeline-*`); a module is explored only with a non-empty sitemap.

## Safety: mode × permissions, enforced in code

- **Mode** — `authorizations.mode` → `state/run.json`. `readonly` caps every agent at read (browser/http) and none (load), whatever the permissions file says; `full-run` applies `config/permissions.yaml` as written, and gives every agent that has browser access (`read` or `mutate`) the full browser. `AUTHORIZATIONS_MODE=readonly` in the environment can downgrade; nothing can upgrade.
- **Hosts** — every host runs `scripts/hooks/pretooluse.mjs`, whose adapter (`scripts/hooks/hosts/`) turns the host's payload into a canonical tool call (`scripts/lib/tool-call.mjs`). The calling agent comes only from a trusted source: Claude Code's `agent_type`, or the `--agent` the build bakes into each generated Copilot agent's own hook (VS Code). Some hosts cannot identify agents (`scripts/lib/hosts.mjs`): Copilot CLI, VS Code chat on its Copilot CLI engine, the cloud coding agent, and any unrecognized host.
  - In a full-run, a call there gets the run's combined ceiling: what at least one agent of the run may do (`runCeiling` in `scripts/lib/permissions.mjs`). The run's agents are the layer-0 agents and everything they can spawn.
  - In a readonly run, a call there gets the mode rules.
- **Per-agent permissions** — the guard (`scripts/lib/guard.mjs`) applies the calling agent's row from the frozen permissions (tool names below are the canonical kinds; each adapter maps its host's tools onto them):
  - spawn — only the agents in `spawns`;
  - shell — `shell: none | restricted (shell_allow) | project`, then HTTP/k6 rules by effective `http`/`load`, and any DELETE must reference a live entity of the current run;
  - write (every file the call touches) — only inside `filesystem.write` (`${product}`, `${run_id}` expanded; `${module}` = one path segment); nothing outside the repo; never a `managed_files` path (a foundation file rendered from templates, D-054);
  - web fetch / web search — the product's own hosts (`target.url` and `target.api_urls`) need `http: read`; anything else needs `web_research: allowed`;
  - Playwright MCP — `browser: none` blocks all; effective `read` (i.e. in readonly runs) blocks typing, form filling, selects, uploads, drag/drop, key presses, dialogs and script evaluation (clicks stay allowed for navigation); in full-run runs any browser access is full.
- **Active runs** are found from `artifacts/*/state/lock.json`. No active run ⇒ readonly shell rules only. Agents not in the permissions file (e.g. a human's own session) get the mode rules only. During a run, a tool an adapter cannot classify is denied for a managed agent. If the guard itself errors (or cannot read the hook input) while a run is active, the hook fails closed.
- **Design decisions** — separately from safety, the same hook asks the user before an edit to a file that an Accepted decision in [`decisions.md`](decisions.md) governs (`scripts/lib/decisions.mjs`); deny beats ask beats allow.
- **Known limits** — a `shell: project` agent could still write files or call the network through a script the guard can't parse; Playwright `mutationGuard` fixtures and k6 host allow-lists (built in their domains) are the second layer.

## Schemas

`schemas/{run,lock,ledger-entry,sitemap,explore-model,explore-coverage,explore-overlay,interactions,network-inventory,sources,knowledge-coverage,knowledge-open-points,knowledge-source-cache,knowledge-rule-facts,results,scenarios,testcases-imported,discovered-endpoints,api-coverage,api-overlay,foundation-repo-overlay,foundation-ui-overlay,foundation-api-overlay,foundation-k6-overlay,foundation-manifest,ui-code-plan,ui-code-coverage,ui-code-parked,api-code-plan,api-code-coverage,api-code-parked,api-code-client-overlay,api-code-tests-overlay,workload,workload-coverage,workload-overlay,k6-code-plan,k6-code-parked,triage,triage-overlay,known-issues,review,fix-report,report,report-narrative}.schema.json` (JSON Schema 2020-12, Ajv). `LAYOUT_VERSION` in `scripts/lib/contract.mjs` is bumped only on incompatible layout changes: a bump makes `run.mjs validate` reject every existing `run.json`, so a compatible change (a new optional key, a new stage, a schema that still accepts older files) keeps it and says in its decision what an older run does on resume (D-066).
