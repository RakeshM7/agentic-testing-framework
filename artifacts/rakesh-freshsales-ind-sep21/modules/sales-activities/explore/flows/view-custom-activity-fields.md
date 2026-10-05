---
slug: view-custom-activity-fields
title: Open custom sales activity fields
module: sales-activities
nav_path: Admin Settings > Sales Activities > Customize fields
kind: navigation
mutating: false
requires_mode: read
---
## Goal
Open custom sales activity fields.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activity-types | Click 'Customize fields' (visible only when a custom activity exists) | URL /crm/sales/settings/sales_activities/forms; heading 'Custom sales activities'; 'Add field', 'Preview', 'Search fields', 'Manage field dependencies'; empty list 'Click to add fields here' | activity-types |
| 2 | activity-custom-fields | Click 'Add field' | Overlay 'Select a custom field': Text field, Text area, Number, Dropdown, Checkbox, Radio button, Date picker, Lookup, Multiselect, Formula; 'Add selected' disabled until choice; Cancel clicked | activity-custom-fields |
## Outcome
See last step result.
## Variations and errors
Field creation not executed (shared across all custom activities).
## Cleanup
n/a
## Related flows
