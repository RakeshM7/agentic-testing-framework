---
slug: switch-contact-view
title: Switch to another saved view (e.g. Recycle Bin)
module: contacts
nav_path: Contacts > 14 more...
kind: search-filter
mutating: false
requires_mode: readonly
---
## Goal
Switch to another saved view (e.g. Recycle Bin).
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Click "14 more..." (button) | Menu: Select a view; Default views: My contacts, My territory contacts, New contacts, Recently modified, Recently imported, Never contacted, Needs follow-up, Active, Inactive, Recycle Bin; also Add new view | contacts-views-menu |
| 2 | contacts-list | Click "Recycle Bin" | /contacts/view/402015942739; banner "The Recycle Bin stores deleted records for 90 days before deleting them forever"; 28 records at time of run | contacts-view-recycle-bin |
## Outcome
Recycle Bin lists deleted contacts incl. earlier AgentTest runs.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
