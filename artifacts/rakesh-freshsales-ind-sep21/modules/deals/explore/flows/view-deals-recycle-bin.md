---
slug: view-deals-recycle-bin
title: View the Recycle Bin
module: deals
nav_path: Deals > 13 more... > Recycle Bin
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View the Recycle Bin.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. 
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deals | Choose view 'Recycle Bin' | Pipeline of deleted deals with Restore link; shows ExploreDeals Deal 2 | view-deals-recycle-bin |
## Outcome
Restore not executed.
## Variations and errors
See Outcome notes.
## Cleanup
n/a
## Related flows
open-deals-pipeline-view
