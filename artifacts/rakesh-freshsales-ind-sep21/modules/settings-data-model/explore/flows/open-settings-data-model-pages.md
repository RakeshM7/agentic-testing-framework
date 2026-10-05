---
slug: open-settings-data-model-pages
title: Reach each data-model settings page
module: settings-data-model
nav_path: Admin Settings > Leads, Contacts, & Accounts
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Reach each data-model settings page
## Preconditions
Admin role (observed: account owner, Rakesh M).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | settings-home | Click side-group "Leads, Contacts, & Accounts" | Lists 9 tiles | settings-home |
| 2 | settings-home | Click tile "Contacts" (link) | /crm/sales/settings/contacts/forms | contacts-forms |
| 3 | settings-home | Click tiles Accounts / Custom Modules / Contact Lifecycle Stages / Contact Scoring / Web Forms / CRM Code Library / LinkedIn Lead Gen Forms | URLs per sitemap.json | see sitemap |
| 4 | settings-home | Tile "Website Embed Code" | Leaves module: /crm/marketer/mas/#/settings/crm-tracking-code (not followed) | n/a |
## Outcome
All pages load.
## Variations and errors
See notes above; Save steps were not executed (permission denied by the auto-mode classifier for shared admin config).
## Cleanup
n/a (nothing created)
## Related flows
