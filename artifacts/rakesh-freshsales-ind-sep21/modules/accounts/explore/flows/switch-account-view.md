---
slug: switch-account-view
title: Switch between account views
module: accounts
nav_path: Accounts > N more...
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Switch between account views.
## Preconditions
Authenticated as Rakesh M (org admin) via session state.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click `N more...` (button) > pick a view | Views: My accounts, All accounts (15 rows), Recycle Bin, My territory accounts (0), Recently imported (0), Accounts with me in account team (0). View URLs /crm/sales/accounts/view/4020159427NN. | pages/ screenshots in this module |
## Outcome
Views: My accounts, All accounts (15 rows), Recycle Bin, My territory accounts (0), Recently imported (0), Accounts with me in account team (0). View URLs /crm/sales/accounts/view/4020159427NN.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
n/a
## Related flows
create-account, delete-account, view-account-detail
