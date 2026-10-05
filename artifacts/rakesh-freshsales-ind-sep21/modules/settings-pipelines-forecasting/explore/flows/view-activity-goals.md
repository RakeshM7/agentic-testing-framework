---
slug: view-activity-goals
title: View Activity Goals
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Activity Goals
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View Activity Goals.
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click tile 'Activity Goals' (leaves settings shell: /crm/sales/activity-goals/view/<id>) | see Outcome | pages/ |
## Outcome
'My goals (0)', empty state 'No activity goals found.', buttons 'Add goal' (split), 'Filters'.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
