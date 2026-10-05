---
slug: add-task-to-deal
title: Add a task to a deal
module: deals
nav_path: Deals > <deal> > Task
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Add a task to a deal.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail | Click 'Task' | Slide-over 'Add task': Mark as completed, Title*, Description, Task type, Due date* (default tomorrow), Outcome, Owner, Related to, Collaborators | add-task-to-deal |
| 2 | Add task | Click Save with empty title | Inline 'Can't be empty' | add-task-to-deal |
| 3 | Add task | Enter title 'ExploreDeals Task 1', Save | Task created; URL ?tab=recent-activities.tasks | add-task-to-deal |
## Outcome
Removed with parent deal delete.
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
