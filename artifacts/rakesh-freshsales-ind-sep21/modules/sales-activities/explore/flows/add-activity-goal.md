---
slug: add-activity-goal
title: Create an activity goal
module: sales-activities
nav_path: Dashboards > Activities Dashboard > View activity goals > Add goal
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create an activity goal.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activity-goals | Navigate via 'View activity goals' link (redirects to /crm/sales/activity-goals/view/<id>); click 'Add goal' | Dialog 'Add goal': Goal period* (Weekly default/Monthly/Quarterly/Yearly), time range, Dates, Goal type* (User goal), Select users*, Activity to be completed*, Outcome (Any outcome), Activity target* (100) | activity-goals |
| 2 | add-goal-dialog | Click 'Save' empty | "can't be empty" on Select users | add-goal-dialog |
| 3 | add-goal-dialog | Select 'Rakesh M', choose activity 'ZZ Explore Activity', Save | Toast 'You added a goal.'; row Weekly 10/04/2026 - 10/10/2026, 0 / 100 0% | add-goal-dialog |
## Outcome
See last step result.
## Variations and errors
Cleanup via delete-activity-goal.
## Cleanup
Entity created this run was deleted (see created-entities.json).
## Related flows
