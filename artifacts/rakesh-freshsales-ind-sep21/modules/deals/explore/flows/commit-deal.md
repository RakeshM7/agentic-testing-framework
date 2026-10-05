---
slug: commit-deal
title: Commit a deal to forecast
module: deals
nav_path: Deals > <deal> > Commit deal
kind: update
mutating: true
requires_mode: full-run
---
## Goal
Commit a deal to forecast.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. Needs a deal created by this run for destructive steps.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail | Click 'Commit deal' | Modal: 'You must set an expected close date to commit a deal' with radio This month (31 Oct 2026), Next month (30 Nov 2026), 31 Dec 2026, Select a specific date | commit-deal |
| 2 | Modal | Click 'Commit' | Toast 'You committed the deal.'; Forecast category = Committed; header shows 'Committed'; Commit deal button replaced; kebab gains 'Remove commit' | commit-deal |
## Outcome
Remove commit not executed.
## Variations and errors
See Outcome notes.
## Cleanup
Entities created by this flow were deleted (see created-entities.json).
## Related flows
open-deals-pipeline-view
