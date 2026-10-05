---
slug: update-contact
title: Edit a contact
module: contacts
nav_path: Contacts > <contact> > kebab > Edit
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Edit a contact.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contact-detail | Click kebab (top right) then "Edit" | Edit drawer titled "EDIT CONTACT - <name>" with all fields | contact-edit-form |
| 2 | drawer | Change Job title to "QA Explorer Updated"; click "Save" | Drawer closes, stays on detail URL, new job title shown | contact-after-edit |
## Outcome
Done on own entity.
## Variations and errors
None observed beyond steps.
## Cleanup
Contact ExploreContact1791143638407 created then deleted in flow delete-contact (log: created-entities.json).
## Related flows
create-contact, view-contact-detail, delete-contact
