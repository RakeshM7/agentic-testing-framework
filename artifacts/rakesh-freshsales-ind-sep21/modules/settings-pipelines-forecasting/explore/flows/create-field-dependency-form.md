---
slug: create-field-dependency-form
title: Open Create dependency form (not saved)
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Deals > Manage field dependencies > Create dependency
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open Create dependency form (not saved).
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click button 'Create dependency' | see Outcome | pages/ |
## Outcome
Drawer: 'Choose a controlling field'*, 'Choose a dependent field'*, mapping panes; Cancel, 'Save and add new', Save. Cancelled.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
