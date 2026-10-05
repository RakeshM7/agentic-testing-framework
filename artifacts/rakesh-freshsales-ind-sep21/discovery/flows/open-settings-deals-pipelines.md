---
slug: open-settings-deals-pipelines
title: Open the Admin Settings group 'Deals & Pipelines'
module: settings
nav_path: Admin Settings > Deals & Pipelines
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
Open the Admin Settings group 'Deals & Pipelines'.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings | Click group heading 'Deals & Pipelines' | Right pane lists the group's settings links (e.g. /crm/sales/settings/deal_pipeline) | settings |
## Outcome
Group links visible.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
