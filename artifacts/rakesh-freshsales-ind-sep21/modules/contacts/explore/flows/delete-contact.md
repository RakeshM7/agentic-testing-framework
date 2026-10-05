---
slug: delete-contact
title: Delete a contact
module: contacts
nav_path: Contacts > <contact> > kebab > Delete
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Delete a contact.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contact-detail | Click kebab then "Delete" | Confirm dialog: "Delete this contact and its related data? (You can retrieve it from the Recycle Bin. It remains there for 90 days.)" with No / Yes | contact-delete-confirm |
| 2 | dialog | Click "Yes" | Redirect to /contacts/view/402015942732; All contacts count back to 2 | contact-after-delete |
## Outcome
Soft delete to Recycle Bin. Cleanup: only own ExploreContact record deleted.
## Variations and errors
None observed beyond steps.
## Cleanup
Contact ExploreContact1791143638407 created then deleted in flow delete-contact (log: created-entities.json).
## Related flows
create-contact, view-contact-detail, delete-contact
