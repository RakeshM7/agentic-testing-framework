---
slug: select-saved-deal-view
title: Select a saved deal view
module: deals
nav_path: Deals > 13 more...
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Select a saved deal view.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. 
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deals | Click '13 more...' (or cmd+O) | 'Select a view' list with search and tabs All views / Default views / My views / Other views; 'Add new view' link | select-saved-deal-view |
| 2 | Deals | Click a view e.g. 'Recycle Bin' | View loads, tab added next to All deals | select-saved-deal-view |
## Outcome
Views: Open deals, My deals, My territory deals, Recent deals, Recently imported, Lost deals, Won deals, Hot deals, Cold deals, Closing this week, This month's sales, Recycle Bin, Deals with me in deal team.
## Variations and errors
See Outcome notes.
## Cleanup
n/a
## Related flows
open-deals-pipeline-view
