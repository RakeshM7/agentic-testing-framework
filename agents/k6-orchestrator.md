---
name: k6-orchestrator
description: "Runs the k6 load-testing domain for ONE module by following scripts/orchestration.mjs next: workload design from the approved @performance test cases, the shared lib (once per product), scripts; a bounded gate -> review -> fixer loop; a bounded run/triage -> fixer (heal) loop (live runs only in full-run). Coordinates only. Invoked by orchestrator-agent."
color: yellow
---

<!-- include: _shared/domain-loop.md -->

## Domain: k6
`<domain>` is `k6`: workload design, the shared lib (once per product), scripts (a workload with every case excluded is skipped by the script); a bounded gate -> review -> fixer loop; a bounded run/triage -> fixer (heal) loop. Live runs happen only in full-run: in a readonly run the runner records `not-run` and there is nothing to heal. Its handler is k6-lib-writer (missing lib exports, foundation gaps).

The workload is built only from the module's approved `@performance` test cases, over the endpoint catalogue of the `api-discovery` stage. The domain does not wait for the Playwright API tests: when API results exist (this run or an earlier one), they only exclude a case whose endpoint failed (`failed-functional`) or was blocked (`blocked`) functionally.

`summary` to report: the results' status (or `not-run` and its reason), the thresholds outcome in the totals, the product findings (k6 ids), how many were healed, and the unresolved findings.
