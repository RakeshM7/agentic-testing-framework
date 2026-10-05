---
slug: view-custom-modules-and-add-module-form
title: View Custom Modules and Add module form
module: settings-data-model
nav_path: Admin Settings > Custom Modules > Add module
kind: read
mutating: true
requires_mode: full-run
---
## Goal
View Custom Modules and Add module form
## Preconditions
Admin role (observed: account owner, Rakesh M).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | custom-modules | Open page | Empty state "No custom modules found." | custom-modules |
| 2 | custom-modules | Click "Add module" | Drawer: Module name (Singular)* (e.g. Property), Module name (Plural)*, Internal name* (cm_ prefix), Icon for your module* (icon grid, first preselected), Module description; Cancel/Save | add-module-overlay.png |
| 3 | custom-modules | Save | not executed (readonly effect: creation blocked) | n/a |
## Outcome
Create-module not completed.
## Variations and errors
See notes above; Save steps were not executed (permission denied by the auto-mode classifier for shared admin config).
## Cleanup
n/a (nothing created)
## Related flows
