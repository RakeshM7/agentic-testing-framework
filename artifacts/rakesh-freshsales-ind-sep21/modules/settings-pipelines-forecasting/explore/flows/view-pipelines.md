---
slug: view-pipelines
title: View pipelines and stages
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Pipelines
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View pipelines and stages.
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click tile 'Pipelines' (/crm/sales/settings/deal_pipeline) | see Outcome | pages/ |
## Outcome
One pipeline 'Default Pipeline' (Set as default pipeline; Deals go stale after 30 days). Stages/probability: New 20, Qualification 30, Discovery 40, Demo 60, Negotiation 80, Won 100, Lost 0.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
