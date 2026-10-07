# Artifact contract — layout v2 (implemented: foundation)

The single definition of where things live, how stages hand off, and how state and safety work. It is implemented in code — `scripts/lib/{contract,clarifications,ledger,permissions,guard,csv}.mjs` and the CLIs `scripts/{run,clarifications,ledger,run-config}.mjs` — and validated by JSON Schemas in `schemas/`. Agent prompts must never contradict this file; when they differ, this file and the scripts win. The agent roster and responsibilities are in [`agent-architecture.md`](agent-architecture.md).

## Layout: everything is product-level

```
artifacts/<product>/                  # git-ignored; accumulates across runs
  knowledge/                          # knowledge-generator: reusable product knowledge
  modules/<module>/                   # latest working state, overwritten by later runs
    explore/                          # sitemap.json, module-summary.md, pages/, flows/, interactions + network inventory
    clarifications.csv                # product-level clarifications (format below)
    clarification-evidence/<ID>/      # what the clarification-explorer observed per row
    clarifications-summary.md
    testcases/   api/   k6/           # domain working files
  state/
    run.json                          # the current (or last) run: id, mode, modules, stage status
    lock.json                         # present only while a run is active -- one active run per product
    ledger.jsonl                      # entities created in the target, every entry tagged with runId
    config.resolved.json              # the validated run-config the current run started from
    permissions.resolved.json         # frozen copy of config/permissions.yaml for the current run
    orchestration/<domain>-<module>.json   # domain orchestrators' loop counters (review/heal rounds)
    history/<run-id>.json             # summary of every ended run
  results/<run-id>/                   # per-run archive: <module>/{testcases,playwright-ui,playwright-api,k6}/..., report/
playwright-tests/<product>/           # ONE Playwright repo: tests/ui + tests/api
k6-tests/<product>/
```

There is no `artifacts/<run-id>/` directory. Run ids are `<product>-<YYYYMMDD>-<HHmm>` (suffixed `-2`, `-3`… if reused).

## Runs

```bash
node scripts/run.mjs init config/<product>.yaml [--resume]   # validate config + permissions, take the lock, write state/
node scripts/run.mjs next <product>                          # stages ready to run (dependencies complete)
node scripts/run.mjs stage <product> <stage> start|done|fail [--module M] [--error MSG]
node scripts/run.mjs status <product>                        # every stage with output verification
node scripts/run.mjs end <product> [--abandon]               # history/<run-id>.json, release the lock
node scripts/run.mjs validate <product>                      # schema-check state, ledger, sitemaps, CSVs
```

- `init` refuses while another run holds the product's lock (`--resume` returns the active run; `end --abandon` releases it).
- `config/permissions.yaml` is validated and frozen into `state/permissions.resolved.json` at `init`; edits take effect on the next run.

### Stages (the main orchestrator's view — one per domain)

| Stage | Scope | Needs | Declared outputs (verified on `done`) |
|---|---|---|---|
| `knowledge` | product | — | `knowledge/index.md` *(provisional)* |
| `playwright-repo` | product | — | `playwright-tests/<product>/package.json`, `playwright.config.ts` |
| `explore` | module | knowledge | `modules/<m>/explore/sitemap.json` (schema), `module-summary.md` |
| `clarifications` | module | explore | `modules/<m>/clarifications.csv` (check below), `clarifications-summary.md` |
| `testcases` | module | clarifications | `modules/<m>/testcases/testcases-summary.md` *(provisional)* |
| `playwright-ui` | module | testcases, playwright-repo | `results/<run>/<m>/playwright-ui/results.json` *(provisional)* |
| `playwright-api` | module | testcases, playwright-repo | `results/<run>/<m>/playwright-api/results.json` *(provisional)* |
| `k6` | module | playwright-api | `results/<run>/<m>/k6/results.json` *(provisional)* |
| `report` | product | every other stage complete or failed | `results/<run>/report/index.html` *(provisional)* |

A stage is complete only if `run.json` marks it `done` **and** every declared output exists, is non-empty and passes its schema or check; `done` is refused otherwise, and a stage whose outputs later disappear is offered again by `next`. *Provisional* outputs are confirmed when that domain is built. Sub-steps inside a domain (writer → reviewer → feedback-implementor, runner-triager → healer) belong to the domain orchestrator, not this table.

## `clarifications.csv`

`artifacts/<product>/modules/<module>/clarifications.csv`, columns in this exact order:

| Column | Written by | Rule |
|---|---|---|
| `ID` | script | `<module>-<n>`, per-module sequence, never reused |
| `Module` | script | module slug |
| `Question` | module-explorer (new rows), question-writer (refines unanswered rows) | |
| `Steps to execute` | same | detailed, human-readable, followable by someone who has never seen the product |
| `Answer` | clarification-writer, or a human directly in the file | never overwritten once non-empty, except for a requirement change |
| `Clarification agent notes` | clarification-writer | why still unconfirmed, what was tried, evidence path |
| `Run ID` | script | the run that **created** the row; never changed |

All agent writes go through `node scripts/clarifications.mjs` (`append`, `set-steps`, `record`, `list`, `status`), which locks the file, de-duplicates new questions against existing ones, preserves human edits (Excel BOM/CRLF are fine) and reports clearly if the file is open in Excel. Answered rows are **trusted as is**; `record --requirement-change` is the only way to change one, and it stamps `[<run-id>] updated: incoming requirement changed this behavior` into the notes.

Stage check: with `clarifications.unresolved_policy: stop` (default) every row needs an Answer — a human fills the remaining ones and re-invokes; with `continue-flagged`, unanswered rows are allowed but must carry agent notes.

## Ledger

`state/ledger.jsonl`, append-only, one JSON line per event (`schemas/ledger-entry.schema.json`), each tagged with the run id taken from `state/run.json`. An entity is *live* while its `created` event has no later `deleted` event.

```bash
node scripts/ledger.mjs add     <product> --type T --ref R --module M --stage S --agent A [--label --url --note]
node scripts/ledger.mjs deleted <product> --type T --ref R --module M --stage S --agent A
node scripts/ledger.mjs owns    <product> --type T --ref R      # exit 0 only if the CURRENT run created it and it is live
node scripts/ledger.mjs list    <product> [--live] [--all-runs]
```

Agents record immediately after creating anything, run `owns` before any delete/cancel/remove, and record `deleted` after.

## Safety: mode × permissions, enforced in code

- **Mode** — `authorizations.mode` → `state/run.json`. `readonly` caps every agent at read (browser/http) and none (load), whatever the permissions file says; `full-run` applies `config/permissions.yaml` as written. `AUTHORIZATIONS_MODE=readonly` in the environment can downgrade; nothing can upgrade.
- **Per-agent permissions** — the guard (`scripts/lib/guard.mjs`, Claude Code adapter `.claude/hooks/guard.mjs`) identifies the caller from the hook's `agent_type` and applies its row from the frozen permissions:
  - `Agent` — only the agents in `spawns`;
  - `Bash`/`PowerShell` — `shell: none | restricted (shell_allow) | project`, then HTTP/k6 rules by effective `http`/`load`, and any DELETE must reference a live entity of the current run;
  - `Write`/`Edit`/`MultiEdit`/`NotebookEdit` — only inside `filesystem.write` (`${product}`, `${run_id}` expanded; `${module}` = one path segment); nothing outside the repo;
  - `WebFetch`/`WebSearch` — the product's own host needs `http: read`; anything else needs `web_research: allowed`;
  - Playwright MCP — `browser: none` blocks all; `read` blocks typing, form filling, selects, uploads, drag/drop, key presses, dialogs and script evaluation (clicks stay allowed for navigation).
- **Active runs** are found from `artifacts/*/state/lock.json`. No active run ⇒ readonly shell rules only. Agents not in the permissions file (e.g. a human's own session) get the mode rules only. If the guard itself errors while a run is active, the hook fails closed.
- **Known limits** — a `shell: project` agent could still write files or call the network through a script the guard can't parse; Playwright `mutationGuard` fixtures and k6 host allow-lists (built in their domains) are the second layer.

## Schemas

`schemas/{run,lock,ledger-entry,sitemap}.schema.json` (JSON Schema 2020-12, Ajv). Changing the layout, a schema or the stage table bumps `LAYOUT_VERSION` in `scripts/lib/contract.mjs`.
