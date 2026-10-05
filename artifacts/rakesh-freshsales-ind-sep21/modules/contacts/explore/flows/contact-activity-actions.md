---
slug: contact-activity-actions
title: Open activity forms from a contact
module: contacts
nav_path: Contacts > <contact> > Email / Call log / Task / Meeting
kind: workflow
mutating: false
requires_mode: readonly
---
## Goal
Open activity forms from a contact.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contact-detail | Click "Email" | New mail composer (To prefilled, From, Cc, Bcc, Use template, Connect Gmail prompt, Send) | contact-detail-email-overlay |
| 2 | contact-detail | Click "Task" | Add task: Title, Description, Task type, Due date, Outcome, Owner, Related to, Collaborators | contact-detail-task-overlay |
| 3 | contact-detail | Click "Meeting" | Add meeting: Title, From, To, All day, Time zone, video conferencing, Location, Description, Attendees | contact-detail-meeting-overlay |
| 4 | contact-detail | Click "Call log" | Call type, Outcome, Associate, Notes | contact-detail-calllog-overlay |
## Outcome
None submitted.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
