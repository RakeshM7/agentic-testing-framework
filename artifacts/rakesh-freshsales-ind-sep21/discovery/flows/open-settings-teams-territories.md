---
slug: open-settings-teams-territories
title: Open the Admin Settings group 'Teams & Territories'
module: settings
nav_path: Admin Settings > Teams & Territories
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
Open the Admin Settings group 'Teams & Territories'.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings | Click group heading 'Teams & Territories' | Right pane lists the group's settings links (e.g. /crm/sales/settings/users/view/active) | settings |
## Outcome
Group links visible.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
