---
slug: add-quote
title: Create a quote from the + menu
module: products-quotes
nav_path: Quick-create (+) > Add Quote
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Add quote drawer: Deal*, Primary contact*, Account, Quote type* (default Quote), Quote name, Quote template*; Show all fields adds Quote value, Quote currency, Quote stage (Draft), Valid till, shipping/billing addresses. Choosing a Deal auto-fills Quote name '<deal> - Quote' and currency USD.
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | deals | Click header + button, then 'Add Quote' | Add quote drawer | deals |
| 2 | quote-add-form | Click 'Save' empty | Can't be empty under Deal, Primary contact, Quote template | quote-add-form |
| 3 | quote-add-form | Pick Deal (search 'AgentTest Deal'), Primary contact (AgentTest Lead...), Quote template 'Sample Template', Quote name 'ZZ Explore Quote 1'; click 'Save' | Lands on /crm/sales/cpq_documents/<id>?dealId=<id>, quote DOC-3, stage Draft | quote-add-form |
## Outcome
As in steps.
## Variations and errors
Created ZZ Explore Quote 1 attached to pre-existing AgentTest Deal 1791131105076 (only the quote was created); deleted.
## Cleanup
Entities created were deleted this run (see created-entities.json).
## Related flows
See flows/index.json.
