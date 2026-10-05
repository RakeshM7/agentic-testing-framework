---
slug: open-create-role-dialog
title: Open Create role dialog (not saved)
module: settings-teams-territories
nav_path: Roles > Create role
kind: create
mutating: true
requires_mode: readonly
---
## Goal
Open Create role dialog (not saved).
## Preconditions
Admin role (Account Admin).
## Steps
| # | On page | Action | Result | Evidence |
|1|settings|Navigate via `Roles > Create role`|Page/dialog opens|see pages/ screenshots|
## Outcome
Role name*, Select a role to clone*, data-scope radios All records (default) / Territory only / Group only / Owned only, Next. Closed via Close.
## Variations and errors
Save step NOT executed (view-only run); validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
