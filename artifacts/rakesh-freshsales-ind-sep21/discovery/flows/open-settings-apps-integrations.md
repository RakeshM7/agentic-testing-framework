---
slug: open-settings-apps-integrations
title: Open the Admin Settings group 'Apps & Integrations'
module: settings
nav_path: Admin Settings > Apps & Integrations
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
Open the Admin Settings group 'Apps & Integrations'.
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings | Click group heading 'Apps & Integrations' | Right pane lists the group's settings links (e.g. /crm/sales/settings/integrations/third-party-applications/view/all) | settings |
## Outcome
Group links visible.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
