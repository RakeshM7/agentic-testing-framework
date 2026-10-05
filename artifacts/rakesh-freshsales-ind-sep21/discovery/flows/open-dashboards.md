---
slug: open-dashboards
title: Open Dashboards
module: dashboards
nav_path: Dashboards
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open Dashboards.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | crm-home | Click link 'Dashboards' (left nav listitem 'Dashboards') | Lands on /crm/sales/my_dashboards?tab=353503, page title 'Dashboards : Freshsales' | dashboards |
## Outcome
The Dashboards landing page is shown.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
