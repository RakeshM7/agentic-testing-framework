---
slug: sort-contacts-column
title: Open a column sort menu
module: contacts
nav_path: Contacts > Name column dropdown
kind: search-filter
mutating: false
requires_mode: readonly
---
## Goal
Open a column sort menu.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Click dropdown button in "Name" column header | Menu: Sort ascending A to Z, Sort descending Z to A, Add column to the right, Edit all columns, Add as filter | contacts-sort-name-menu |
## Outcome
Sort was not applied.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
