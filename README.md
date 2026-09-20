# Agentic Testing Framework

A set of specialized Claude Code subagents that together cover Manual, Automation (Playwright), UI Visual, and API (Playwright + K6) testing for any web application.

## Agents

| Agent | Role |
|---|---|
| [`explore-agent`](.claude/agents/explore-agent.md) | Crawls a target UI, builds a sitemap, captures a baseline snapshot (screenshot + DOM + network + console) per page. |
| [`requirements-clarification-agent`](.claude/agents/requirements-clarification-agent.md) | Interviews the user about behavior, edge cases, and desired test-case format; produces an authoritative clarifications doc. |
| [`testcase-generator-agent`](.claude/agents/testcase-generator-agent.md) | Generates manual test cases in the user's confirmed format, with traceability. |
| [`playwright-automation-agent`](.claude/agents/playwright-automation-agent.md) | Scaffolds or extends a Playwright suite (functional + visual-regression), matching existing repo conventions or researching best practices from scratch. |
| [`api-testing-agent`](.claude/agents/api-testing-agent.md) | Discovers APIs, writes an exhaustive test plan, and generates Playwright API tests + k6 load-test scripts (never executed live automatically). |

See [`docs/conventions.md`](docs/conventions.md) for the full pipeline order, artifact handoff contract, and safety guardrails.

## Pipeline

```
explore-agent
     │  sitemap.json + page snapshots
     ▼
requirements-clarification-agent  (two-pass: ask questions → get answers → write clarifications.md)
     │  clarifications.md
     ▼
testcase-generator-agent
     │  testcases.<ext>
     ▼
     ├──▶ playwright-automation-agent  →  playwright-tests/ (+ docs/playwright-framework-research.md if greenfield)
     └──▶ api-testing-agent            →  api-tests/playwright-api/ + api-tests/k6/
```

There is no orchestrator script. Invoke each agent in order via the Agent/Task tool (`subagent_type` matching the agent's `name`), passing the previous stage's artifact path as context.

**Deployment note**: Claude Code does not hot-load `.claude/agents/*.md` files into an already-running session. After adding or editing an agent definition, start a new session before its `subagent_type` becomes invocable via the Agent tool.

## Usage

Point `explore-agent` at a target URL, then walk the pipeline above. All pipeline artifacts for a given target land under `artifacts/<target-slug>/`. Executable suites land in `playwright-tests/` and `api-tests/`, which are self-contained and can be copied directly into the target product's own repository.

## Validation

This framework was dogfooded end-to-end against the public demo site `https://eventhub.rahulshettyacademy.com`. See [`docs/validation-report.md`](docs/validation-report.md) for the full run log, artifacts produced, and per-agent feedback.
