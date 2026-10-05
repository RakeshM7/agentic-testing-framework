---
slug: delete-custom-sales-activity-type
title: Delete a custom sales activity type
module: sales-activities
nav_path: Admin Settings > Deals & Pipelines > Sales Activities
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Delete a custom sales activity type.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activity-types | Click unlabeled delete button at right of custom row | Confirm dialog: "If you delete this activity, data you've collected from this activity will also be deleted permanently." / 'Delete this activity?' with No / Yes | activity-types |
| 2 | activity-types | Click 'Yes' | Toast 'You deleted the sales activity.' | activity-types |
## Outcome
See last step result.
## Variations and errors
Only entity created this run (ZZ Explore Activity Renamed) was deleted.
## Cleanup
n/a
## Related flows
