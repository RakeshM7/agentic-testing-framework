---
slug: create-deal-from-add-deal-button
title: Create a deal with Add deal
module: deals
nav_path: Deals > Add deal
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create a deal with Add deal.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deals | Click 'Add deal' | Slide-over 'Add deal': Related contact, Related account, Deal type, Deal name*, Currency (USD disabled), Deal value* (default 0), Add products, Deal stage (New) | create-deal-from-add-deal-button |
| 2 | Add deal | Click 'Show all fields' | adds Sales owner (Rakesh M), field search, Basic information section | create-deal-from-add-deal-button |
| 3 | Add deal | Leave Deal name empty, click Save | Banner 'Review 1 field for errors'; inline 'Can't be empty' under Deal name | create-deal-from-add-deal-button |
| 4 | Add deal | Type name 'ExploreDeals Deal 1', Deal value -5, click Save | Deal saved (negative value accepted!) and lands on /crm/sales/deals/<id>; header shows $-5 | create-deal-from-add-deal-button |
## Outcome
Cleanup: deleted via kebab > Delete > Yes (moved to Recycle Bin).
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
