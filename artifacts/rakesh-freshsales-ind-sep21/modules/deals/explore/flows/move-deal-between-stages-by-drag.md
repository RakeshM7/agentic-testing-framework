---
slug: move-deal-between-stages-by-drag
title: Move a deal to another stage by dragging its card
module: deals
nav_path: Deals > Pipeline
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Move a deal to another stage by dragging its card.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deals (pipeline) | Drag card 'ExploreDeals Deal 2' from Qualification to Discovery | Card moves; counts Qualification 2, Discovery 2 and weighted values update | move-deal-between-stages-by-drag |
## Outcome
Only performed on own deal.
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
