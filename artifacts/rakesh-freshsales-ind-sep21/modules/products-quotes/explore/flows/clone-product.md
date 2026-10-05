---
slug: clone-product
title: Clone a product
module: products-quotes
nav_path: Products > row kebab or product drawer kebab > Clone
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Clone form pre-fills Name, Category, Active, Product code, SKU, Owner; Unit price is NOT copied and is required.
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | products-list | Click product name link | Product drawer opens | products-list |
| 2 | product-detail | Click kebab, then listitem 'Clone' | CLONE PRODUCT drawer | product-detail |
| 3 | product-clone-form | Click 'Save' with empty Unit price | Unit price shows red 'Can't be empty'; not saved | product-clone-form |
| 4 | product-clone-form | Set Name 'ZZ Explore Product B (clone)', Unit price 75, Product code ZZ-EXP-002; click 'Save' | Toast 'Success: Product cloned.'; list shows 5 products (list needs reload to refresh) | product-clone-form |
## Outcome
As in steps.
## Variations and errors
Name and Product code are copied as-is (duplicates allowed in form; not tested if blocked).
## Cleanup
Entities created were deleted this run (see created-entities.json).
## Related flows
See flows/index.json.
