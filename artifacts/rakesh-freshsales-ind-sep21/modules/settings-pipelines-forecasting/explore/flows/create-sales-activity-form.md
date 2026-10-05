---
slug: create-sales-activity-form
title: Open Create sales activity form (not saved)
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Sales Activities > Create sales activity
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open Create sales activity form (not saved).
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click button 'Create sales activity' | see Outcome | pages/ |
## Outcome
Drawer: name* ('Like Facebook chat'), icon picker (25 icons), checkboxes: mobile check in/out; show in My calendar; allow mark completed; allow edit completed date/time (disabled until previous checked); outcomes Interested, Left message, No response, Not able to reach, Not interested, 'Add outcome'; Cancel, Save. Cancelled.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
