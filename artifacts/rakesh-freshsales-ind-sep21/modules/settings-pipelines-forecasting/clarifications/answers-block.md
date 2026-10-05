# Answers block for module settings-pipelines-forecasting (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior] [Blocking] Where are quotas set? Quotas and Forecasting settings page shows only forecast categories, default category and Freddy toggles, with no quota entry UI.
  A: Quotas and forecasting can be set by clicking on the Quotas and Forecasting CTA in the Deal list page
- Q: [Behavior] [Blocking] What validation rules apply on Create pipeline (duplicate name, minimum stages, probability ordering, stale days range) and what happens to deals when a pipeline is deleted?
  A: The suggested validation rule applies; Pipeline cannot be deleted as long as a deal is tagged to it
- Q: [Behavior] [Nice-to-have] Which custom deal field types and limits apply (max custom fields, choice limits, formula syntax)? Add selected was denied so the field config form was not seen.
  A: Do a manual exploration through explicit approval and find out;

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Scope] [Blocking] Under full-run, may tests live-create ZZ-prefixed pipelines, deal fields, field dependencies, forecast categories, sales activity types and activity goals and delete only those they created, including negative/validation-only submissions (e.g. empty name, duplicate name) run live?
  A: Yes
- Q: [Behavior] [Blocking] Can the 4 system-defined field dependencies (Pipeline->Deal stage, Deal stage->Lost reason, Deal stage->Closed date, Forecast category->Expected close date) be edited, disabled or deleted, and what validation applies when creating a custom dependency (same parent and child field, duplicate, choice mapping required)?
  A: Yes
- Q: [Behavior] [Nice-to-have] What validation applies when adding a forecast category (duplicate name, max count, required fields), and can the default category (Best-case) or built-in Committed be edited or deleted?
  A: Yes
- Q: [Edge Case] [Nice-to-have] Can the Default Pipeline or its stages be renamed, reordered or deleted, and what happens to deals in a stage that is deleted?
  A: Yes
- Q: [Behavior] [Nice-to-have] What validation applies on Create sales activity (duplicate name, required icon or outcomes, max custom types) and are built-in types (Email, Reminder, SMS, Chat) non-editable?
  A: Yes
- Q: [Behavior] [Blocking] How are Activity Goals created (Add goal inputs such as activity type, target, period, owner or team) and what validation applies, given none exist (My goals (0)) and the page lives outside the settings shell?
  A: Yes
- Q: [Scope] [Nice-to-have] Is the Product Catalog tile in the Deals & Pipelines group in scope here or owned by the products module?
  A: Yes
