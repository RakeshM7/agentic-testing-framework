---
slug: view-cpq-settings
title: Open CPQ Settings
module: products-quotes
nav_path: Products > gear > Pricing settings (or Admin Settings > CPQ Settings)
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
/crm/sales/settings/cpq: Products section (Pricing settings radios One-time/Subscription/Both, all disabled; Both selected: 'Once you select Both, you cannot change the pricing type'; 'Add products to deals' checked: deal value becomes read-only and recalculates), Taxes (on, Sales tax 0 %, 'Include tax in deal value' unchecked), Quotes (on; Quote types: Quote, Proposal, Non-disclosure agreement, Master service agreement; 'Add Quote type'). Save disabled until a change.
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | products-list | Click gear then 'Pricing settings' | CPQ Settings page | products-list |
## Outcome
As in steps.
## Variations and errors
No setting changed (tenant-wide).
## Cleanup
n/a
## Related flows
See flows/index.json.
