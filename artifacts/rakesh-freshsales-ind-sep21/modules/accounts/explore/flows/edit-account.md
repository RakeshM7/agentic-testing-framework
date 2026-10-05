---
slug: edit-account
title: Edit an account
module: accounts
nav_path: Accounts > <account> > kebab > Edit
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Edit an account.
## Preconditions
Authenticated as Rakesh M (org admin) via session state. Needs an account created by flow create-account.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click kebab > `Edit` > change Name > `Save` | Name changed to `ModExplore Acct 0510 Edited`; page title updated. Banner `Updates available. Click to refresh.` appeared after edit. | pages/ screenshots in this module |
## Outcome
Name changed to `ModExplore Acct 0510 Edited`; page title updated. Banner `Updates available. Click to refresh.` appeared after edit.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
Created entity ModExplore Acct 0510 removed via delete-account (soft delete to Recycle Bin).
## Related flows
create-account, delete-account, view-account-detail
