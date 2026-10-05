---
slug: create-custom-attribute-form
title: Open New Attribute form (custom attribute)
module: analytics
nav_path: Analytics > Settings > Custom Attributes > Create Attribute
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Open New Attribute form (custom attribute)
## Preconditions
Org admin session.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | settings-custom-attributes | Click Create Attribute | /analytics/custom-attributes/new: Name*, Description (Optional), Module* (Accounts default), Data Type*, Formula* with Insert tabs Columns/Functions/Operators, Preview; Save Attribute, Cancel | custom-attribute-new |
| 2 | custom-attribute-new | Click Save Attribute with empty fields | validation result not captured (screenshot tool denied) | custom-attribute-new |
## Outcome
See steps.
## Variations and errors
No attribute created. Custom Metrics Create Metric form not opened.
## Cleanup
n/a
## Related flows
see flows/index.json
