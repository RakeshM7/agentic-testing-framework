---
slug: open-quick-create-menu
title: Open the quick-create (+) menu
module: product
nav_path: + (top bar)
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the quick-create (+) menu.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings | Click button '+' in top bar | Menu: RECORDS (Add contact, Add account, Add deal, Add product, Add Quote), SALES ACTIVITIES (Add task, Add meeting, Add call log, Send SMS), EMAILS (Send email, Create template, Create sales sequence). No item was clicked. | product |
## Outcome
Menu opened and closed with Escape.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
