---
source_agent: playwright-automation-agent
date: 2026-10-05
target: rakesh-freshsales-ind-sep21
related_files:
  - artifacts/rakesh-freshsales-ind-sep21/modules/sales-sequences/testcases/sales-sequences-testcases.csv
  - playwright-tests/freshsales/pages/sales-sequences/SequencesPage.ts
  - playwright-tests/freshsales/tests/functional/sales-sequences/sequences-lifecycle.spec.ts
severity: medium
---

## Finding 1: Explore doc facts differed from the live app
**Summary:** Case wording diverged from live UI. Default type is Classic (10:30/11:00 UTC), not Outbound; share dialog title is "Share sequence" (CSS-capitalised "Share Sequence"); selecting Accounts shows a "Change module?" confirm (Proceed) and routes to /sales-sequences/sales_account/new; the list DOM snapshots in explore/pages/*/dom-snapshot.md were placeholders (no usable text).
**Evidence:** probes in this run; dom-snapshot.md files contain only one-line stubs.
**Suggested fix:** explore-agent should write real DOM text/data-test attributes (e.g. data-test-ss-save-btn, input.text-ellipsis for the name) into dom-snapshot.md.

## Finding 2: Substring row matching is dangerous for clone-copy names
**Summary:** A row selector by hasText on "<name>" also matches "<name> - Copy"; the first run's Edit test renamed the clone instead of the original. Fixed with exact-title matching (.sequence-title-text regex). Testcase-generator should warn about prefix-colliding names when a case clones.
**Evidence:** run2 screenshot showed "<name> edited" + original but no Copy row.
**Suggested fix:** Note exact-title matching in testcase preconditions for clone/edit cases.

## Finding 3: Leftover run-created sequences (cleanup incomplete)
**Summary:** Three ZZ-prefixed sequences from this track's failing intermediate runs were left in the tenant ("ZZ Seq 1791197171688 edited", "ZZ Seq 1791197508785 dup", "ZZ Seq 1791197508785 LLL..." 256 chars). A final scripted cleanup was denied by the permission classifier (scope not verifiable from a list-derived name file), so they need manual deletion. created-entities.json bookkeeping also has some entries not marked deleted that were in fact deleted.
**Evidence:** playwright-tests/freshsales/scratch/left.txt (list of rows at that time).
**Suggested fix:** Human delete these rows, then reconcile artifacts/.../sales-sequences/playwright/created-entities.json against the list.
