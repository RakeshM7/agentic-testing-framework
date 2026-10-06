---
source_agent: playwright-automation-agent
date: 2026-10-06
target: rakesh-freshsales-ind-sep21
related_files:
  - artifacts/rakesh-freshsales-ind-sep21/modules/settings-data-model/testcases/settings-data-model-testcases.csv
  - playwright-tests/freshsales/pages/settings-data-model/SettingsPage.ts
  - playwright-tests/freshsales/tests/functional/settings-data-model/
severity: medium
---

## Finding 1: Admin-config saves were NOT denied this time
The explore-agent's Save on a ZZ-Explore contact field was denied by the permission classifier, but under an explicit user-set `full-run` the suite's field/tag/stage/web-form/contact create+delete flows ran normally. Cases 005/006/011/014/019 etc. are no longer "unverified (Save not executed)"; the testcase CSV confidence column should be refreshed from `playwright/created-entities.json` and the run report.

## Finding 2: Live behaviour differs from clarification/testcase expectations
- TC-040 (contact with only Mobile): Add contact shows "You need to fill this field" under Email and does not save. Clarification says any one of Email / Mobile / External ID suffices. Test kept failing as a genuine deviation. External ID is not on the Add contact form (TC-041 skipped).
- TC-043 (delete a stage that has contacts): after deleting the stage the contact's Lifecycle stage header renders blank, not "Lead" as clarified. Test kept failing.
- TC-042: custom (run-created) stages have no enable/disable toggle; only seeded Lead / Sales Qualified Lead do. Case is not automatable without touching seeded config (skipped).
- TC-031/032: duplicate internal name and an internal name with spaces are rejected client-side ("No spaces allowed" for spaces). TC-030 (duplicate label "Job title") is rejected. TC-033: internal name `email` is accepted (cf_ prefix avoids the clash with seeded `emails`). TC-034: not limited at 3 fields. TC-036: a duplicate status name across stages silently blocks the save with no message. TC-037: no web-form limit at 2.
- Web form Save is blocked until the auto-added hidden "Lifecycle stage" field gets a default value ("can't be empty"); the Add web form builder also renders blank on first load about 1 in 3 times (reload fixes it).

## Finding 3: Ember editor false positives (persona hard rule suggestion)
The Contacts field editor adds a new row optimistically even when client-side validation then blocks the save (form still open, "No spaces allowed"). A row appearing in the list is therefore NOT proof of a save: assert on the drawer closing, then confirm after a reload. Likewise `locator.isVisible({ timeout })` ignores the timeout (a confirm dialog that opens late was missed, leaving a created web form undeleted); use `waitFor` for confirm dialogs. Success toasts are too brief to assert on (two flaky failures); use post-save navigation/URL (web form `.../classic/<id>/edit`) instead.

## Finding 4: Persona guidance gap
Per-test cleanup alone was not enough once a test failed mid-way (leftover ZZ-Explore rows then broke later cases); every mutating describe needs an `afterAll` safety net that deletes only prefix-matched, run-created entities. Also `test.describe.serial` makes one failure skip every later independent case; use serial only for genuinely chained steps.

## Finding 5: Custom modules cannot be deleted
No documented delete for a custom module; TC-009/035 were skipped by design to avoid a permanent tenant leftover (per the run brief).
