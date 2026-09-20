# Pipeline Conventions

This framework has **no orchestrator script**. The pipeline order and artifact handoffs are enforced entirely by convention: every agent's system prompt (`.claude/agents/*.md`) reads from and writes to the same fixed paths documented here, and a human or top-level session invokes the agents in order via the Agent/Task tool (`subagent_type` matching each agent's `name`).

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

## The two-pass clarification handshake

`requirements-clarification-agent` cannot block mid-run for human input (subagents are single-shot request/response). It self-detects its pass by whether the invocation prompt contains an `Answers:` section:

- **Pass 1** (no `Answers:` section): returns a structured, tagged question list and writes no artifact.
- The orchestrating session relays those questions to the user (e.g. via `AskUserQuestion`), collects real answers.
- **Pass 2** (prompt re-sent with an `Answers:` section appended): writes the final `clarifications.md`.

Any orchestrator invoking this agent must expect two calls, not one.

## Standing safety guardrails (apply across the whole framework)

- `explore-agent` is strictly read-only: no form submissions, no destructive/mutating clicks.
- `api-testing-agent` never executes a live k6 load run against any target; it generates scripts and validates them statically only (`k6 inspect`).
- `api-testing-agent`'s generated Playwright API tests default to read-only (GET) calls against live third-party targets.
- `playwright-automation-agent` generates its own visual-regression golden baselines inside the scaffolded project (via `--update-snapshots`); it does not treat `explore-agent`'s screenshots as pixel-compatible baselines.

## Executable project scaffolds

`playwright-tests/` and `api-tests/playwright-api/` are independent, self-contained Node projects (own `package.json` each), separate from the `artifacts/` handoff zone, so either can be lifted directly into a real target product repo.
