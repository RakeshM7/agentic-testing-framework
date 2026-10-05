---
slug: contact-bulk-actions
title: Open bulk actions for selected contacts
module: contacts
nav_path: Contacts > select row > Bulk actions
kind: bulk
mutating: false
requires_mode: readonly
---
## Goal
Open bulk actions for selected contacts.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Tick row checkbox | Toolbar replaces header: Update field, Bulk email, Add tags, Add to sequence, Assign to, Add task, Add to power dialer list, More actions, Cancel bulk selection | contacts-row-selected |
| 2 | contacts-list | Choose a bulk action | not executed (would touch pre-existing records) |  |
## Outcome
With no selection "Bulk actions" opens no menu. Actions themselves unverified.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
