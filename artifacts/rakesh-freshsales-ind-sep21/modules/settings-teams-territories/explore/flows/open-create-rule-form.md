---
slug: open-create-rule-form
title: Open Create rule form (not saved)
module: settings-teams-territories
nav_path: Auto-assignment Rules > Create rule
kind: create
mutating: true
requires_mode: readonly
---
## Goal
Open Create rule form (not saved).
## Preconditions
Admin role (Account Admin).
## Steps
| # | On page | Action | Result | Evidence |
|1|settings|Navigate via `Auto-assignment Rules > Create rule`|Page/dialog opens|see pages/ screenshots|
## Outcome
Name prefilled 'Untitled rule - <date>', Apply rule to (module), condition builder (e.g. Lifecycle stage is in), Add group, Select users for assigning (round-robin; users/teams/territories). Cancel, Save as draft, Enable. Cancel used.
## Variations and errors
Save step NOT executed (view-only run); validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
