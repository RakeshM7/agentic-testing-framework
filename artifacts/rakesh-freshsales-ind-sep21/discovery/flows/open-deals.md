---
slug: open-deals
title: Open the Deals pipeline
module: deals
nav_path: Deals
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the Deals pipeline.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | crm-home | Click link 'Deals' (left nav listitem 'Deals') | Lands on /crm/sales/deals/view/402015942744, page title 'Deals : Freshsales' | deals |
## Outcome
The Deals landing page is shown.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
