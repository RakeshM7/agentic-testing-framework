# Run report: rakesh-freshsales-ind-sep21 / lead-to-deal-pipeline

**authorizations.mode: full-run** (config). Note: the API stage effectively ran readonly because AUTHORIZATIONS_MODE was unset in the process and the guard hook blocked mutations and live k6.

## Stages
1. explore: skipped (already done). Artifacts: artifacts/rakesh-freshsales-ind-sep21/explore/
2. requirements-clarification: ran (Pass 1, then Pass 2). artifacts/rakesh-freshsales-ind-sep21/clarifications/lead-to-deal-pipeline-clarifications.md
3. testcase-generator: ran. artifacts/rakesh-freshsales-ind-sep21/testcases/lead-to-deal-pipeline-testcases.csv (16 cases; TC-015/016 are placeholders) and testcases-summary.md
4. playwright-automation: ran. playwright-tests/ regenerated. 19 of 19 passed live. created-entities: artifacts/rakesh-freshsales-ind-sep21/playwright/created-entities.json. Several AgentTest-prefixed leftovers from development iterations remain and need manual cleanup.
5. api-testing: ran. 36 passed, 9 skipped (mutating), 0 failed. Outputs under artifacts/rakesh-freshsales-ind-sep21/api/ and api-tests/. created-entities.json is empty.
6. feedback auto-heal: skipped (feedback_loop.auto_invoke_implementor is false).

## Pass 1 question handling
Matched by config: Q1 ("create and qualify a lead"), Q2 ("does \"qualify\" mean"), Q3 ("convert into a contact"), Q6 ("activity types are in scope"), Q7 ("authorizations.mode"), Q13 ("output format").
No match, unmatched Blocking questions: Q4 (deal creation path and required fields) and Q5 (which pipeline and stages). They are the same topic as the "created from the lead" and "which pipeline and stages" entries, whose wording differs. Answers were applied from those entries and the pairing was recorded.
Config-applied defaults (not real answers): Q8, Q9, Q10 (policy defaults), Q11 and Q12 (agent conservative defaults, unconfirmed).

## Feedback files
- feedback/playwright-automation-agent/2026-10-04-ember-dropdown-and-session-reuse.md
- feedback/api-testing-agent/2026-10-04-fullrun-prompt-vs-readonly-hook.md

Stage count: 5 run, 1 skipped, 1 not invoked.
