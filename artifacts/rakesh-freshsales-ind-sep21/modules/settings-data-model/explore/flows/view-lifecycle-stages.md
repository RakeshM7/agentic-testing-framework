---
slug: view-lifecycle-stages
title: View lifecycle stages and add-stage form
module: settings-data-model
nav_path: Admin Settings > Contact Lifecycle Stages
kind: read
mutating: true
requires_mode: full-run
---
## Goal
View lifecycle stages and add-stage form
## Preconditions
Admin role (observed: account owner, Rakesh M).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | lifecycle-stages | Open page | Active stages: Lead (New, Contacted, Interested, Unqualified), Sales Qualified Lead (Qualified, Lost), Customer (Won, Churned); toggles on Lead and Sales Qualified Lead; rules: 'Whenever a deal is added, change contact's stage to Sales Qualified Lead', 'Whenever a deal is won, change contact's stage to Customer' (both checked) | lifecycle-stages |
| 2 | lifecycle-stages | Click "Add lifecycle stage" | Drawer: Lifecycle stage name*, Statuses for this stage* (2 rows, second tagged "Closed Lost"), "Add status", Cancel/Save | add-stage-overlay.png |
## Outcome
Add stage Save not executed.
## Variations and errors
See notes above; Save steps were not executed (permission denied by the auto-mode classifier for shared admin config).
## Cleanup
n/a (nothing created)
## Related flows
