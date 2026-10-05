---
slug: open-contacts-list
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
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | any | Click "Contacts" in left nav (link) | Lands on /crm/sales/contacts/view/402015942732?per_page=25&sort=lead_score, All contacts table | contacts-list |
## Outcome
Table shows Name, Account, Job title, Email, Mobile, Status, Tags, Sales owner; footer "Showing 1-2 of 2".
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
