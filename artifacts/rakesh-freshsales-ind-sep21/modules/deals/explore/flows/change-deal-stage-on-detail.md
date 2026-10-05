---
slug: change-deal-stage-on-detail
title: Change deal stage from the detail progress bar
module: deals
nav_path: Deals > <deal>
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Change deal stage from the detail progress bar.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail | Click stage 'Qualification' in stage bar | Toast 'Deal updated.'; bar highlights up to Qualification | change-deal-stage-on-detail |
## Outcome
Won/Lost dropdown: see mark-deal-lost.
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
