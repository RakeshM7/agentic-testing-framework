# Pipeline Conventions

This framework has **no orchestrator script** — there is no separate process, server, or CLI that drives the pipeline. There is, however, an **orchestrator agent** (`orchestrator-agent`, an LLM subagent like any other) that can drive the other six agents end to end from a single run-config file — see "Orchestrator & run-config contract" below. Either way, the pipeline order and artifact handoffs are enforced entirely by convention: every agent's system prompt (`.claude/agents/*.md`) reads from and writes to the same fixed paths documented here. Running the pipeline manually (a human or top-level session invoking each agent in order via the Agent/Task tool, `subagent_type` matching each agent's `name`) and running it through `orchestrator-agent` both follow this same contract — the orchestrator is a convenience on top of it, not a different pipeline.

## Artifact root

All pipeline artifacts for a given target live under `artifacts/<target-slug>/`, where `<target-slug>` is the target's hostname, lowercased with non-alphanumeric characters replaced by `-` (e.g. `eventhub.rahulshettyacademy.com` → `eventhub`).

## Pipeline order and handoff contract

| Stage | Agent | Produces | Consumed by |
|---|---|---|---|
| 1 | `explore-agent` | `artifacts/<target>/explore/sitemap.json` + `pages/<slug>/{screenshot.png, dom-snapshot.md, network-requests.json, console-log.txt}` | All downstream agents |
| 2 | `requirements-clarification-agent` | `artifacts/<target>/clarifications/<feature-slug>-clarifications.md` | `testcase-generator-agent` (authoritative), `playwright-automation-agent` & `api-testing-agent` (behavior context) |
| 3 | `testcase-generator-agent` | `artifacts/<target>/testcases/<feature-slug>-testcases.<ext>` + `testcases-summary.md` | `playwright-automation-agent` (cases to automate), `api-testing-agent` (functional cross-reference) |
| 4 | `playwright-automation-agent` | `docs/playwright-framework-research.md` (greenfield only) + `playwright-tests/` project | Terminal |
| 5 | `api-testing-agent` | `artifacts/<target>/api/{discovered-endpoints.json, api-test-plan.md}` + `api-tests/playwright-api/` + `api-tests/k6/` | Terminal |
| 6 | `feedback-implementor-agent` | Fixes applied to whatever files a feedback file's findings concern + a `## Resolution` section appended to that same feedback file | Terminal (invoked ad hoc, not part of the linear per-target pipeline) |
| — | `orchestrator-agent` | `artifacts/<target>/run-report.md`, plus drives stages 1–6 above in order via the same paths | Hub, not a stage — invoked once per run instead of the other six being invoked by hand |

## The two-pass clarification handshake

`requirements-clarification-agent` cannot block mid-run for human input (subagents are single-shot request/response). It self-detects its pass by whether the invocation prompt contains an `Answers:` section:

- **Pass 1** (no `Answers:` section): returns a structured, tagged question list and writes no artifact.
- Whoever invoked it resolves those questions — either a human session relaying them via `AskUserQuestion`, or `orchestrator-agent` matching them against a run-config file's `answers`/`defaults` (see below).
- **Pass 2** (prompt re-sent with an `Answers:` section appended): writes the final `clarifications.md`.

Any orchestrator invoking this agent must expect two calls, not one.

## Orchestrator & run-config contract

`orchestrator-agent` is the hub in this framework's hub-and-spoke model: invoke it once, with one run-config file, and it drives stages 1–6 in order, passing each stage's real artifact path to the next — the same handoff contract as a manual run, just not invoked by hand.

### The constraint that shapes this whole section

`orchestrator-agent` is itself a subagent, so it inherits the same limitation described above: **it cannot reliably call `AskUserQuestion`.** A run-config file is not a convenience layered on top of an otherwise-interactive orchestrator — it is the *only* channel through which most recurring questions get answered without a human touchpoint. Anything the config doesn't cover still halts the run (see "Halting and resuming" below); the orchestrator never guesses at a `[Blocking]` question regardless of what the config does or doesn't say.

### Run-config file

One YAML file configures one full pipeline pass: one target, one feature. A worked example lives at `config/run-config.example.yaml`. Top-level keys:

| Key | Purpose |
|---|---|
| `target.url` / `maxPages` / `maxDepth` | Passed straight to `explore-agent`. `target.url` is the only required field in the whole file. |
| `feature.slug` / `description` / `requirement_docs` | Passed to `requirements-clarification-agent` as Pass 1 grounding. |
| `authorizations.authenticated_crawl` / `credentials_file` | Opt-in exception to explore-agent's read-only default. `credentials_file` is always a **file path**, never inline secret values — the credential-leakage classifier blocks inline secrets in an agent prompt regardless. |
| `authorizations.allow_mutating_api_tests` | Opt-in exception to api-testing-agent's GET-only default, for a target the user controls. **Cannot** enable a live k6 run at any value — that rule is hard-coded in `api-testing-agent` itself, not controlled by this file. |
| `testcases.output_format` | The format `testcase-generator-agent` should confirm and use. |
| `defaults.unconfirmed_behavior_policy` / `unconfirmed_edge_case_policy` | Applied only to `[Nice-to-have]`-tagged Pass-1 questions that `answers` doesn't already cover. Never applied to `[Blocking]` questions. |
| `answers` | A list of `{match, answer}` pairs. The orchestrator resolves a Pass-1 question by a case-insensitive substring match of `match` against the question text; first match wins. This is the main lever for avoiding a halt on a question you already anticipate. |
| `feedback_loop.auto_invoke_implementor` | Whether the orchestrator hands any feedback files filed mid-run straight to `feedback-implementor-agent` (default `true`) or just reports their paths. |
| `git.auto_commit` | Whether the orchestrator may run `git commit` at all. Default/absent is `false` — the orchestrator never commits unless this is explicitly `true`. |

### Halting and resuming

If, after matching against `answers` and applying `defaults` to nice-to-have questions, any `[Blocking]` question is still unanswered, the orchestrator stops at that point and reports: which stages completed, every artifact produced so far, and the unanswered question(s) verbatim. A human adds an `answers` entry (or answers directly) and re-invokes the orchestrator with the same `configPath`.

Re-invocation is naturally resumable, with no separate state file: before running any stage, the orchestrator checks whether that stage's conventional output artifact already exists and skips straight past it if so. The artifacts on disk are the state.

### What the config can never do

The config can only exercise opt-in exceptions a spoke agent already defines in its own persona (an authenticated crawl, a wider API test scope). It can never override a spoke agent's hard rule — explore-agent's read-only default beyond an authorized crawl, api-testing-agent's no-live-k6-run rule, playwright-automation-agent's no-live-mutation default. Those are enforced inside each spoke agent's own definition and are not parameters.

## Standing safety guardrails (apply across the whole framework)

- `explore-agent` is strictly read-only: no form submissions, no destructive/mutating clicks.
- `api-testing-agent` never executes a live k6 load run against any target; it generates scripts and validates them statically only (`k6 inspect`).
- `api-testing-agent`'s generated Playwright API tests default to read-only (GET) calls against live third-party targets.
- `playwright-automation-agent` generates its own visual-regression golden baselines inside the scaffolded project (via `--update-snapshots`); it does not treat `explore-agent`'s screenshots as pixel-compatible baselines.

## Executable project scaffolds

`playwright-tests/` and `api-tests/playwright-api/` are independent, self-contained Node projects (own `package.json` each), separate from the `artifacts/` handoff zone, so either can be lifted directly into a real target product repo.

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
source_agent: <name matching .claude/agents/<name>.md>
date: <YYYY-MM-DD>
target: <target-slug, or "framework" if not tied to a specific target run>
related_files:
  - <path to each file this finding concerns, e.g. .claude/agents/playwright-automation-agent.md>
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
