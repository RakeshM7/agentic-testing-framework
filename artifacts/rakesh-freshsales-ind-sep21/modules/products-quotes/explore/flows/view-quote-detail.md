---
slug: view-quote-detail
title: View a quote document
module: products-quotes
nav_path: Quote > detail
kind: read
mutating: false
requires_mode: readonly
---
## Goal
Stage bar Draft > Sent to customer > Accepted/Declined; left panel fields (Deal locked, Quote number, Primary contact, Account, Valid till, Owner); document body with Products/Services table; buttons Edit, View activity, kebab, Preview, Save dropdown, Send to customer, switch 'Sync quote with deal'.
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | quote-detail | Click 'View activity' | Recent activity: 'Quote created' | quote-detail |
| 2 | quote-detail | Click 'Add or edit products' | Dialog 'The products you add below will determine the value of this deal.' with product picker; Cancelled, not saved | quote-detail |
## Outcome
As in steps.
## Variations and errors
Send to customer, Preview, PDF save/download, Clone, Forget not executed.
## Cleanup
n/a
## Related flows
See flows/index.json.
