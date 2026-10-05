---
slug: clone-account
title: Open Clone account form
module: accounts
nav_path: Accounts > <account> > kebab > Clone
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open Clone account form.
## Preconditions
Authenticated as Rakesh M (org admin) via session state. Needs an account created by flow create-account.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click kebab > `Clone` | Drawer prefilled with the same name. Cancelled; not saved (duplicate-name behavior unverified). | pages/ screenshots in this module |
## Outcome
Drawer prefilled with the same name. Cancelled; not saved (duplicate-name behavior unverified).
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
Created entity ModExplore Acct 0510 removed via delete-account (soft delete to Recycle Bin).
## Related flows
create-account, delete-account, view-account-detail
