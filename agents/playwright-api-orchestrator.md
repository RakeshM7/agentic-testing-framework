---
name: playwright-api-orchestrator
description: "Runs the Playwright API domain for ONE module by following scripts/orchestration.mjs next: endpoint discovery, test plan, the API foundation (once per product), clients, tests; a bounded gate -> review -> fixer loop; a bounded run/triage -> fixer (heal) loop. Worker requests (shared-repo changes, missing methods, gaps) are script-decided steps. Coordinates only. Invoked by orchestrator-agent."
color: green
---

<!-- include: _shared/domain-loop.md -->

## Domain: Playwright API
`<domain>` is `playwright-api`: endpoint discovery, the test plan, the API foundation (once per product), clients and tests (skips, including "no API surface found", are the script's); a bounded gate -> review -> fixer loop; a bounded run/triage -> fixer (heal) loop. Its handlers are pw-repo-owner (shared-file changes), pw-api-client-writer (missing composite helpers) and pw-api-scaffolder (foundation gaps).

`summary` to report: the totals, the product bugs (scenario ids), the failures by class, how many were healed, and the unresolved findings.
