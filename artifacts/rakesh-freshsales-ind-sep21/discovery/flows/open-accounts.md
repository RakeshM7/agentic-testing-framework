---
slug: open-accounts
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
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | crm-home | Click link 'Accounts' (left nav listitem 'Accounts') | Lands on /crm/sales/accounts/view/402015942758, page title 'Accounts : Freshsales' | accounts |
## Outcome
The Accounts landing page is shown.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
