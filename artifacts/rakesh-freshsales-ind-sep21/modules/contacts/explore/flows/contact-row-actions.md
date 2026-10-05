---
slug: contact-row-actions
title: Open row actions menu
module: contacts
nav_path: Contacts > row kebab
kind: read
mutating: false
requires_mode: readonly
---
## Goal
Open row actions menu.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Click row kebab (button) | Menu: Edit all fields, Add meeting, Add call log, Clone, Delete, Unsubscribe, Forget | contacts-row-actions-menu |
## Outcome
Items not executed.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
