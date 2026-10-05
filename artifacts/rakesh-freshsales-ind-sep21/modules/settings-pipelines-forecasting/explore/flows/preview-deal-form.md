---
slug: preview-deal-form
title: Preview the deal form
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Deals > Preview
kind: read
mutating: false
requires_mode: readonly
---
## Goal
Preview the deal form.
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click button 'Preview' | see Outcome | pages/ |
## Outcome
Drawer 'PREVIEW FOR DEAL FORM' with Basic information fields (Deal name*, Deal value*, Currency USD, Deal stage New, Sales owner default current user); buttons Customize fields, Show less fields, Close.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
