---
slug: create-account
title: Create an account
module: accounts
nav_path: Accounts > Add account
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create an account.
## Preconditions
Authenticated as Rakesh M (org admin) via session state.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click `Add account` > fill Name (required) > optional `Show all fields` reveals Phone, Sales owner (default Rakesh M), Business type > `Save` | Created `ModExplore Acct 0510` (Website www.modexplore-acct.com, Phone +18557476767); landed on /crm/sales/accounts/402012712600 Overview. Form has `Check for duplicates`, `Customize fields`, Cancel. Short form fields: Name*, Website, Industry type, Number of employees. Validation: empty Name -> `can't be empty` under the field and banner `Review 1 field for errors`; Website `not a url` -> toast `Failed to create Account. The value for website is not in required format.` (server side); Phone `abc` produced no error. | pages/ screenshots in this module |
## Outcome
Created `ModExplore Acct 0510` (Website www.modexplore-acct.com, Phone +18557476767); landed on /crm/sales/accounts/402012712600 Overview. Form has `Check for duplicates`, `Customize fields`, Cancel. Short form fields: Name*, Website, Industry type, Number of employees. Validation: empty Name -> `can't be empty` under the field and banner `Review 1 field for errors`; Website `not a url` -> toast `Failed to create Account. The value for website is not in required format.` (server side); Phone `abc` produced no error.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
Created entity ModExplore Acct 0510 removed via delete-account (soft delete to Recycle Bin).
## Related flows
create-account, delete-account, view-account-detail
