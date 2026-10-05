---
slug: delete-task
title: Delete a task
module: sales-activities
nav_path: Dashboards > Activities Dashboard > row menu > Delete
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Delete a task.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activities-dashboard-tomorrow | Click row menu button, click 'Delete' | Dialog 'Delete' / 'Delete this task?' No / Yes (No tested, task kept) | activities-dashboard-tomorrow |
| 2 | activities-dashboard-tomorrow | Click 'Yes' | Toast 'You deleted the task.'; row gone | activities-dashboard-tomorrow |
## Outcome
See last step result.
## Variations and errors
Only ZZ Explore Task (created this run) deleted.
## Cleanup
n/a
## Related flows
