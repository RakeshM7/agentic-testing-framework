---
slug: view-accounts-list
title: Open the Accounts list
module: accounts
nav_path: Accounts
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the Accounts list.
## Preconditions
Authenticated as Rakesh M (org admin) via session state.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click left-nav Accounts | Lands on /crm/sales/accounts then redirects to view My accounts (/view/402015942758); 15 rows, columns Name, Related contacts, Website, Phone, Number of employees, Open deals amount, Tags, Industry type, Sales owner. | pages/ screenshots in this module |
## Outcome
Lands on /crm/sales/accounts then redirects to view My accounts (/view/402015942758); 15 rows, columns Name, Related contacts, Website, Phone, Number of employees, Open deals amount, Tags, Industry type, Sales owner.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
n/a
## Related flows
create-account, delete-account, view-account-detail
