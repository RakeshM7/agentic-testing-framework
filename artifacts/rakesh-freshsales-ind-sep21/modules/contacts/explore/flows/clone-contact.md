---
slug: clone-contact
title: Open Clone contact form
module: contacts
nav_path: Contacts > <contact> > kebab > Clone
kind: create
mutating: false
requires_mode: readonly
---
## Goal
Open Clone contact form.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contact-detail | kebab > "Clone" | Drawer "CLONE CONTACT" with empty fields | contact-clone-form |
| 2 | drawer | Click "Cancel" | Closed without saving |  |
## Outcome
Save not executed.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
