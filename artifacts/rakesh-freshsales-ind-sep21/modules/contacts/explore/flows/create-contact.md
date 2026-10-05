---
slug: create-contact
title: Create a contact from the Contacts list
module: contacts
nav_path: Contacts > Add contact
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create a contact from the Contacts list.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Click "Add contact" (button) | Right drawer "Add contact" with Email, First name, Last name, Account, Job title, Mobile, buttons Show all fields / Check for duplicates / Cancel / Save | contacts-add-form |
| 2 | drawer | Click "Show all fields" | Adds Pick a label/Add email, Add more accounts, Work phone, Sales owner (default Rakesh M); toggle becomes "Show less fields" | contacts-add-form-all-fields |
| 3 | drawer | Click "Save" with Email empty | Banner "Review 1 field for errors"; Email: "You need to fill this field" | contacts-add-form-empty-save |
| 4 | drawer | Enter Email "not-an-email", Last name "x", click "Save" | Email: "Enter a valid email address" | contacts-add-form-invalid-email |
| 5 | drawer | Fill Email, First name "Explore", Last name, Job title "QA Explorer"; click "Check for duplicates" | Duplicates panel: "We check for exact matches in these fields: Email, Work email, Work phone, Mobile, Other phone numbers"; "No duplicates found."; "Back" returns to form | contacts-add-form-check-duplicates |
| 6 | drawer | Click "Save" | Redirect to /crm/sales/contacts/402221019096 (detail page); no toast text captured | contacts-after-create |
## Outcome
Contact created with Lifecycle stage Lead, status New, score 32, sales owner Rakesh M. Email is the only required field.
## Variations and errors
Validation messages listed in steps.
## Cleanup
Contact ExploreContact1791143638407 created then deleted in flow delete-contact (log: created-entities.json).
## Related flows
create-contact, view-contact-detail, delete-contact
