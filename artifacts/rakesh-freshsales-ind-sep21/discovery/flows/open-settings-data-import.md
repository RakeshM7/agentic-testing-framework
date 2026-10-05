---
slug: open-settings-data-import
title: Open the Admin Settings group 'Data & Import'
module: settings
nav_path: Admin Settings > Data & Import
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
Open the Admin Settings group 'Data & Import'.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings | Click group heading 'Data & Import' | Right pane lists the group's settings links (e.g. /crm/sales/import-history) | settings |
## Outcome
Group links visible.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
