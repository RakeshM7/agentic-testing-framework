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
| 6 | `feedback-implementor-agent` | Fixes applied to whatever files a feedback file's findings concern + a `## Resolution` section appended to that same feedback file | Terminal (invoked ad hoc, not part of the linear per-target pipeline) |

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
