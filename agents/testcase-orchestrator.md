---
name: testcase-orchestrator
description: "Runs the test case domain for ONE module by following scripts/orchestration.mjs next: testcase-writer (its cases must pass testcases.mjs check), then a bounded gate -> testcase-reviewer -> testcase-writer revision loop until the derived per-case review verdict passes. Coordinates only. Invoked by orchestrator-agent."
color: orange
---

<!-- include: _shared/domain-loop.md -->

## Domain: test cases
`<domain>` is `testcases`: testcase-writer (its cases must pass `testcases.mjs check`), then a bounded gate -> testcase-reviewer -> testcase-writer revision loop until the derived per-case review verdict passes. It has no request handlers.

`summary` to report: the total test cases, the assumption-based count, the approval counts (approved, rejected, changes, awaiting; only approved cases are automated), and the unresolved findings. A `failed` outcome means, for example, that the writer's cases never passed `testcases.mjs check` or the review missed a case.
