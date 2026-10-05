---
slug: open-admin-settings
title: Open Admin Settings
module: admin-settings
nav_path: Admin Settings
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open Admin Settings.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | crm-home | Click link 'Admin Settings' (left nav listitem 'Admin Settings') | Lands on /crm/sales/settings, page title 'Admin Settings : Freshsales' | admin-settings |
## Outcome
The Admin Settings landing page is shown.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
