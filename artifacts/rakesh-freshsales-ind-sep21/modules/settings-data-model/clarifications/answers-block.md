# Answers block for module settings-data-model (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior][Blocking] Does saving a new custom field/module/lifecycle stage enforce limits (max custom fields, trial plan limits) or reserved internal names, and what validation messages appear?
  A: Limits are enforced, Find what are the limits by searching through the knowledge base
- Q: [Scope][Blocking] Can the explorer be authorised to create and delete ZZ-Explore fields/tags in this admin area (the auto-mode classifier denied Save as shared-resource modification)?
  A: yes
- Q: [Behavior][Nice-to-have] Is the Email field on contacts mandatory on save despite the Required checkbox appearing unchecked (only Quick-add/Read-only/Unique badges seen)?
  A: Either Email / mobile / External ID is mandatory
- Q: [Behavior][Nice-to-have] What happens to existing contacts when a lifecycle stage is disabled or deleted?
  A: Contacts move to the first lifecycle stage

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Scope][Blocking] Feature-mapping caveat: Tags was found under Admin Settings > Account Settings > Tags (not under the Leads, Contacts & Accounts group), and Contacts/Accounts 'forms' pages are field/layout editors -- should test cases treat Account Settings > Tags and these field/layout editors as the intended 'tags' and 'contact/account fields' flows?
  A: Yes
- Q: [Scope][Blocking] Under full-run, may tests create and then delete a custom module (ZZ-Explore, internal name cm_ prefix), and does Freshsales allow deleting a custom module afterwards (or is it permanent, which would leave tenant clutter)?
  A: Yes
- Q: [Scope][Blocking] Under full-run, may tests build and save a Web Form (and a LinkedIn Lead Gen form, which needs a LinkedIn connection) and delete them afterwards, given web forms are public-facing and none exist yet?
  A: Yes
- Q: [Edge Case][Nice-to-have] For the Add field form (required: Field label, Internal name, Field type), what should happen on empty label, duplicate label, duplicate or invalid-character internal name, and a name clashing with a system field -- expected message text if known?
  A: Yes
- Q: [Edge Case][Nice-to-have] Are negative/validation-only submissions (e.g. empty required fields in the Add field, Add module, Add lifecycle stage or Add tag forms, expected to be blocked before any save) permitted to run live in every mode?
  A: Yes
- Q: [Behavior][Nice-to-have] For lifecycle stages, may tests toggle, reorder, add or delete stages and the two auto-rules (deal added -> Sales Qualified Lead; deal won -> Customer), or must the seeded stages and rules stay untouched, with only run-created ZZ-Explore stages modified?
  A: Yes
- Q: [Behavior][Nice-to-have] For Contact Scoring, may tests add positive/negative signals and change the automation threshold (currently 70 -> tag 'Likely to buy' and/or stage change), or is this view-only?
  A: Yes
