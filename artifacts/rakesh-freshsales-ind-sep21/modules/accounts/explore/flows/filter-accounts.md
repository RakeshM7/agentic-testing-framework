---
slug: filter-accounts
title: Filter accounts by Name
module: accounts
nav_path: Accounts > All accounts > Filter by
kind: search-filter
mutating: false
requires_mode: readonly
---
## Goal
Filter accounts by Name.
## Preconditions
Authenticated as Rakesh M (org admin) via session state.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click `Filter by` > `Add a field to filter` > `Name` > type >=2 chars (typeahead says `Please enter 2 or more characters`) > pick suggestion `acme inc (sample)` > `Apply` | Tab becomes `All accounts**` (unsaved), 1 filter applied, 1 row; URL /view/custom?q[]=...; buttons Reset and Save view as appear. Filterable fields: Business type, Industry type, Sales owner, Territory, Number of employees, Account team, Active sales sequences, Address, Annual revenue, City, Closed date, Completed sales sequences, Country, Created at, Created by, Deal pipeline, Deal stage, Expected close date, Import label, Last activity date/type, Last assigned at, Last contacted mode/time, Name, Open deals amount, Parent account, Phone, Probability (%), Products, State, Tags, Team, Updated at/by, Web forms, Website, Won deals amount, Zipcode. | pages/ screenshots in this module |
## Outcome
Tab becomes `All accounts**` (unsaved), 1 filter applied, 1 row; URL /view/custom?q[]=...; buttons Reset and Save view as appear. Filterable fields: Business type, Industry type, Sales owner, Territory, Number of employees, Account team, Active sales sequences, Address, Annual revenue, City, Closed date, Completed sales sequences, Country, Created at, Created by, Deal pipeline, Deal stage, Expected close date, Import label, Last activity date/type, Last assigned at, Last contacted mode/time, Name, Open deals amount, Parent account, Phone, Probability (%), Products, State, Tags, Team, Updated at/by, Web forms, Website, Won deals amount, Zipcode.
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
n/a
## Related flows
create-account, delete-account, view-account-detail
