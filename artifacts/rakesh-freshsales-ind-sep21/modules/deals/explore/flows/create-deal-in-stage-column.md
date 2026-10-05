---
slug: create-deal-in-stage-column
title: Create a deal from a pipeline stage column
module: deals
nav_path: Deals > Pipeline > stage +
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create a deal from a pipeline stage column.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deals (pipeline) | Click '+' in the Qualification column header | Add deal slide-over with Deal stage = Qualification | create-deal-in-stage-column |
| 2 | Add deal | Fill Deal name 'ExploreDeals Deal 2', Deal value 300, click Save | Toast 'Deal added.'; card appears in Qualification column, count 2->3 | create-deal-in-stage-column |
## Outcome
Cleanup: deleted from card kebab > Delete > Yes.
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
