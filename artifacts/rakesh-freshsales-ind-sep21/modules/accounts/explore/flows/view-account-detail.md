---
slug: view-account-detail
title: Open an account detail page and tabs
module: accounts
nav_path: Accounts > <account name>
kind: read
mutating: false
requires_mode: readonly
---
## Goal
Open an account detail page and tabs.
## Preconditions
Authenticated as Rakesh M (org admin) via session state. Needs an account created by flow create-account.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | see below | Click account name link > tabs Overview, Account details, Conversations, Activities, Contacts, Deals, Files, Freddy AI insights, Apps in marketplace | URLs /crm/sales/accounts/<id>?tab=overview|entity-card-detail|conversations|recent-activities|contacts|deals|files|freddy. Account details has View field edit history, Manage fields, Show empty fields. Conversations has Sales Emails & Activities, Call Logs. Activities has Notes, Tasks, Meetings, Create custom sales activity, filters. Contacts/Deals/Files empty states each with Add contact/Add deal/Add file. Freddy tab shows Possible duplicates (0), Possible connections (0). | pages/ screenshots in this module |
## Outcome
URLs /crm/sales/accounts/<id>?tab=overview|entity-card-detail|conversations|recent-activities|contacts|deals|files|freddy. Account details has View field edit history, Manage fields, Show empty fields. Conversations has Sales Emails & Activities, Call Logs. Activities has Notes, Tasks, Meetings, Create custom sales activity, filters. Contacts/Deals/Files empty states each with Add contact/Add deal/Add file. Freddy tab shows Possible duplicates (0), Possible connections (0).
## Variations and errors
See Result column; anything not listed was not observed.
## Cleanup
n/a
## Related flows
create-account, delete-account, view-account-detail
