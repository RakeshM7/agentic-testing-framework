---
slug: create-report-from-gallery-template
title: Create a report with a Gallery template widget
module: analytics
nav_path: Analytics > New Report
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create a report with a Gallery template widget
## Preconditions
Org admin session.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | analytics-landing | Click New Report (button) | /analytics/reports/new/page/1, 'Untitled Report', empty canvas | report-builder-new |
| 2 | report-builder-new | Click Gallery (card) in ADD WIDGETS | GALLERY panel with Templates/Existing and entity dropdown | report-builder-new |
| 3 | report-builder-new | Select Deals in entity dropdown | template list for Deals | report-builder-new |
| 4 | report-builder-new | Drag 'TOTAL Deals grouped by Sales owner' heading to canvas | toast 'TOTAL Deals grouped by Sales owner added successfully!'; chart shows 15 for Rakesh M | report-builder-new |
| 5 | report-builder-new | Fill report name textbox with 'Explore QA Report' | name updated | report-builder-new |
| 6 | report-builder-new | Click Save (button) | URL /analytics/reports/MjM5NjUx/page/1 view mode with Export, Edit, star | report-view-explore-qa |
## Outcome
See steps.
## Variations and errors
Created entity logged in created-entities.json.
## Cleanup
Report trashed via trash-report flow
## Related flows
see flows/index.json
