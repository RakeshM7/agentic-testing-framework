---
slug: trash-report
title: Move own report to trash
module: analytics
nav_path: Analytics > <report> > chevron > Move to trash
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Move own report to trash
## Preconditions
Org admin session.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | report-view-explore-qa | Click chevron-icon, then Move to trash | dialog 'Are you sure you want to move this report "Explore QA Report" to trash?' Cancel / Trash | report-view-explore-qa |
| 2 | report-view-explore-qa | Click Trash | redirected to /crm/sales/analytics (list) | analytics-landing |
## Outcome
See steps.
## Variations and errors
Cleanup of entity created this run. Soft delete: it remains in the Trash view (not opened, not permanently deleted).
## Cleanup
n/a
## Related flows
see flows/index.json
