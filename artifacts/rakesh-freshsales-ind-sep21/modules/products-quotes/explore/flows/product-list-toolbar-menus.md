---
slug: product-list-toolbar-menus
title: Open product list toolbar menus
module: products-quotes
nav_path: Products > toolbar
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Add product dropdown arrow: Import products, Import history (not opened). Gear: Pricing settings, Customize Product fields. Filters opens right panel with 'Add filter' and disabled 'Apply'. Row kebab: Clone, Delete.
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | products-list | Click Add product dropdown arrow | Menu: Import products, Import history | products-list |
| 2 | products-list | Click gear | Menu: Pricing settings, Customize Product fields | products-list |
| 3 | products-list | Click 'Filters' | Filters panel, empty state 'Add filters to narrow down the products you want to see.' | products-list |
## Outcome
As in steps.
## Variations and errors
None observed.
## Cleanup
n/a
## Related flows
See flows/index.json.
