---
slug: view-add-contact-field-options
title: View Add field overlay for Contacts
module: settings-data-model
nav_path: Admin Settings > Contacts > Add field
kind: read
mutating: true
requires_mode: full-run
---
## Goal
View Add field overlay for Contacts
## Preconditions
Admin role (observed: account owner, Rakesh M).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-forms | Click button "Add field" (Basic information) | Drawer "Add field": "Select from 52 available fields" (checkbox list with search, e.g. Tags, Source, Lifecycle stage...) or custom field type tiles: Text field, Text area, Number, Dropdown, Checkbox, Radio button, Date picker, Lookup, Multiselect, URL, Formula, Auto-number | add-field-overlay.md |
| 2 | contacts-forms | Click tile "Text field" | "Add selected" button becomes enabled (was disabled) | new-text-field-form.md |
| 3 | contacts-forms | Click "Add selected" | Form: Field label* (placeholder "Give a name for your field"), Internal name* (prefix cf_), Field type* (Text field), Tooltip, Placeholder text (default "Start typing..."), Group or sub-group (Basic information), checkboxes: Make this a required field / Show field in quick-add view / Make this a read-only field / Make this a unique field / Track this field's edit history; buttons Cancel, Save | field-form-snap.md |
| 4 | contacts-forms | Click "Save" | not executed: blocked by permission classifier; field not created | n/a |
| 5 | contacts-forms | Click "Cancel" | Overlay closed, nothing created | n/a |
## Outcome
Create custom contact field flow verified up to Save only.
## Variations and errors
See notes above; Save steps were not executed (permission denied by the auto-mode classifier for shared admin config).
## Cleanup
n/a (nothing created)
## Related flows
