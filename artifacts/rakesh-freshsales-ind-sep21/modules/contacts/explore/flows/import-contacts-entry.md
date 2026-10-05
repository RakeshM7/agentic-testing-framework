---
slug: import-contacts-entry
title: Inspect Import contacts entry
module: contacts
nav_path: Contacts > Import contacts caret
kind: import-export
mutating: false
requires_mode: readonly
---
## Goal
Inspect Import contacts entry.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Click caret next to "Import contacts" | Menu: View import history | contacts-import-caret |
| 2 | contacts-list | Click "Import contacts" | not executed (imports out of scope) |  |
## Outcome
Import wizard unverified.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
