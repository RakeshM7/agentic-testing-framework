---
slug: open-settings-account-settings
title: Open the Admin Settings group 'Account Settings'
module: settings
nav_path: Admin Settings > Account Settings
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
Open the Admin Settings group 'Account Settings'.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings | Click group heading 'Account Settings' | Right pane lists the group's settings links (e.g. /crm/sales/settings/account-settings) | settings |
## Outcome
Group links visible.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
