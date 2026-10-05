---
source_agent: playwright-automation-agent
date: 2026-10-05
target: rakesh-freshsales-ind-sep21
related_files:
  - playwright-tests/freshsales/playwright.config.ts
  - artifacts/rakesh-freshsales-ind-sep21/modules/sales-activities/testcases/sales-activities-testcases.csv
  - playwright-tests/freshsales/tests/functional/sales-activities/related-activities.spec.ts
severity: medium
---

## Finding 1: Shared test-results/ dir is wiped by parallel tracks
**Summary:** Tracks running `playwright test` concurrently share `playwright-tests/freshsales/test-results/`; one track's run deletes another's traces/screenshots mid-run.
**Evidence:** Visual spec failed with `browserContext.close: ENOENT ... test-results/.playwright-artifacts-1/traces/...recording22.trace`; failure screenshots/error-context vanished between runs.
**Suggested fix:** Make `outputDir` configurable via env (e.g. `PW_OUTPUT_DIR`) in the shared config, or have orchestrator pass `--output=test-results-<trackSlug>` to each track. This track used `--output=test-results-sales-activities`.

## Finding 2: Test-case expectations that diverge from live behavior
**Summary:** TC-005 says Cancel on the "You marked the task complete" dialog keeps the task open and Save completes it; live, the task is completed either way (dialog only collects optional outcome/description), as explore flow complete-task.md recorded. Also TC-017 etc. assume Related to for the custom-activity form is a button; it is an ember power-select multi-input (first `input.ember-power-select-trigger-multiple-input` in the dialog).
**Evidence:** Row showed "Completed" after Cancel; spec adjusted.
**Suggested fix:** testcase-generator-agent should treat explore flow rows as ground truth for post-Cancel state.

## Finding 3: Call-log Save swallows first click
**Summary:** In the Add call log panel, the first Save click after choosing a record in the Name combobox only blurs the field; no POST is issued. A second click submits (POST /crm/sales/phone_calls 201).
**Evidence:** Network log showed no non-GET request after first click. Spec retries the click until the dialog closes.
**Suggested fix:** Note in the explore flow open-add-call-log-form.md that Save needs two clicks after the Name picker.
