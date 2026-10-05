---
slug: mark-deal-lost
title: Mark a deal Won or Lost
module: deals
nav_path: Deals > <deal> > Won/Lost
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Mark a deal Won or Lost.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail | Click 'Won/Lost' stage dropdown | Options Won, Lost | mark-deal-lost |
| 2 | Deal detail | Click 'Lost' | Modal 'Add more details': Deal stage, Lost reason (Click to select), Closed date | mark-deal-lost |
| 3 | Modal | Click Save with Lost reason empty | Toast 'Deal updated.'; stage bar turns red; Closed date 'Closed today' | mark-deal-lost |
## Outcome
Lost reason is not required in the modal; Won deals use the same modal (not run).
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
