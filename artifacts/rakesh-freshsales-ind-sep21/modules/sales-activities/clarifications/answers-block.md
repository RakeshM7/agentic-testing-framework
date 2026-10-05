# Answers block for module sales-activities (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior] [Nice-to-have] Should Meetings, Call logs and custom activities be treated as creatable standalone, given Related to is mandatory for custom activities and call logs but optional for tasks? Confirm intended rule.
  A: Related to is mandatory for custom activities and call logs but optional for tasks
- Q: [Behavior] [Nice-to-have] What happens to existing activities/goals when a custom activity type is deleted (UI warns data is deleted permanently)?
  A: All the custom activities get deleted
- Q: [Scope] [Nice-to-have] Can a user without admin rights create/edit activity types or goals?
  A: The rights are controlled by roles and permissions module under admin
- Q: [Behavior] [Blocking] Is the call log Outcome field truly mandatory for all call logs, and does Meeting save send invitation emails to attendees?
  A: Yes outcome is mandatory, meeting save will not send invitation emails

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Scope] [Blocking] Explore found no standalone Tasks/Meetings/Calls list page and substituted the Activities Dashboard plus Admin Settings > Sales Activities pages and /crm/sales/activity-goals (not in discovery); should test cases target exactly these pages as the module scope?
  A: Yes
- Q: [Behavior] [Blocking] In full-run, may tests save Meetings, Call logs and custom activities live by first creating a throwaway ZZ-prefixed contact or deal as the Related to record (deleted afterwards, never touching pre-existing AgentTest records)?
  A: Yes
- Q: [Behavior] [Blocking] Send SMS shows 'No provider connected'; should the SMS case assert only that blocked state (and be flagged for later when a provider exists), with no live send test?
  A: Yes
- Q: [Edge Case] [Nice-to-have] Are duplicate custom activity type names rejected, and what are the name length limits and the maximum number of custom activity types?
  A: Yes
- Q: [Edge Case] [Nice-to-have] For tasks, should a past due date be accepted, and what are the title length limits (empty title shows "can't be empty")?
  A: Yes
- Q: [Edge Case] [Nice-to-have] For activity goals, what validation applies to target (zero, negative, non-numeric), and are duplicate goals for the same user, activity and period blocked?
  A: Yes
- Q: [Scope] [Nice-to-have] Should Edit goal/Clone goal, Add outcome/Snooze for tasks, custom field Add and field dependency create be in scope for test cases even though explore did not exercise them?
  A: Yes
