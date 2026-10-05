---
slug: edit-custom-sales-activity-type
title: Rename a custom sales activity type
module: sales-activities
nav_path: Admin Settings > Deals & Pipelines > Sales Activities > Edit activity
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Rename a custom sales activity type.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activity-types | Click 'Edit activity' on custom row | Overlay 'edit sales activity', name editable | activity-types |
| 2 | activity-types | Change name to 'ZZ Explore Activity Renamed', click 'Save' | Toast 'Success / You updated the sales activity.' | activity-types |
## Outcome
See last step result.
## Variations and errors
Default activity edit (Task) opened and cancelled: name disabled; has 'List down the types of tasks' (Follow up, Call reminder + Add type), checkboxes, outcomes.
## Cleanup
Entity created this run was deleted (see created-entities.json).
## Related flows
