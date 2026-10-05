---
slug: delete-quote
title: Delete a quote
module: products-quotes
nav_path: Quote detail > kebab > Delete
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Confirm: 'Delete this Quote? (You can retrieve it from the Recycle Bin. It remains there for 90 days.)'
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | quote-detail | Click kebab, then 'Delete' | Confirm dialog | quote-detail |
| 2 | quote-detail | Click 'Yes' | Redirect to Quotes list /crm/sales/cpq_documents/view/402015942782; toast 'Success: Quote deleted.' | quote-detail |
## Outcome
As in steps.
## Variations and errors
Deleted own quote ZZ Explore Quote 1.
## Cleanup
Entities created were deleted this run (see created-entities.json).
## Related flows
See flows/index.json.
