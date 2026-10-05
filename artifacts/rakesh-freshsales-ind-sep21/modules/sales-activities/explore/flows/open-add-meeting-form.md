---
slug: open-add-meeting-form
title: Open the Add meeting form
module: sales-activities
nav_path: Dashboards > Activities Dashboard > Add meeting (or + > Add meeting)
kind: create
mutating: true
requires_mode: readonly
---
## Goal
Open the Add meeting form.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | activities-dashboard | Click 'Add meeting' | Dialog 'Add meeting': Title*, From*/To* (date+time), All day, Time zone, Add video conferencing (Connect Zoom/Teams), Location, Description, Add outcome, Add meeting notes, Related to (0), Attendees (1) 'Attendees will get an email invitation', Connect Google Calendar/Office 365 | activities-dashboard |
| 2 | add-meeting-dialog | Click 'Save' with empty title | Inline "can't be empty" under Title; Cancel clicked | add-meeting-dialog |
## Outcome
See last step result.
## Variations and errors
Save with valid data not executed (invites would be emailed to attendees).
## Cleanup
n/a
## Related flows
