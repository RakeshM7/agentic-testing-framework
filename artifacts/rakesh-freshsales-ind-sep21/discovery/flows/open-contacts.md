---
slug: open-contacts
title: Open the Contacts list
module: contacts
nav_path: Contacts
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the Contacts list.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | crm-home | Click link 'Contacts' (left nav listitem 'Contacts') | Lands on /crm/sales/contacts/view/402015942732, page title 'Contacts : Freshsales' | contacts |
## Outcome
The Contacts landing page is shown.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
