---
slug: create-pipeline-form
title: Open the Create pipeline form (not saved)
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Pipelines > Create pipeline
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open the Create pipeline form (not saved).
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | On Pipelines click button 'Create pipeline' | see Outcome | pages/ |
## Outcome
Modal 'Create pipeline': Pipeline name* (default 'Untitled pipeline'), checkbox 'Set as default pipeline', Deal stage list (New [Default] 10%, three blank stage rows 20/40/60% each removable, 'Add deal stage'), Closing stages Won (Closed Won, 100%, locked) and Lost (Closed Lost, 0%, locked), 'By default, summarize deal stages using' dropdown (Deal value), 'Deals go stale after*' (365 days), live kanban preview; buttons Cancel, Save (disabled until valid). Cancel clicked; nothing saved. Save not executed.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
