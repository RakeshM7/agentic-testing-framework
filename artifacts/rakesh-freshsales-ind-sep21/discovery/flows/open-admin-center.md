---
slug: open-admin-center
title: Open the Freshworks Admin Center
module: freshworks-admin-center
nav_path: Root URL /
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open the Freshworks Admin Center.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-center | Navigate to / | Admin Center: Users, My Subscriptions, Security, Organization, Audit Logs; account tile 'Freshworks CRM' -> /crm/sales | freshworks-admin-center |
## Outcome
Admin Center shown.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
