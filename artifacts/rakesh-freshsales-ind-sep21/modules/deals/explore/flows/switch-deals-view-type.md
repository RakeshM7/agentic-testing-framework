---
slug: switch-deals-view-type
title: Switch between Pipeline, Table, Forecast and Group by
module: deals
nav_path: Deals > Pipeline/Table menu
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Switch between Pipeline, Table, Forecast and Group by.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. 
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deals | Click button 'Pipeline' (view type) | Menu: Table, Pipeline, Forecast, Group by | switch-deals-view-type |
| 2 | Deals | Click 'Table' | Table with columns Deal name, Products, Deal value, Deal stage, Expected close date, Sales owner, Pipeline, Related account, Next activity; 17 of 17, 25 per page | switch-deals-view-type |
| 3 | Deals | Click 'Forecast' | Forecast board by month (Sep/Oct/Nov 2026 ...), 'By month'/'By quarter' toggle, year selector; 12 deals $32.8K | switch-deals-view-type |
| 4 | Deals | Hover 'Group by' | Fields: Forecast category, Territory, Deal type, Sales owner, Payment status | switch-deals-view-type |
## Outcome
View type changes; table is default after the first selection.
## Variations and errors
See Outcome notes.
## Cleanup
n/a
## Related flows
open-deals-pipeline-view
