---
slug: edit-product
title: Edit a product
module: products-quotes
nav_path: Products > <product> > pencil
kind: update
mutating: true
requires_mode: full-run
---
## Goal
EDIT PRODUCT drawer; Pricing type radios are disabled (cannot be changed after creation).
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | product-detail | Click pencil button | EDIT PRODUCT drawer | product-detail |
| 2 | product-clone-form | Clear Name; click 'Save' | 'Review 1 field for errors' banner; Name shows 'Can't be empty' | product-clone-form |
| 3 | product-clone-form | Type 'ZZ Explore Product B (edited)'; click 'Save' | Toast 'Success: Product updated.'; drawer shows new name, Updated by Rakesh M | product-clone-form |
## Outcome
As in steps.
## Variations and errors
Edited a product created in this run.
## Cleanup
Entities created were deleted this run (see created-entities.json).
## Related flows
See flows/index.json.
