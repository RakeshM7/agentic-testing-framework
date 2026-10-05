---
slug: edit-deal-all-fields
title: Edit a deal
module: deals
nav_path: Deals > <deal> > kebab > Edit
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Edit a deal.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail | Click kebab, then 'Edit' | Slide-over 'Edit deal': same fields plus Lost reason and Closed date when stage is Lost | edit-deal-all-fields |
| 2 | Edit | Change Deal name and Deal value, click Save | Page title updates to new name | edit-deal-all-fields |
## Outcome
Deal value is overridden by product total when products exist (value became $100 after adding a $100 product).
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
