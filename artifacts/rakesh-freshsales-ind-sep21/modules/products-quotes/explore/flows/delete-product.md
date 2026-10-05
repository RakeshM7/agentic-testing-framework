---
slug: delete-product
title: Delete a product
module: products-quotes
nav_path: Products > <product> > kebab > Delete
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Confirm dialog: 'Delete this product and its related data? (You can retrieve it from the Recycle Bin. It remains there for 90 days.)' with No / Yes.
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | product-detail | Click kebab, then 'Delete' | Confirm dialog | product-detail |
| 2 | product-detail | Click 'Yes' | Product removed; list count decreases (All Products (3)) | product-detail |
## Outcome
As in steps.
## Variations and errors
Deleted ZZ Explore Product A and ZZ Explore Product B (edited), both created by this track.
## Cleanup
Entities created were deleted this run (see created-entities.json).
## Related flows
See flows/index.json.
