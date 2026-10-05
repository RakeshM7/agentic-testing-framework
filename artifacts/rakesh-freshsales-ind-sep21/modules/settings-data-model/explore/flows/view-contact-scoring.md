---
slug: view-contact-scoring
title: View contact scoring settings
module: settings-data-model
nav_path: Admin Settings > Contact Scoring
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View contact scoring settings
## Preconditions
Admin role (observed: account owner, Rakesh M).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contact-scoring | Open page | Positive/Negative signals empty ("You've not added any signals." + Add signal), suggested signals Country, Industry type, Email, Phone; Import contacts / Import deals / Migrate from another CRM buttons (not clicked); Automations: score greater than 70 -> Add tag "Likely to buy" / Change lifecycle stage to Sales Qualified Lead; "Save settings" disabled | contact-scoring |
## Outcome
Read only.
## Variations and errors
See notes above; Save steps were not executed (permission denied by the auto-mode classifier for shared admin config).
## Cleanup
n/a (nothing created)
## Related flows
