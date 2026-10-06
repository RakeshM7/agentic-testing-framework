---
source_agent: playwright-automation-agent
date: 2026-10-06
target: rakesh-freshsales-ind-sep21
related_files:
  - playwright-tests/freshsales/pages/analytics/AnalyticsPage.ts
  - playwright-tests/freshsales/tests/functional/analytics/
  - artifacts/rakesh-freshsales-ind-sep21/modules/analytics/testcases/analytics-testcases.csv
severity: medium
---

## Finding 1: Analytics is a cross-origin iframe; explore DOM capture was too thin to write locators
**Summary:** The whole Analytics UI lives in an iframe (freshworkscrm-ind.freshreports.com) and explore saved no DOM text for it. All locators had to be discovered live with read-only probes (`page.frameLocator('iframe[src*="freshreports"]')`, `ariaSnapshot()`).
**Suggested fix:** explore-agent should record per-iframe aria snapshots and note the frame selector; report builder needs a real mouse drag (page.mouse down/move/up) for the Gallery widget.

## Finding 2: Test-case/clarification expectations that diverge from the live tenant
- TC-019 expects Trash retention "4w 2d"; live Trash shows "180 Days" and "Reports are stored in trash for 180 days before getting deleted permanently."
- TC-002 expects 7 Curated reports; live has 8 (adds Sales Essentials Dashboard).
- TC-030: saving with the default name "Untitled Report" is blocked (no report created). TC-029: a 300-character name is accepted. TC-028: duplicate names are allowed. TC-027: empty name blocked.
- Curated report header menu offers only Report Details and Clone Report (no Move to trash), answering OQ3 in part.
- TC-008: the Schedules settings page lists one row per report that has schedules, so the "You haven't configured any schedules." empty state is only valid when no schedules exist.
- Favorites view: first observed empty ("Add Favorites Here!") immediately after starring; in the final run the report was listed. Treat Favorites listing as eventually-consistent.
- Schedule Save in the right-hand panel can take several seconds or swallow the first click; the spec retries Save while watching for the POST /reportgroups/<id>/schedule response. Changing "Send Report" frequency rewrites Subject, so set Subject after the frequency.

## Finding 3: Permission layer blocked an ad hoc probe that clicked "Save Attribute" with empty fields
**Summary:** A read-only discovery script that included submitting the empty New Attribute form was denied (shared-resource modification). TC-033 is therefore skipped, not executed. Persona suggestion: say explicitly that discovery probes may open forms but must not submit them.

## Finding 4: Shared-config suggestion
Parallel tracks should each pass `--output=test-results-<trackSlug>` (done here) and shared `utils/createdEntities.ts`/`playwright.config.ts` should expose an outputDir env override.
