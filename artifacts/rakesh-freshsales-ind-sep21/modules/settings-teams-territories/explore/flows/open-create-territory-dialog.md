---
slug: open-create-territory-dialog
title: Open Create territory dialog (not saved)
module: settings-teams-territories
nav_path: Territories > Create territory
kind: create
mutating: true
requires_mode: readonly
---
## Goal
Open Create territory dialog (not saved).
## Preconditions
Admin role (Account Admin).
## Steps
| # | On page | Action | Result | Evidence |
|1|settings|Navigate via `Territories > Create territory`|Page/dialog opens|see pages/ screenshots|
## Outcome
Territory name*, Description, Parent territory (disabled until hierarchy enabled), Child territories (disabled), Add users/teams; Save disabled until valid. Cancel used.
## Variations and errors
Save step NOT executed (view-only run); validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
