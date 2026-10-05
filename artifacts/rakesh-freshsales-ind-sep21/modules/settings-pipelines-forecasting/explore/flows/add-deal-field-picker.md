---
slug: add-deal-field-picker
title: Open the Add field picker (not saved)
module: settings-pipelines-forecasting
nav_path: Admin Settings > Deals & Pipelines > Deals > Add field
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open the Add field picker (not saved).
## Preconditions
Admin role (authenticated session of tenant admin).
## Steps
| # | On page | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | admin-settings-home | Click button 'Add field' | see Outcome | pages/ |
## Outcome
Drawer 'Add field': 'Select from 23 available fields' (Tags, Deal value in Base Currency, Payment status, Probability (%), Territory, Forecast category, Expected close date (disabled), Source, Campaign, Last activity type, ...) or custom types Text field, Text area, Number, Dropdown, Checkbox, Radio button, Date picker, Lookup, Multiselect, Formula. Selecting Text field enables 'Add selected'. Clicking 'Add selected' was DENIED by the permission system; not executed. Cancel clicked.
## Variations and errors
Mutating step not executed: admin config is tenant-shared; forms opened and cancelled only. Validation messages not observed.
## Cleanup
n/a (nothing created)
## Related flows
open-deals-pipelines-settings
