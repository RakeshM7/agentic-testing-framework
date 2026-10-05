---
slug: add-custom-activity-from-quick-create
title: Open Add form for a custom activity type
module: sales-activities
nav_path: + > Sales activities > Add <custom activity>
kind: create
mutating: true
requires_mode: readonly
---
## Goal
Open Add form for a custom activity type.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | quick-create-menu | Click menuitem 'Add ZZ Explore Activity' | Dialog 'Add sales activity': Title*, Start date*, End date*, Owner, Related to* (required; contacts/accounts/deals), Collaborators, Description, Notes | quick-create-menu |
| 2 | quick-create-menu | Click 'Save' empty | Errors "can't be empty" on Title and Related to; Cancel clicked | quick-create-menu |
## Outcome
See last step result.
## Variations and errors
Unlike task, Related to is mandatory for custom activities.
## Cleanup
n/a
## Related flows
