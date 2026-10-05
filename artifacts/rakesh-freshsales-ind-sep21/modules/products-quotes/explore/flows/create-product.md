---
slug: create-product
title: Create a product
module: products-quotes
nav_path: Products > Add product
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Product drawer with Name*, Category, Active, Pricing type* (One-time / Subscription), Currency, Unit price, Product code, SKU number, Owner, Valid till, Parent product...
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | products-list | Click button 'Add product' | Add product drawer opens | products-list |
| 2 | product-add-form | Fill Name, Unit price, Product code, SKU number; click 'Save' | Product created, appears in list | product-add-form |
## Outcome
As in steps.
## Variations and errors
Created in prior attempt (ZZ Explore Product A, $50 USD one-time, Software, ZZ-EXP-001, SKU-ZZ-1); deleted this run. Validation observed on clone form: empty Unit price -> 'Can't be empty'.
## Cleanup
Entities created were deleted this run (see created-entities.json).
## Related flows
See flows/index.json.
