---
slug: create-custom-sales-activity-type
title: Create a custom sales activity type
module: sales-activities
nav_path: Admin Settings > Deals & Pipelines > Sales Activities > Create sales activity
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create a custom sales activity type.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activity-types | Click button 'Create sales activity' | Overlay 'create sales activity' with 'Give your sales activity a name*' (placeholder Like 'Facebook chat'), icon picker, checkboxes (mobile check in/out, show in My calendar, allow mark completed, allow edit completed date), 'Predict outcomes' (default Interested, Left message, No response, Not able to reach, Not interested; 'Add outcome') | activity-types |
| 2 | activity-type-create-dialog | Click 'Save' with empty name | Inline error "can't be empty" under name | activity-type-create-dialog |
| 3 | activity-type-create-dialog | Type 'ZZ Explore Activity' in name, click 'Save' | Toast 'Success / You created a sales activity.'; row appears under Custom sales activities, with 'Customize fields' and 'Create sales activity' buttons shown | activity-type-create-dialog |
## Outcome
See last step result.
## Variations and errors
Cleanup: deleted by delete-custom-sales-activity-type. Custom type then appears in + menu as 'Add ZZ Explore Activity' and in dashboard '+ 8 activities' picker.
## Cleanup
Entity created this run was deleted (see created-entities.json).
## Related flows
