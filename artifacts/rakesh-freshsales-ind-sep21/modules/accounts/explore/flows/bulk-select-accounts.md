---
slug: bulk-select-accounts
title: Open Bulk actions toolbar
module: accounts
nav_path: Accounts > Bulk actions
kind: bulk
mutating: false
requires_mode: readonly
---
## Goal
Open Bulk actions toolbar.
## Preconditions
Authenticated as Rakesh M (org admin) via session state.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click `Bulk actions` | Selects every row on the page (toast `15 accounts selected.`) and shows Update field, Add tags (+dropdown), Add to sequence (+dropdown), Assign to, Merge, Delete, Cancel. WARNING: it select-alls immediately. No action executed; page reloaded. The Cancel button is clipped when the Filters drawer is open. | pages/ screenshots in this module |
## Outcome
Selects every row on the page (toast `15 accounts selected.`) and shows Update field, Add tags (+dropdown), Add to sequence (+dropdown), Assign to, Merge, Delete, Cancel. WARNING: it select-alls immediately. No action executed; page reloaded. The Cancel button is clipped when the Filters drawer is open.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
n/a
## Related flows
create-account, delete-account, view-account-detail
