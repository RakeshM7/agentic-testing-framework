---
slug: open-settings-leads-contacts-accounts
title: Open the Admin Settings group 'Leads, Contacts, & Accounts'
module: settings
nav_path: Admin Settings > Leads, Contacts, & Accounts
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
Open the Admin Settings group 'Leads, Contacts, & Accounts'.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings | Click group heading 'Leads, Contacts, & Accounts' | Right pane lists the group's settings links (e.g. /crm/sales/settings/contacts/forms) | settings |
## Outcome
Group links visible.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
