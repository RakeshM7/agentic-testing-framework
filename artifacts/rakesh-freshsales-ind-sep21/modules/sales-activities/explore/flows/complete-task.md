---
slug: complete-task
title: Mark a task complete
module: sales-activities
nav_path: Dashboards > Activities Dashboard > row > Mark complete
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Mark a task complete.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activities-dashboard-tomorrow | Set Due date filter to Tomorrow, click 'Mark complete' on ZZ Explore Task | Dialog 'You marked the task complete. You can also add an outcome and a description.' with Add outcome, Description, Cancel, Save; Cancel clicked; row shows 'Completed' with tooltip Due on / Completed on | activities-dashboard-tomorrow |
## Outcome
See last step result.
## Variations and errors
Row menu on open tasks: Add outcome, Snooze, Delete; on completed: Add outcome, Snooze, Delete.
## Cleanup
Entity created this run was deleted (see created-entities.json).
## Related flows
