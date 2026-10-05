# Module summary: Sales Activities
Purpose: tasks, meetings, call logs, SMS and custom activities recorded against contacts/accounts/deals; types configured in admin settings; Activities Dashboard summarises them; activity goals track targets.

## Entities
- Sales activity type: default (Task, Meeting, Phone, Email, Reminder, SMS, Chat) and custom (name, icon, flags: mobile check-in/out, show in My calendar, allow mark completed, allow edit completed date, outcomes). Default names not editable; Task has task types (Follow up, Call reminder; plus Email reminder, LinkedIn... seen on dashboard). Custom fields shared across all custom activities (types Text, Text area, Number, Dropdown, Checkbox, Radio, Date, Lookup, Multiselect, Formula).
- Task: Title*, Description, Task type, Due date* (default tomorrow), Outcome, Owner, Related to (optional), Collaborators, Mark as completed.
- Meeting: Title*, From*/To*, All day, Time zone, video conf, Location, Description, Outcome, Notes, Related to, Attendees (email invite).
- Call log: Call type*, Outcome (required), Associate with* (Contact/Account/Deal), Name*, Notes.
- Custom activity: Title*, Start/End date*, Owner, Related to* (required), Collaborators, Description, Notes.
- Activity goal: period (weekly/monthly/quarterly/yearly), goal type (user), users*, activity*, outcome, target (default 100).

## Lifecycle / rules observed
Task: open -> Mark complete (dialog offers outcome + description) -> completed (shows due vs completed times). Row actions: Add outcome, Snooze, Delete (confirm Yes/No). Deleting an activity type warns that collected data is deleted permanently. Required-field message everywhere: "can't be empty". Toasts: "You created a sales activity.", "You updated the sales activity.", "You deleted the sales activity.", "You added a task.", "You deleted the task.", "You added a goal.", "You deleted the goal.".
Custom type appears immediately in + menu, dashboard picker and goal activity list.

## Permissions
Seen as Org Admin only. Email/Reminder/SMS/Chat default types have no edit button.

## Links to other modules
Related to links Contacts/Accounts/Deals; dashboard rows link to deals (/crm/sales/deals/<id>). Send SMS needs Channels SMS provider. Calendar/Zoom/Teams are integrations.

## Open questions
See artifacts/rakesh-freshsales-ind-sep21/open-questions.csv (module sales-activities).
