---
slug: add-product-to-deal
title: Add a product to a deal
module: deals
nav_path: Deals > <deal> > Add product
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Add a product to a deal.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail | Click 'Add product' | Slide-over 'Add or edit products': Currency, Name (search with category list: All, Consumables, Hardware, Software, Maintenance, Setup...), Price, Quantity, Discount, Subtotal, Add discount/fee, Total; 'Add new product' link | add-product-to-deal |
| 2 | Slide-over | Pick 'CRM - Gold plan monthly (sample)', click Save | Toast 'Products updated for this deal.'; Products tab shows unit price $100, quantity 1; deal value $100 | add-product-to-deal |
## Outcome
Cleanup: removed with deal.
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
