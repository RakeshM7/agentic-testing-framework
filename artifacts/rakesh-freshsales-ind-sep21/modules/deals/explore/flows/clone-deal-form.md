---
slug: clone-deal-form
title: Open the Clone deal form
module: deals
nav_path: Deals > <deal> > kebab > Clone
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open the Clone deal form.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail | Click kebab, 'Clone' | Slide-over 'Clone deal' with Deal name empty, products copied ('1 product added'), stage copied | clone-deal-form |
| 2 | Clone | Click Cancel | Closed without creating | clone-deal-form |
## Outcome
Save not executed (would create a record).
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
