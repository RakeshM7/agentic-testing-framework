# Clarifications: sales-activities (Freshsales, tenant rakesh-freshsales-ind-sep21)

## Feature summary
Verify, create/edit/delete and navigate sales activities in Freshsales: tasks, meetings, call logs, SMS, custom activity types, and activity goals. Coverage must include every flow in `explore/flows/index.json` (17 flows). The module has no standalone Tasks/Meetings/Calls list page; it spans the Activities Dashboard, Admin Settings > Sales Activities pages, and `/crm/sales/activity-goals`.

## In scope / Out of scope
In scope (Q: scope substitution, answered Yes):
- Dashboards > Activities Dashboard (open, due-date filter, add task, complete task, delete task, add meeting form, goals entry).
- Admin Settings > Deals & Pipelines > Sales Activities (open, create/rename/delete custom activity type).
- Admin Settings > Sales Activities > Customize fields and Manage field dependencies (view; plus Add custom field and field dependency create, per scope answer).
- Quick-create (+) > Sales activities: Add call log, Add meeting, Add custom activity, Send SMS.
- Activity goals (`/crm/sales/activity-goals`): add, delete, plus Edit goal and Clone goal.
- Tasks: Add outcome and Snooze (row menu), in addition to complete and delete.

Out of scope / not covered here:
- Task/meeting/call detail from contact/account/deal Activity tabs (other modules).
- Live SMS send (no provider connected).
- Calendar integrations (Google/Office 365/Zoom/Teams), Configure widgets, Quick Links, Preview: not addressed by any answer; not asserted in scope (see Open questions).

## Confirmed behaviors
- Related to is mandatory for custom activities and call logs, optional for tasks. (Q: Related-to rule)
- Call log Outcome is mandatory. (Q: call log outcome)
- Saving a Meeting does NOT send invitation emails to attendees. (Q: meeting invites)
- Deleting a custom activity type deletes all custom activities of that type (UI warns the deletion is permanent). (Q: delete custom type)
- Task due date defaults to tomorrow; empty task title shows "can't be empty" (observed in explore crawl-log/flows).
- Send SMS shows "No provider connected"; the SMS test case asserts only that blocked state, no live send, and is flagged for re-test once a provider exists. (Q: SMS, answered Yes)
- Meetings, call logs and custom activities may be saved live: first create a throwaway ZZ-prefixed contact or deal as the Related to record, delete it afterwards, never touch pre-existing AgentTest records. (Q: full-run saves, answered Yes)
- Permissions to create/edit activity types or goals are governed by Admin > Roles and Permissions. (Q: non-admin rights)
- Edit goal, Clone goal, Add outcome, Snooze, custom field Add and field dependency create are in scope. (Q: scope extras, answered Yes)

Safety basis: `authorizations.mode` = `full-run`, set explicitly by the user for their own trial tenant. Deletes/cancels apply only to entities this run created (ZZ-prefixed; tracked in `created-entities.json`).
- (a) Submissions that could succeed and mutate data (create/rename/delete type, add/complete/delete task, save meeting/call log/custom activity, add/edit/clone/delete goal, add field/dependency): permitted live under full-run, on run-created ZZ entities only.
- (b) Submissions expected to be blocked by validation before any mutation (empty task title, missing Outcome, missing Related to, empty type name, etc.): non-mutating, run live regardless of mode.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Add task with empty title | Validation error "can't be empty"; no task created |
| Add task, no Related to | Allowed (Related to optional for tasks) |
| Add call log without Outcome | Blocked; Outcome mandatory |
| Add call log / custom activity without Related to | Blocked; Related to mandatory |
| Save meeting with attendees | Saved; no invitation emails sent |
| Delete custom activity type that has activities | Warning of permanent deletion; all activities of that type are deleted |
| Send SMS with no provider | "No provider connected" blocked state |
| Duplicate custom type name, name/title length limits, max type count, past-due task, goal target zero/negative/non-numeric, duplicate goals | UNRESOLVED (see Open questions) |

## Non-functional constraints
- Authorization for creating/editing types and goals depends on Roles and Permissions; crawl ran as ORGANIZATION ADMIN.
- Console errors (3) and Appcues expiry warnings appear on every page in explore; treat as pre-existing noise, not module defects (explore observation, not confirmed by humans).

## Confirmed test-case output format
CSV

## Open questions
1. Duplicate custom activity type names / name length / max number of types: answered with a bare "Yes" to a multi-part question; no actual rules given. Not treated as spec.
2. Task past due date acceptance and title length limits: bare "Yes"; unclear whether past dates are accepted and no limits given.
3. Activity goal target validation (zero, negative, non-numeric) and duplicate goals: bare "Yes"; no rules given.
4. Non-admin rights: answer only defers to Roles and Permissions; no specific role/permission matrix given. Is a non-admin role test wanted, and which role?
5. Meetings standalone: the Related-to answer covers custom activities, call logs and tasks but not whether Meetings require Related to.
6. Coverage gaps from explore not addressed by answers: Preview, Configure widgets, Quick Links, calendar integrations, Filters on goals, edit Task activity-type save.
7. SMS: re-test needed once an SMS provider is connected (flag for later).
8. Possible tension recorded: the explore crawl-log lists Meeting/call log/custom activity saves as not executed (no owned related record); the answers now permit them via throwaway ZZ contact/deal. Not a contradiction, but the contact/deal creation falls under other modules' flows and needs a setup step in the test cases.

## Follow-up Questions
- [Edge Case] [Nice-to-have] What are the actual rules for duplicate custom activity type names, name length limit and maximum number of custom activity types (previous answer was a bare "Yes")? Navigate: Admin Settings > Deals & Pipelines > Sales Activities > Create sales activity (flow create-custom-sales-activity-type).
- [Edge Case] [Nice-to-have] Is a past due date accepted for tasks, and what is the title length limit? Navigate: Dashboards > Activities Dashboard > Add task (flow add-task).
- [Edge Case] [Nice-to-have] What validation applies to goal target (zero, negative, non-numeric) and are duplicate goals for the same user, activity and period blocked? Navigate: Dashboards > Activities Dashboard > View activity goals > Add goal (flow add-activity-goal).
- [Scope] [Nice-to-have] Is Related to mandatory for Meetings? Navigate: + > Sales activities > Add meeting (flow open-add-meeting-form).
