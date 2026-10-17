# Artifact contract — layout v2 (implemented: foundation)

The single definition of where things live, how stages hand off, and how state and safety work. It is implemented in code — `scripts/lib/{contract,clarifications,ledger,permissions,guard,csv,endpoints}.mjs` and the CLIs `scripts/{run,clarifications,ledger,run-config,endpoints}.mjs` — and validated by JSON Schemas in `schemas/`. Agent prompts must never contradict this file; when they differ, this file and the scripts win. The agent roster and responsibilities are in [`agent-architecture.md`](agent-architecture.md).

## Layout: everything is product-level

```
artifacts/<product>/                  # git-ignored; accumulates across runs
  knowledge/                          # knowledge-generator: reusable, cited product knowledge (see below)
    overview.md glossary.md           # the agent's (product pass)
    sources.md sources.json inputs.json coverage.json open-points.json   # knowledge.mjs
    sources/S<n>.txt sources/index.json   # knowledge.mjs snapshot: cached source text for quote checks
    captures/                         # the agent's captures of pages the script can't fetch
    modules/<module>/{overview,glossary,notes}.md                 # the agent's (module pass)
    modules/<module>/{sources.md,coverage.json,open-points.json,rule-facts.json}   # knowledge.mjs
  modules/<module>/                   # latest working state, overwritten by later runs
    explore/                          # sitemap.json, module-summary.md, pages/, flows/, interactions + network inventory
    clarifications.csv                # product-level clarifications (format below)
    clarification-evidence/<ID>/      # what the clarification-explorer observed per row
    clarifications-summary.md
    testcases/   api/   k6/           # domain working files
    api/                              # endpoints.mjs: discovered-endpoints.json coverage.json drift.json registry.json sources/;
                                      # overlay.json is the api-discoverer's (see below)
                                      # api-plan.mjs: plan.json plan-coverage.json plan-registry.json api-test-plan.md;
                                      # plan-overlay.json is the api-test-planner's
  state/
    run.json                          # the current (or last) run: id, mode, modules, stage status
    lock.json                         # present only while a run is active -- one active run per product
    ledger.jsonl                      # entities created in the target, every entry tagged with runId
    config.resolved.json              # the validated run-config the current run started from
    permissions.resolved.json         # frozen copy of config/permissions.yaml for the current run
    orchestration/<domain>-<module>.json   # domain orchestrators' loop counters (review/heal rounds)
    guard-check/                      # guard liveness records for the current session (run.mjs guard-check)
    history/<run-id>.json             # summary of every ended run
  results/<run-id>/                   # per-run archive: <module>/{testcases,playwright-ui,playwright-api,k6}/..., report/
playwright-tests/<product>/           # ONE Playwright repo: tests/ui + tests/api
k6-tests/<product>/
```

There is no `artifacts/<run-id>/` directory. Run ids are `<product>-<YYYYMMDD>-<HHmm>` (suffixed `-2`, `-3`… if reused).

## Runs

```bash
node scripts/run.mjs init config/<product>.yaml [--resume]   # validate config + permissions, take the lock, write state/
node scripts/run.mjs guard-check <product>                   # liveness canary: a working guard BLOCKS this
node scripts/run.mjs next <product>                          # stages ready to run (dependencies complete)
node scripts/run.mjs stage <product> <stage> start|done|fail [--module M] [--error MSG]
node scripts/run.mjs status <product>                        # every stage with output verification
node scripts/run.mjs end <product> [--abandon]               # history/<run-id>.json, release the lock
node scripts/run.mjs validate <product>                      # schema-check state, ledger, sitemaps, CSVs
```

- `init` refuses while another run holds the product's lock (`--resume` returns the active run; `end --abandon` releases it).
- `config/permissions.yaml` is validated and frozen into `state/permissions.resolved.json` at `init`; edits take effect on the next run.
- `init` records `startedOnHost`.
- Guard liveness: `init` and `--resume` clear `state/guard-check/`; the orchestrator then runs `run.mjs guard-check <product>`, which every working hook blocks — the hook entry records the blocking host/agent there; if the command runs instead, it records `absent.json`. `stage … start` refuses until a record fits the mode. Any hook's record counts, with one exception: a full-run on VS Code's local agent needs a record from an agent's own hook.

### Stages (the main orchestrator's view — one per domain)

| Stage | Scope | Needs | Declared outputs (verified on `done`) |
|---|---|---|---|
| `knowledge` | product | — | `knowledge/{overview,glossary,sources}.md`, `sources.json`, `coverage.json`, `open-points.json` (schemas) — every knowledge check passes and the verified stamp is current |
| `module-knowledge` | module | knowledge | `knowledge/modules/<m>/{overview,glossary,notes,sources}.md`, `coverage.json`, `open-points.json`, `rule-facts.json` (schemas) — every knowledge, glossary-merge and sources check passes and the verified stamp is current |
| `playwright-repo` | product | — | `playwright-tests/<product>/package.json`, `playwright.config.ts` |
| `explore` | module | module-knowledge | `modules/<m>/explore/sitemap.json` (schema), `module-summary.md` |
| `clarifications` | module | explore | `modules/<m>/clarifications.csv` (check below), `clarifications-summary.md` |
| `testcases` | module | clarifications | `modules/<m>/testcases/<m>-testcases.<ext>` + `testcases-summary.md` — `Total test cases: N` must equal the cases in the file |
| `playwright-ui` | module | testcases, playwright-repo | `results/<run>/<m>/playwright-ui/results.json` (schema `results`, written by `results.mjs`) |
| `playwright-api` | module | testcases, playwright-repo | `results/<run>/<m>/playwright-api/results.json` (schema `results`) |
| `k6` | module | playwright-api | `results/<run>/<m>/k6/results.json` (schema `results`; `not-run` in readonly runs) |
| `report` | product | every other stage complete, exhausted or blocked | `results/<run>/report/report.json` (by `report-data.mjs`) + `index.html` |

A stage is complete only if `run.json` marks it `done` **and** every declared output exists, is non-empty and passes its schema or check; `done` is refused otherwise, and a stage whose outputs later disappear is offered again by `next`. Sub-steps inside a domain (build steps, gate → reviewer → fixer, runner-triager → fixer) belong to the domain orchestrator, not this table: it follows `node scripts/orchestration.mjs next <product> <domain> <module>`, which reads the domain's flow from `scripts/lib/domain-flows.mjs` and the files on disk, runs the script steps itself (the pre-review gate, the clarification summary), and spends the bounded review and heal rounds.

Each stage gets at most **two attempts** per run (`attempts` in `run.json`); a stage that failed twice is *exhausted*, everything depending on it is *blocked*, and `next` no longer offers either — so the report still becomes ready and states what did not run.

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
node scripts/ledger.mjs deleted <product> --type T --ref R --module M --stage S --agent A
node scripts/ledger.mjs owns    <product> --type T --ref R      # exit 0 only if the CURRENT run created it and it is live
node scripts/ledger.mjs list    <product> [--live] [--all-runs]
```

Agents record immediately after creating anything, run `owns` before any delete/cancel/remove, and record `deleted` after.

## API endpoint catalogue

`node scripts/endpoints.mjs find-spec|introspect|build|probe|check <product> <module>` (`scripts/lib/{endpoints,openapi,graphql,probe,api-discovery}.mjs`) owns `modules/<m>/api/` except `overlay.json`. The format is in [`agent-handoffs.md`](agent-handoffs.md) §4, and the design is decision D-045.

- **Stable ids.** Ids come from `registry.json`: one `EP-<m>-<n>` per endpoint key, never renumbered or reused.
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

## Safety: mode × permissions, enforced in code

- **Mode** — `authorizations.mode` → `state/run.json`. `readonly` caps every agent at read (browser/http) and none (load), whatever the permissions file says; `full-run` applies `config/permissions.yaml` as written, and gives every agent that has browser access (`read` or `mutate`) the full browser. `AUTHORIZATIONS_MODE=readonly` in the environment can downgrade; nothing can upgrade.
- **Hosts** — every host runs `scripts/hooks/pretooluse.mjs`, whose adapter (`scripts/hooks/hosts/`) turns the host's payload into a canonical tool call (`scripts/lib/tool-call.mjs`). The calling agent comes only from a trusted source: Claude Code's `agent_type`, or the `--agent` the build bakes into each generated Copilot agent's own hook (VS Code). Some hosts cannot identify agents (`scripts/lib/hosts.mjs`): Copilot CLI, VS Code chat on its Copilot CLI engine, the cloud coding agent, and any unrecognized host.
  - In a full-run, a call there gets the run's combined ceiling: what at least one agent of the run may do (`runCeiling` in `scripts/lib/permissions.mjs`). The run's agents are the layer-0 agents and everything they can spawn.
  - In a readonly run, a call there gets the mode rules.
- **Per-agent permissions** — the guard (`scripts/lib/guard.mjs`) applies the calling agent's row from the frozen permissions (tool names below are the canonical kinds; each adapter maps its host's tools onto them):
  - spawn — only the agents in `spawns`;
  - shell — `shell: none | restricted (shell_allow) | project`, then HTTP/k6 rules by effective `http`/`load`, and any DELETE must reference a live entity of the current run;
  - write (every file the call touches) — only inside `filesystem.write` (`${product}`, `${run_id}` expanded; `${module}` = one path segment); nothing outside the repo;
  - web fetch / web search — the product's own hosts (`target.url` and `target.api_urls`) need `http: read`; anything else needs `web_research: allowed`;
  - Playwright MCP — `browser: none` blocks all; effective `read` (i.e. in readonly runs) blocks typing, form filling, selects, uploads, drag/drop, key presses, dialogs and script evaluation (clicks stay allowed for navigation); in full-run runs any browser access is full.
- **Active runs** are found from `artifacts/*/state/lock.json`. No active run ⇒ readonly shell rules only. Agents not in the permissions file (e.g. a human's own session) get the mode rules only. During a run, a tool an adapter cannot classify is denied for a managed agent. If the guard itself errors (or cannot read the hook input) while a run is active, the hook fails closed.
- **Design decisions** — separately from safety, the same hook asks the user before an edit to a file that an Accepted decision in [`decisions.md`](decisions.md) governs (`scripts/lib/decisions.mjs`); deny beats ask beats allow.
- **Known limits** — a `shell: project` agent could still write files or call the network through a script the guard can't parse; Playwright `mutationGuard` fixtures and k6 host allow-lists (built in their domains) are the second layer.

## Schemas

`schemas/{run,lock,ledger-entry,sitemap,sources,knowledge-coverage,knowledge-open-points,knowledge-source-cache,knowledge-rule-facts,results,discovered-endpoints,api-coverage,api-overlay}.schema.json` (JSON Schema 2020-12, Ajv). Changing the layout, a schema or the stage table bumps `LAYOUT_VERSION` in `scripts/lib/contract.mjs`.
