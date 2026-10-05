---
slug: view-sales-activity-types
title: View sales activity types
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Sales Activities
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View sales activity types.
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click tile 'Sales Activities' (/settings/sales-activity-type) | see Outcome | pages/ |
## Outcome
Default activities Task, Meeting, Phone (each with 'Edit activity'), Email, Reminder, SMS, Chat.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
