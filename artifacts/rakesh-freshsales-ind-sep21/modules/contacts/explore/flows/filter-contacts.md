---
slug: filter-contacts
title: Open the Filter by panel
module: contacts
nav_path: Contacts > Filter by
kind: search-filter
mutating: false
requires_mode: readonly
---
## Goal
Open the Filter by panel.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Click "Filter by" (button) | Panel: Popular filters (Sales owner, Territory, Source) and Other filters (~70 fields, e.g. Lifecycle stage, Tags, Score, Created at). Filter was not applied. | contacts-filter-by |
## Outcome
Applying a filter was not exercised.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
