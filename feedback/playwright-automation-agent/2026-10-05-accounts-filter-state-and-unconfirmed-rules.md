---
source_agent: playwright-automation-agent
date: 2026-10-05
target: rakesh-freshsales-ind-sep21
related_files:
  - artifacts/rakesh-freshsales-ind-sep21/modules/accounts/testcases/accounts-testcases.csv
  - playwright-tests/freshsales/tests/functional/accounts/accounts-extended.spec.ts
  - playwright-tests/freshsales/playwright.config.ts
severity: medium
---

## Finding 1: Shared `test-results/` is wiped by parallel tracks
Parallel tracks sharing one project delete each other's `test-results/` (ENOENT on trace files, vanishing screenshots). Track runs should pass `--output=test-results-<trackSlug>`; the track-mode instructions should say so (config is a shared file the track cannot edit).

## Finding 2: Filter / column preferences persist tenant-side
Applied list filters and Customize-table columns persist across sessions, so tests that open "Filter by" fail when a prior run left a filter ("N filter applied", trigger is not role=button; "My accounts" has a default Sales owner filter and a different "Add filter" drawer). Testcases should say to run filter cases on "All accounts" and revert preferences.

## Finding 3: Unconfirmed website-rule assumptions are false (TC-040/041/042)
The app accepts Website `https://www.zzsite.com`, `zzsite.com` and `www.zz site.com`; only `not a url` is rejected. Cases were generated as rejection tests from an assumption; the specs are marked `test.fail` documenting this. Clarification should confirm the real rule.

## Finding 4: Typeahead text differs from the case
Name filter hint reads "Please enter 1 or more character" (counts remaining chars), not "Please enter 2 or more characters"; the bulk toolbar "Cancel" button is clipped/not reachable at 1440x900 (TC-005/033).
