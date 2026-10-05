---
slug: filter-deals
title: Filter deals
module: deals
nav_path: Deals > 1 filter applied
kind: search-filter
mutating: false
requires_mode: readonly
---
## Goal
Filter deals.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. 
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deals (table) | Click '1 filter applied' | Filters panel: Deal stage contains (New, Qualification, Discovery, Demo, Negotiation, Show more), Pipeline = Default Pipeline | filter-deals |
| 2 | Filters | Click 'Add filter' | Field list: Deal value, Sales owner, Territory, Account name, Age (in days), Closed date, Created at, Deal name, Deal team, Deal type, Expected close date, Forecast category, Lost reason, Payment status, Probability (%), Products, Source, Tags, ... (~33) | filter-deals |
| 3 | Filters | Tick 'Qualification' then click 'Apply' | URL becomes /deals/view/custom?q[]=...; view tab 'All deals**' shows 2 results (Synth Corp, Acme Inc); buttons Reset and 'Save view as' appear | filter-deals |
| 4 | Deals | Click 'Reset' | Original 17 deals restored | filter-deals |
## Outcome
Closing panel with unapplied changes shows Confirm 'One or more filters have been updated, but they're not applied yet. Apply now?' with Discard/Apply. Adding 'Expected deal value' default operator 'all' was included in my filter. 'All deal owners' adds a Sales owner filter (Me, Unassigned, Rakesh M).
## Variations and errors
See Outcome notes.
## Cleanup
n/a
## Related flows
open-deals-pipeline-view
