---
source_agent: api-testing-agent
date: 2026-10-05
target: rakesh-freshsales-ind-sep21
related_files:
  - api-tests/playwright-api/tests/freshsales/accounts/sales-accounts.spec.ts
  - api-tests/playwright-api/helpers/freshsales/accounts-track.ts
  - artifacts/rakesh-freshsales-ind-sep21/modules/accounts/api/api-test-plan.md
severity: medium
---

## Finding 1: live k6 blocked again in full-run
The guard-bash hook checks the process env, not the prompt-passed mode, so a prompt-authorized k6 run is blocked; it also matched a heredoc that merely mentioned k6 (had to switch to the Write tool). Hook not overridden. Orchestrator should launch with AUTHORIZATIONS_MODE=full-run in the env (recurrence of earlier feedback).

## Finding 2: duplicated per-track helpers
Third copy of the CSRF/created-entities helper (sales-activities, dashboards, accounts). Promote a parameterized shared helper (log path as argument) into fixtures/.

## Finding 3: target behaviour vs clarifications
- Account Name max length is 255 (256 -> 400 "not in required length"); clarifications say "no max length".
- Phone "abc" returns 200 with phone silently stored as null (known defect, encoded with test.fail).
- POST with a text/plain body returns 500 {error_code:500} (encoded with test.fail).
- Authoring probes created 9 ZZ accounts besides the suite's own; all logged in created-entities.json and deleted.
