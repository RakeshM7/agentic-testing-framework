---
slug: view-deal-fields
title: View deal fields
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Deals
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View deal fields.
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click tile 'Deals' (/settings/deals/forms) | see Outcome | pages/ |
## Outcome
One group 'Basic information': Related contact, Related account, Deal type, Deal name (required, locked), Currency, Deal value (required, locked), Pipeline (children Deal stage, Lost reason, Closed date), Sales owner. Per-field checkboxes Required/Quick-add/Read-only; toggles Enable deal images (on), Make adding products to deals mandatory (off).
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
