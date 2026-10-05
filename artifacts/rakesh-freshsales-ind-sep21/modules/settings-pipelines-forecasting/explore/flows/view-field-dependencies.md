---
slug: view-field-dependencies
title: View deal field dependencies
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Deals > Manage field dependencies
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View deal field dependencies.
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click link 'Manage field dependencies' | see Outcome | pages/ |
## Outcome
Four system-defined dependencies, all enabled: Pipeline->Deal stage, Deal stage->Lost reason, Deal stage->Closed date, Forecast category->Expected close date. Up to 100 dependencies allowed.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
