---
slug: open-deals-pipeline-view
title: Open the Deals pipeline (kanban) view
module: deals
nav_path: Deals
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the Deals pipeline (kanban) view.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. 
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deals | Click left-nav Deals | /crm/sales/deals redirects to /crm/sales/deals/view/402015942744 (All deals, Pipeline) | open-deals-pipeline-view |
## Outcome
Board with stages New, Qualification, Discovery, Demo, Negotiation, Won, Lost; weighted value per stage; default sort Deal value or Updated at.
## Variations and errors
See Outcome notes.
## Cleanup
n/a
## Related flows
open-deals-pipeline-view
