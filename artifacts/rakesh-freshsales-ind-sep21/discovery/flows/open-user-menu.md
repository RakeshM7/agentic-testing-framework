---
slug: open-user-menu
title: Open the profile menu
module: product
nav_path: Avatar (top bar)
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the profile menu.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings | Click avatar 'R' | Menu shows Rakesh M, email, Personal settings | product |
## Outcome
Profile menu opened.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
