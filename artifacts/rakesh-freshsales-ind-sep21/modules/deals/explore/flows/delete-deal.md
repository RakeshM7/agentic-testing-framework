---
slug: delete-deal
title: Delete a deal (to Recycle Bin)
module: deals
nav_path: Deals > <deal> > kebab > Delete
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Delete a deal (to Recycle Bin).
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail or card kebab | Click 'Delete' | Confirm: 'Delete this deal and its related data? (You can retrieve it from the Recycle Bin. It remains there for 90 days.)' No/Yes | delete-deal |
| 2 | Confirm | Click 'Yes' | Redirects to deals list; deal count drops | delete-deal |
## Outcome
Soft delete; Recycle Bin card shows Restore and kebab with only 'Forget' (permanent; not used).
## Variations and errors
See Outcome notes.
## Cleanup
n/a
## Related flows
open-deals-pipeline-view
