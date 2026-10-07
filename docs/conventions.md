# Pipeline Conventions

> **Partly superseded.** The pipeline is being rebuilt as the 43-agent design in [`agent-architecture.md`](agent-architecture.md) with the product-level contract in [`artifact-contract.md`](artifact-contract.md). Sections below about the old seven-agent pipeline (two-pass clarification, `answers`/`defaults` matching, full-product runs, the questionnaire CSVs) describe the pre-v2 agents and are removed as each domain is rebuilt. The feedback-file contract still applies.

This framework has **no orchestrator script** — there is no separate process, server, or CLI that drives the pipeline. There is, however, an **orchestrator agent** (`orchestrator-agent`, an LLM subagent like any other) that can drive the other six agents end to end from a single run-config file — see "Orchestrator & run-config contract" below. Either way, the pipeline order and artifact handoffs are enforced entirely by convention: every agent's system prompt reads from and writes to the same fixed paths documented here, regardless of which platform flavor is running it (see "Platform flavors" immediately below). Running the pipeline manually (a human or top-level session invoking each agent in order) and running it through `orchestrator-agent` both follow this same contract — the orchestrator is a convenience on top of it, not a different pipeline.

## Platform

The framework is **platform-neutral by design**: the pipeline, the artifact contract (`docs/artifact-contract.md`), the run-config, the safety guard and every script under `scripts/` know nothing about which agent runtime executes the personas. Today the personas are implemented for **Claude Code** only (`claude-agents/*.md`, discovered via the `.claude/agents` symlink; subagents invoked through the `Agent` tool; human questions through `AskUserQuestion`).

If another runtime is added later it must behave identically: same stages, same artifacts, same scripts, same guard — only the agent files and a thin guard adapter differ (add a platform entry in `config/models.yaml` and `scripts/sync-agent-models.mjs`). Never fork pipeline logic per platform.

Never hand-edit a `model:` frontmatter line directly — `config/models.yaml` is the single source of truth; run `node scripts/sync-agent-models.mjs` after changing it (`--check` in CI).

## Artifact contract

Everything a run produces lives under `artifacts/<run-id>/` and follows **layout v1**, defined in [`docs/artifact-contract.md`](artifact-contract.md): a `run.json` manifest (the only source of run state and of the safety mode), one `modules/<module>/` track per module (a single-feature run is a one-module run), an append-only `ledger.jsonl` of created entities, and JSON Schemas in `schemas/`. `<run-id>` is `<target-slug>-<YYYYMMDD>-<HHmm>` (`node scripts/run.mjs init`). `artifacts/` is generated and git-ignored; curated, sanitized runs live under `examples/`.

## Pipeline order and handoff contract

| Stage | Agent | Produces (under `artifacts/<run-id>/`) | Consumed by |
|---|---|---|---|
| `discover` (full-product only, run-level) | `explore-agent` `role: discover` | `discovery/modules.json` (+ product overview, navigation graph, flows) | the orchestrator (`run.mjs set-modules`), then every module's explore |
| `explore` | `explore-agent` (`role: module` in full-product) | `modules/<m>/explore/sitemap.json` + `pages/<slug>/{screenshot.png, dom-snapshot.md, network-requests.json, console-log.txt}` | all downstream stages |
| `clarify` | `requirements-clarification-agent` | `modules/<m>/clarifications/<m>-clarifications.md` (+ `pass1-questions.json`) | `testcases` (authoritative), `playwright` & `api` (behavior context) |
| `testcases` | `testcase-generator-agent` | `modules/<m>/testcases/<m>-testcases.<ext>` + `testcases-summary.md` | `playwright`, `api` |
| `playwright` | `playwright-automation-agent` | the product's project `playwright-tests/<product>/` + `modules/<m>/playwright/summary.md` | terminal |
| `api` | `api-testing-agent` | `modules/<m>/api/{discovered-endpoints.json, api-test-plan.md}` + `api-tests/playwright-api/` + `api-tests/k6/` | terminal |
| `report` (run-level) | `orchestrator-agent` | `run-report.md` | humans |
| — | `feedback-implementor-agent` | fixes to whatever a feedback file concerns + a `## Resolution` section in that file; invoked ad hoc, not a pipeline stage | terminal |

Stage dependencies and completion rules are code, not prose: `scripts/lib/contract.mjs` (`STAGES`) and `node scripts/run.mjs next|status|stage`.

## The two-pass clarification handshake

`requirements-clarification-agent` cannot block mid-run for human input (subagents are single-shot request/response). It self-detects its pass by whether the invocation prompt contains an `Answers:` section:

- **Pass 1** (no `Answers:` section): returns a structured, tagged question list and writes no artifact.
- Whoever invoked it resolves those questions — a human answering directly in chat (via `AskUserQuestion` on Claude Code), or `orchestrator-agent` matching them against a run-config file's `answers`/`defaults` (see below).
- **Pass 2** (prompt re-sent with an `Answers:` section appended): writes the final `clarifications.md`.

Any orchestrator invoking this agent must expect two calls, not one.

## Orchestrator & run-config contract

`orchestrator-agent` is the hub in this framework's hub-and-spoke model: invoke it once, with one run-config file, and it drives stages 1–6 in order, passing each stage's real artifact path to the next — the same handoff contract as a manual run, just not invoked by hand.

### The constraint that shapes this whole section

`orchestrator-agent` is itself a subagent, so it inherits the same limitation described above: **it cannot reliably pause for a structured human question-and-wait** (Claude Code's `AskUserQuestion` is unavailable to a subagent). A run-config file is not a convenience layered on top of an otherwise-interactive orchestrator — it is the *only* channel through which most recurring questions get answered without a human touchpoint. Anything the config doesn't cover still halts the run (see "Halting and resuming" below); the orchestrator never guesses at a `[Blocking]` question regardless of what the config does or doesn't say.

### Run-config file

One YAML file configures one full pipeline pass: one target, one feature. A worked example lives at `config/run-config.example.yaml`. The config is validated, and its slug/answer-matching computed, by `node scripts/run-config.mjs validate|match` (not by LLM judgment). Top-level keys:

| Key | Purpose |
|---|---|
| `target.url` / `maxPages` / `maxDepth` | Passed straight to `explore-agent`. `target.url` is the only required field in the whole file. |
| `target.product` | Optional lowercase-kebab product name; the folder `playwright-tests/<product>/` that holds this product's Playwright project. Defaults to the target slug -- set it when the slug (a tenant subdomain, say) isn't a good product name. |
| `feature.slug` / `description` / `requirement_docs` | Passed to `requirements-clarification-agent` as Pass 1 grounding. |
| `authorizations.mode` | The master switch for every spoke agent's safe-vs-full posture: `readonly` (default when absent) or `full-run`. `readonly` = explore-agent stays a non-mutating crawler, api-testing-agent's generated Playwright specs default to GET-only and it never runs `k6 run` live, playwright-automation-agent generates mutating specs but skips them at run time. `full-run` = explore-agent performs full UI interaction, api-testing-agent generates and executes full GET/POST/PUT/PATCH/DELETE coverage and may run a live k6 load test, and playwright-automation-agent executes mutating specs live. In `full-run`, every agent still self-scopes destructive actions (delete/cancel/remove) to entities that agent's own run created — see each agent's own persona for its `created-entities.json` contract. This is not something the config can loosen further. |
| `authorizations.authenticated_crawl` / `credentials_file` | Opt-in exception to explore-agent's read-only default, orthogonal to `mode`. `credentials_file` is always a **file path**, never inline secret values — the credential-leakage classifier blocks inline secrets in an agent prompt regardless. **explore-agent itself never reads or types the credentials in this file** — typing a password or attempting to solve/bypass a CAPTCHA via its own live, interactive browser-tool session is a hard, non-overridable rule for that agent, regardless of what `mode`/`authenticated_crawl` say (see `authorizations.session_state_file` below for how explore-agent actually performs an authenticated crawl). `credentials_file` remains exactly as before for `playwright-automation-agent` and `api-testing-agent`, which perform login by writing and executing real Playwright test code (a non-interactive, scripted execution mode, not live turn-by-turn browsing) rather than driving a browser themselves turn by turn. |
| `authorizations.session_state_file` | Optional path to a pre-authenticated **Playwright storageState JSON** (cookies + localStorage) or a minimal session-cookie value file, produced by a human completing a target's login — and any CAPTCHA/MFA challenge — once, interactively, out-of-band. Never produced or typed by an agent itself. Two independent uses: (1) it is the *only* way `explore-agent` performs an authenticated crawl (loaded into its browser session rather than logging in itself); (2) it is the documented fallback for `playwright-automation-agent` (used as the suite's `storageState`) and `api-testing-agent` (its session-cookie value read into an `APIRequestContext` fixture) when their own scripted/API-level login reliably hits a CAPTCHA/MFA challenge they cannot complete — see each persona's own auth-fallback rule. |
| `testcases.output_format` | The format `testcase-generator-agent` should confirm and use. |
| `defaults.unconfirmed_behavior_policy` / `unconfirmed_edge_case_policy` | Applied only to `[Nice-to-have]`-tagged Pass-1 questions that `answers` doesn't already cover. Never applied to `[Blocking]` questions. |
| `answers` | A list of `{match, answer}` pairs. The orchestrator resolves a Pass-1 question by a case-insensitive substring match of `match` against the question text, first match wins, **after normalizing both strings** (replace `-`/`_` with a space, then collapse runs of whitespace to one space) so that generation-time punctuation variance (e.g. `duplicate-email` vs. `duplicate email`) doesn't produce a false-negative miss. Because substring matching can still produce a false positive if `match` is a short/common word that happens to appear inside an unrelated question, prefer specific, multi-word `match` strings over single common words, and where a topic could plausibly be phrased with either a hyphen or a space, list both forms as separate `answers` entries rather than relying on the normalization alone. This is the main lever for avoiding a halt on a question you already anticipate. |
| `full_product` | Optional, valid only when `feature.slug` is `full-product` (see "Full-product runs"): `max_modules` (12), `explore_concurrency` (1), `max_parallel_tracks` (4), `per_module.{maxPages,maxDepth}` (40/4), `modules.{include,exclude}` (slug lists), `knowledge_urls` (docs for the discovery agent), `clarifications.{csv_threshold,max_rounds}` (5/5; see "Clarification session"). Validated and defaulted by `run-config.mjs`. |
| `feedback_loop.auto_invoke_implementor` | Whether the orchestrator hands any feedback files filed mid-run straight to `feedback-implementor-agent` (default `false`; set `true` only for reviewed runs, since the implementor edits agent prompts) or just reports their paths. |
| `git.auto_commit` | Whether the orchestrator may run `git commit` at all. Default/absent is `false` — the orchestrator never commits unless this is explicitly `true`. |

### Halting and resuming

If, after matching against `answers` (using the normalized substring match described above) and applying `defaults` to nice-to-have questions, any `[Blocking]` question is still unanswered, the orchestrator stops at that point and reports: which stages completed, every artifact produced so far, and the unanswered question(s) verbatim. **Any Pass-1 question text quoted or referenced in this halt report — blocking or not — must be quoted verbatim, never paraphrased or given a short label.** A human's `answers` entry is matched against the question text by literal (normalized) substring, so a paraphrased label like "Q5 (activity type coverage)" can never match the real question text and would be silently discarded by the matching algorithm even though the human's intent was clear. A human adds an `answers` entry (or answers directly) and re-invokes the orchestrator with the same `configPath`.

Re-invocation is resumable from `run.json`: the orchestrator calls `node scripts/run.mjs next <run-dir>`, which offers a stage only when its dependencies are done and it is not yet **verified** complete — marked `done` in `run.json` *and* every declared output present and schema-valid. A partially written artifact therefore never counts as done.

### What the config can never do

The config can only exercise opt-in exceptions a spoke agent already defines in its own persona: an authenticated crawl, and — via `authorizations.mode: full-run` — full UI/API mutation and a live k6 run. It can never override a spoke agent's *inner* hard rule: even in `full-run`, every agent still scopes destructive actions (delete/cancel/remove) to entities it created itself this run, never pre-existing or other users' data, and never completes an irreversible real-world side effect (e.g. a real payment) with no test/sandbox path available. Those inner rules are enforced inside each spoke agent's own definition and are not parameters.

## Full-product runs (`feature.slug: full-product`)

A run-config whose `feature.slug` is `full-product` (see `config/run-config-full-product.example.yaml`) maps the whole product and tests every module. `scripts/run-config.mjs` fills the `full_product` defaults; `run.mjs init` creates a run with an empty module list.

**Flow:** `discover` (research the vendor's docs + walk the live navigation -> `discovery/modules.json`) -> `run.mjs set-modules` (applies `modules.include/exclude`, `max_modules`, drops unreachable modules) -> per-module tracks `explore -> clarify -> testcases -> {playwright, api}`, run in parallel up to `max_parallel_tracks`. `run.mjs next` returns exactly which (stage, module) pairs are ready. The full-product directory layout is in `docs/artifact-contract.md`.

Test code stays in the shared projects but inside per-track subfolders: `playwright-tests/<product>/{tests/functional,tests/visual,pages}/<module-slug>/`, `api-tests/playwright-api/tests/<target>/<module-slug>/`, `api-tests/k6/scripts/<module-slug>-<resource>-load-test.js`. Tracks never edit shared files (package/config/fixtures); the first track's Playwright/API stage runs alone to scaffold a project.

### One Playwright project per product
Every track of a product writes into the same self-contained project `playwright-tests/<product>/` (own `package.json`, `playwright.config.ts`, `fixtures/`, `pages/`, `tests/`, `utils/`, `.env*`, `.auth/`), so the suite evolves and scales as a single repository per product, one module at a time. A different product never shares a folder: running the workflow for another product creates `playwright-tests/<other-product>/` (scaffolded by copying an existing sibling's conventions). `<product>` is `target.product` from the run-config (default: the slug). A `playwright.config.*` sitting directly in `playwright-tests/` is the old single-project layout; the orchestrator halts and asks for it to be moved into its product folder rather than extending it. API tests keep their own per-target layout under `api-tests/`.

### Clarification session (human questions across modules)
Per-module Pass 1 questions that the run-config's `answers`/`defaults` can't resolve are the module's **open questions** (unresolved `[Blocking]` ones, including those explore-agent left in `artifacts/<slug>/open-questions.csv`, one row per question with a `module` column). Modules with none run straight through; the rest are pipelined so a module's track starts the moment *its* questions are answered, not when everyone's are.
- **Two files kinds, two separate writers (no overlapping edits).**
  - `artifacts/<run-id>/clarifications/questions.csv` -- the **main questionnaire**, columns exactly `Module`, `Question`, `How to navigate the product to understand the question flow`, `Answer by the user`. Written **only** by the orchestrator, through `scripts/clarification-csv.mjs`; the human never edits it.
  - `artifacts/<run-id>/clarifications/answers/answers-NNN.csv` -- **answer sheets**, same four columns. Each batch of new questions (the first round, and every follow-up round) gets its own new sheet, created once with just that batch. From then on the sheet is the human's; the orchestrator only reads it and never rewrites, renames or deletes it. Follow-ups arrive as a *new* sheet, never as edits to an old one.
- **When it's used:** when the open questions across all modules this round exceed `full_product.clarifications.csv_threshold` (default 5), and for every later question once the questionnaire exists; at or below the threshold, questions are asked inline as in a single-feature run.
- **Answered / ready / merged:** a question is answered when its answer is non-empty in the main file or in its sheet. A module becomes ready (its Pass 2 and track launch) as soon as all its rows are answered, reading the sheet as the human left it. Once a sheet is **fully** clarified (every row answered) the orchestrator runs `merge`, which copies the sheet's answers into the main questionnaire in one atomic write; the sheet is left untouched. A sheet the human is mid-save, or has damaged, is reported and ignored until it parses cleanly again. Answers given in chat are recorded in the main file (never the sheet) and count the same.
- **Script commands:** `append <main> <items.json> <answersDir>` (adds rows to main, creates the next sheet), `status <main> <answersDir>`, `answers <main> <answersDir> <module>`, `answer <main> <module> <question> <answer>`, `merge <main> <answersDir>`. Quoting, multi-line cells and Excel's BOM are handled in the script; only `answers-NNN.csv` filenames count as sheets, so Excel lock/temp files are ignored.
- **Navigation column:** written by the clarification agent from the module's `flows/` (`navPath` + flow slug) so a human can reproduce the behavior in the live product before answering.
- **Loop:** Pass 2 ends with `## Follow-up Questions`; unresolved blocking follow-ups are appended (new rows, new sheet) and the module goes around again. `full_product.clarifications.max_rounds` (default 5; round 1 = the initial questions) caps it -- a module still unresolved afterwards is marked **`uncovered`**: no test cases, Playwright or API stages are produced for it, its latest clarifications file (open questions intact) and questionnaire rows stay, and the run report lists the unresolved questions verbatim.
- **State:** `artifacts/<run-id>/clarifications/state.json` -- `{"<module>": {round, status: no-questions|awaiting-user|ready|done|uncovered, open[]}}`. With the questionnaire and sheets it is the resume state: re-invoke with the same `configPath` after answering and fully-answered modules continue.
- **Interaction:** as the main session (`claude --agent orchestrator-agent`) the orchestrator points the user at the answer sheet, re-checks state on every user message and background-track completion, and -- once the question-free tracks have finished -- can walk through the remaining modules one at a time, recording chat answers. As a subagent it finishes everything that can run, then halts with the sheet path(s) and the resume instruction.

## Standing safety guardrails (apply across the whole framework)

**By default (`authorizations.mode` absent or `readonly`):**
- `explore-agent` is strictly read-only: no form submissions, no destructive/mutating clicks.
- `api-testing-agent` never executes a live k6 load run against any target; it generates scripts and validates them statically only (`k6 inspect`). Its generated Playwright API tests default to read-only (GET) calls against live third-party targets.
- `playwright-automation-agent` generates mutating specs but skips them at run time instead of executing them live.

**When a run-config explicitly sets `authorizations.mode: full-run` for a target the user controls:**
- `explore-agent` performs full UI interaction (forms, create/update/delete) during its crawl.
- `api-testing-agent` generates and executes full GET/POST/PUT/PATCH/DELETE coverage, and may run a live k6 load test.
- `playwright-automation-agent` executes mutating specs (booking/checkout/create/delete) live.
- **This is opt-in per run, per target, and never inferred** — an agent must see `mode: full-run` explicitly in its invocation prompt, never assume it from a target "looking safe" or from any other part of the prompt.
- **Even in `full-run`, destructive actions (delete/cancel/remove) stay scoped to entities this run created itself** — recorded in the run's single ledger (`artifacts/<run-id>/ledger.jsonl`, written with `node scripts/ledger.mjs add`, checked with `ledger.mjs owns`) — never pre-existing data, seed data, or another user's data. An irreversible real-world side effect with no test/sandbox path (e.g. a real payment) is skipped with a stated reason rather than completed.

**Always, regardless of mode:**
- `playwright-automation-agent` generates its own visual-regression golden baselines inside the scaffolded project (via `--update-snapshots`); it does not treat `explore-agent`'s screenshots as pixel-compatible baselines.
- `feedback-implementor-agent` never runs `k6 run` against a live target for its own fix-verification purposes — `full-run` authorizes api-testing-agent's live k6 execution during a real pipeline run, not this agent's verification step.
- **A reproducible CAPTCHA/MFA/bot-challenge on a login form that blocks scripted or API-level authentication is a hard blocker to report, not a puzzle to solve or bypass** — the same category as an irreversible real-world side effect with no test/sandbox path, above. This applies to `playwright-automation-agent` (scripted UI login) and `api-testing-agent` (session-cookie/API-level auth) alike: reproduce it at least a couple of times across different launch configs before concluding it isn't a transient flake, then fall back to `authorizations.session_state_file` if the run-config provides one (see the run-config contract above), and otherwise leave the blocked tests as `test.skip()`/skipped-with-an-explicit-reason — never faked as passing — while still generating and executing live whatever unauthenticated-boundary subset (missing/invalid-session responses, a public page's visual baseline, etc.) is reachable without a session. `explore-agent` is under a stricter, non-mode-gated version of this same rule: it never attempts to type a password or solve a CAPTCHA itself under any circumstance — see `authorizations.session_state_file` above.
- **If a target's feature description names a module/entity that isn't actually reachable during `explore-agent`'s crawl** (a permission gap, a disabled module, a role mismatch), `explore-agent` documents the substitution it made under a machine-greppable `## Feature-mapping caveats` heading in `crawl-log.md` rather than silently working around it, and `requirements-clarification-agent`'s Pass 1 greps for that heading and surfaces it as a `[Blocking]` clarification question rather than assuming the feature description is accurate.

## Executable project scaffolds

`playwright-tests/<product>/` (one per product) and `api-tests/playwright-api/` are independent, self-contained Node projects (own `package.json` each), separate from the `artifacts/` handoff zone, so either can be lifted directly into a real target product repo.

## Feedback contract

Any agent — current or future, including this one — that discovers a bug, ambiguity, or gap in its own instructions, another agent's instructions, or previously generated code/artifacts, or that has a concrete improvement suggestion, writes it to a dedicated **feedback file** instead of only describing it in its final chat response. This keeps the coordinator from having to re-transmit long feedback text through further LLM calls (lossy and expensive), and keeps every piece of feedback traceable to the exact agent that raised it.

### Where feedback lives

```
feedback/<source-agent-name>/<YYYY-MM-DD>-<short-slug>.md
```

`<source-agent-name>` must exactly match the filing agent's own `name` field (e.g. `playwright-automation-agent`) — this is what makes a feedback file traceable to its source without needing to parse its content. One file per submission; a single file may bundle multiple findings from the same run, but don't append unrelated findings from later runs into an old file.

### Feedback file schema

```markdown
---
source_agent: <name matching the filing agent's own `name:` frontmatter field, e.g. playwright-automation-agent>
date: <YYYY-MM-DD>
target: <target-slug, or "framework" if not tied to a specific target run>
related_files:
  - <path to each file this finding concerns, e.g. claude-agents/playwright-automation-agent.md>
  - <path to a generated artifact/spec file if the bug is IN generated output, not the agent definition>
severity: <blocking | high | medium | low>
---

## Finding 1: <short title>
**Summary:** <one or two sentences>
**Evidence:** <what was observed -- error text, file:line, screenshot path, command output, etc.>
**Suggested fix:** <concrete and actionable, not just "investigate">

## Finding 2: ...
```

### How it's consumed

1. An agent that files feedback states **only the file path** in its final response to the coordinator — never the full feedback text inline.
2. The coordinator passes that same file path (unread, or lightly skimmed for prioritization — never retyped or paraphrased) to `feedback-implementor-agent`.
3. `feedback-implementor-agent` reads the file itself, implements each finding's suggested fix, verifies it where possible (re-run tests, typecheck, `k6 inspect`, etc.), and appends a dated `## Resolution` section to the **same** file recording status (`Fixed` / `Skipped` / `Deferred`) and why — so the file remains the permanent, traceable record of both the problem and its resolution.


### Code-level enforcement of `authorizations.mode`

Prose is not the only guard, and there is **one** source of truth for the mode: `mode` in the active run's `run.json`, resolved once from the run-config by `run.mjs init` (the guard finds the run via `artifacts/.active-run`). With no active run the mode is `readonly`. The `AUTHORIZATIONS_MODE` env var can only *downgrade* to `readonly`; it can never grant `full-run`. The rules live in `scripts/lib/guard.mjs` (platform-neutral); the Claude Code adapter is `.claude/hooks/guard-bash.mjs` (PreToolUse on Bash and PowerShell):
- In `readonly`: blocks live k6 runs and mutating HTTP from curl, wget, PowerShell web cmdlets and inline node/python scripts.
- In `full-run`: mutations pass, but a DELETE must reference an entity that is **live in this run's ledger** — deletes outside the ledger are blocked in code, not just by prompt.
- `playwright-tests/<product>/fixtures/mutationGuard.ts` aborts non-GET browser requests, and `api-tests/playwright-api/fixtures/mutationGuard.ts` throws on non-GET `request.*` calls, for every spec built on the shared fixtures. Auth setup projects are exempt (they must POST a login).
- k6 scripts have no default host: `BASE_URL` is required and must be in `K6_ALLOWED_HOSTS` (see `api-tests/k6/README.md`).
