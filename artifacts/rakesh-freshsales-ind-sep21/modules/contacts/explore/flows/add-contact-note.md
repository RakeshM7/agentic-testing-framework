---
slug: add-contact-note
title: Start a note on a contact
module: contacts
nav_path: Contacts > <contact> > Overview > Add a note...
kind: create
mutating: false
requires_mode: readonly
---
## Goal
Start a note on a contact.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contact-detail | Click "Add a note..." and type text | Editor opens with button "Note about <name>"; not saved | contact-note-editing |
## Outcome
Save not executed.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
