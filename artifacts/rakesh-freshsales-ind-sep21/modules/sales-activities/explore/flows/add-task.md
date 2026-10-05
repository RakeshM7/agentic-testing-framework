---
slug: add-task
title: Add a task from the Activities Dashboard
module: sales-activities
nav_path: Dashboards > Activities Dashboard > Add task
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Add a task from the Activities Dashboard.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activities-dashboard | Click 'Add task' | Dialog 'Add task': Mark as completed, Title*, Description, Task type (default Follow up), Due date* (default tomorrow, time), Outcome, Owner (Rakesh M), Related to (0), Collaborators (0) | activities-dashboard |
| 2 | add-task-dialog | Click 'Save' with empty title | Inline "can't be empty" under Title | add-task-dialog |
| 3 | add-task-dialog | Click 'Select an outcome' | Options: Interested, Left message, No response, Not interested, Not able to reach | add-task-dialog |
| 4 | add-task-dialog | Fill Title 'ZZ Explore Task', Save (no related record) | Toast 'Success / You added a task.' - Related to is NOT required for tasks | add-task-dialog |
## Outcome
See last step result.
## Variations and errors
Same dialog via + > Add task (menuitem). Cleanup via delete-task.
## Cleanup
Entity created this run was deleted (see created-entities.json).
## Related flows
