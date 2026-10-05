---
slug: add-forecast-category-form
title: Open Add forecast category form (not saved)
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Quotas and Forecasting > Add forecast category
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open Add forecast category form (not saved).
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click button 'Add forecast category' | see Outcome | pages/ |
## Outcome
Drawer: Name* ('Enter a name'), Description; Cancel, Save. Cancelled.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
