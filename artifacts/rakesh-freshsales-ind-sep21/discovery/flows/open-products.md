---
slug: open-products
title: Open the Products list
module: products-quotes
nav_path: URL /crm/sales/products (no left-nav link)
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the Products list.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | any | Navigate to /crm/sales/products | Redirects to /crm/sales/products/view/402015942778?per_page=25; title 'Products : Freshsales' | products-quotes |
## Outcome
Products list shown.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
