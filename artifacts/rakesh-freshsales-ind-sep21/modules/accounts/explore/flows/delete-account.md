---
slug: delete-account
title: Delete an account (to Recycle Bin)
module: accounts
nav_path: Accounts > <account> > kebab > Delete
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Delete an account (to Recycle Bin).
## Preconditions
Authenticated as Rakesh M (org admin) via session state. Needs an account created by flow create-account.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click kebab > `Delete` > dialog `Delete this account? (You can retrieve it from the Recycle Bin. It remains there for 90 days.)` with checkbox `Delete all the related contacts and deals` > `Yes` | Only the account created this run was deleted. It then appears in the Recycle Bin view (banner `The Recycle Bin stores deleted records for 90 days before deleting them forever`). Recycle Bin had 2 rows: ours and a pre-existing AgentTest Co, which was not touched. Cleanup note: ours remains in the Recycle Bin (soft deleted); permanent delete not performed. | pages/ screenshots in this module |
## Outcome
Only the account created this run was deleted. It then appears in the Recycle Bin view (banner `The Recycle Bin stores deleted records for 90 days before deleting them forever`). Recycle Bin had 2 rows: ours and a pre-existing AgentTest Co, which was not touched. Cleanup note: ours remains in the Recycle Bin (soft deleted); permanent delete not performed.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
Created entity ModExplore Acct 0510 removed via delete-account (soft delete to Recycle Bin).
## Related flows
create-account, delete-account, view-account-detail
