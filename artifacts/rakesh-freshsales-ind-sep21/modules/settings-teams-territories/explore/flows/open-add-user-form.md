---
slug: open-add-user-form
title: Open the Add user form (not saved)
module: settings-teams-territories
nav_path: Users > Add user
kind: create
mutating: true
requires_mode: readonly
---
## Goal
Open the Add user form (not saved).
## Preconditions
Admin role (Account Admin).
## Steps
| # | On page | Action | Result | Evidence |
|1|settings|Navigate via `Users > Add user`|Page/dialog opens|see pages/ screenshots|
## Outcome
Email* (enables rest), Full name*, Job title, Work number, Mobile number, Reporting to, Teams, Pipeline (default Default Pipeline), Role* options: Account Admin (CPQ enabled), Administrator, Sales Manager, Sales User, Restricted User. Buttons Cancel/Save. Other fields disabled until email entered.
## Variations and errors
Save step NOT executed (view-only run); validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
