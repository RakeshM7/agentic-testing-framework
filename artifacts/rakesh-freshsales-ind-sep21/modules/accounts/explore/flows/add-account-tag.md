---
slug: add-account-tag
title: Add a tag to an account
module: accounts
nav_path: Accounts > <account> > Click to add tags
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Add a tag to an account.
## Preconditions
Authenticated as Rakesh M (org admin) via session state. Needs an account created by flow create-account.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click `Click to add tags` | Opens Tags select (choose existing) with Cancel/Save. Typing a new tag name + Enter did not create one; cancelled. Unverified whether free-text tags are possible. | pages/ screenshots in this module |
## Outcome
Opens Tags select (choose existing) with Cancel/Save. Typing a new tag name + Enter did not create one; cancelled. Unverified whether free-text tags are possible.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
Created entity ModExplore Acct 0510 removed via delete-account (soft delete to Recycle Bin).
## Related flows
create-account, delete-account, view-account-detail
