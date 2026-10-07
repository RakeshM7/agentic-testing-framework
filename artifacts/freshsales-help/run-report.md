# Run Report — freshsales-help

## AUTHORIZATIONS.MODE: READONLY

**This run was started with `authorizations.mode: readonly` for the Freshsales public-help target** (`https://support.freshsales.io/support/home`). No mutating or destructive actions were authorized for this run.

Run config: `config/freshsale-app.yaml`
Overall status: **Halted at stage 1**

---

## Stage execution summary

| Stage | Status | Notes |
|---|---|---|
| 0. Config load/validate | Done | `target.url` was present and the YAML parsed successfully. `target.slug` resolved to `freshsales-help` from the config value. |
| 1. explore-agent | Halted | Blocked before crawler start: this environment does not have an interactive Playwright/browser MCP session available for a live crawl, and the framework requires that session for `explore-agent` to run against a real target. No sitemap or page artifacts were produced. |
| 2. requirements-clarification-agent | Not reached | Pass 1 was not invoked because the upstream crawl did not run. |
| 3. testcase-generator-agent | Not reached | No clarifications artifact exists yet. |
| 4. playwright-automation-agent | Not reached | Requires the produced testcases and sitemap artifacts. |
| 5. api-testing-agent | Not reached | Requires the output of the earlier stages. |
| 6. Feedback auto-heal | Not reached | No feedback files were created during this run. |

---

## Artifact paths produced

None yet. The target directory was created for the run report only.

---

## Config validation notes

- `target.url` is present and valid.
- `target.slug` is explicitly set to `freshsales-help`.
- `authorizations.mode` is `readonly`.
- `authorizations.authenticated_crawl` is `false` and `session_state_file` is unset.
- `testcases.output_format` is `gherkin`.
- `answers` contains matching entries for `role-based access` and `login`, but no stage 2 clarification pass was reached because the required browser crawl never started.

---

## Resume instruction

To resume this run, re-run the orchestrator with the same `configPath` after the live browser session required for `explore-agent` is available in VS Code, or add an `answers` entry and re-invoke it with the same `configPath` once a `[Blocking]` clarification question is encountered.

---

## Total elapsed stage count

1 stage invocation counted at the pipeline-order level before the environment blocker stopped the run.
