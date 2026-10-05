---
slug: view-quotas-forecasting
title: View Quotas and Forecasting settings
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Quotas and Forecasting
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View Quotas and Forecasting settings.
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click tile 'Quotas and Forecasting' (/settings/sales-forecast) - page loads fine (earlier discovery note of an error was incorrect) | see Outcome | pages/ |
## Outcome
Toggle 'Enable Quotas and Forecasting' (on); categories Committed and Best-case (pencil only on Best-case); 'Select your default forecast category*' = Best-case; toggles Freddy AI deal insights (off) and Freddy AI commit suggestions. No quota entry UI on this page.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
