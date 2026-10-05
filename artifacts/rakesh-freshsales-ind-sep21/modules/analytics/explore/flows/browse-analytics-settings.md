---
slug: browse-analytics-settings
title: Browse Analytics settings
module: analytics
nav_path: Analytics > Settings
kind: settings
mutating: false
requires_mode: readonly
---
## Goal
Browse Analytics settings
## Preconditions
Org admin session.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | analytics-landing | Click Settings in left list | /analytics/settings/schedules 'You haven't configured any schedules.' | settings-schedules |
| 2 | settings-schedules | Click Data Export | /settings/data-exports 'You haven't configured any exports.' Create Export | settings-data-exports |
| 3 | settings-data-exports | Click Custom Metrics | 'You haven't configured any custom metrics.' Create Metric | settings-custom-metrics |
| 4 | settings-custom-metrics | Click Custom Attributes | 'You haven't configured any custom attributes.' Create Attribute | settings-custom-attributes |
## Outcome
See steps.
## Variations and errors
none observed
## Cleanup
n/a
## Related flows
see flows/index.json
