---
slug: customize-contacts-table
title: Open Customize table
module: contacts
nav_path: Contacts > Customize table
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
Open Customize table.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Click "Customize table" (button) | Panel: Search fields, "Fields visible in table 8/50", Name (Show display picture), 7 checked columns, Fields not shown (First name, Last name, Work phone, Source, Address, City, State, Country, Zipcode, Lifecycle stage, Score, Territory, ... Open deals amount, Won deals amount), Cancel/Apply | contacts-customize-table |
## Outcome
Apply not executed (would change table layout for user).
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
