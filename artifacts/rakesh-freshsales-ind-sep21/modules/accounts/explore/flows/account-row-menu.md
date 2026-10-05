---
slug: account-row-menu
title: Open the account row kebab menu
module: accounts
nav_path: Accounts > row kebab
kind: read
mutating: false
requires_mode: readonly
---
## Goal
Open the account row kebab menu.
## Preconditions
Authenticated as Rakesh M (org admin) via session state.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click row `⋮` | Menu: Edit all fields, Add meeting, Add call log, View all related contacts, Clone, Delete, Forget. Not executed on pre-existing rows. | pages/ screenshots in this module |
## Outcome
Menu: Edit all fields, Add meeting, Add call log, View all related contacts, Clone, Delete, Forget. Not executed on pre-existing rows.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
n/a
## Related flows
create-account, delete-account, view-account-detail
