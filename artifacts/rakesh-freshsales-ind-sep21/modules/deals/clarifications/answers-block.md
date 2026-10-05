# Answers block for module deals (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Edge Case][Nice-to-have] Should a negative Deal value (e.g. -5) be accepted when creating a deal?
  A: no
- Q: [Behavior][Nice-to-have] Is Lost reason intentionally optional when marking a deal Lost, and is it mandatory in any config?
  A: It is mandatory, as defined by the field dependencies in Admin / Settings > Deal forms. It can be made optional through the admin setting
- Q: [Behavior][Nice-to-have] What do Bulk actions on deals offer and which are permitted for this role?
  A: Permitted roles are defined by the Roles and Permissions settings in the admin. Bulk actions that are offered are the same set of actions that are displayed in the top bar when the bulk deals are selected
- Q: [Behavior][Nice-to-have] Should deal value stay editable manually once products are added (value was overridden to product total $100)?
  A: No, once products are added, deal value cannot be edited

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Behavior][Blocking] How does the Forecast view compute its totals (open vs committed vs weighted by probability, grouped by Forecast category, month vs quarter), and what should tests assert on it?
  A: Yes
- Q: [Behavior][Blocking] What exactly happens on Mark Won (required fields, Closed date, stage/probability/forecast category changes) and on dragging a card directly into the Won or Lost column on the kanban - same modal as the detail page Won/Lost button?
  A: Yes
- Q: [Behavior][Nice-to-have] Commit deal requires an Expected close date: what is the exact validation when it is empty, and is there a Remove commit action that reverts Forecast category (and to which value)?
  A: Yes
- Q: [Edge Case][Nice-to-have] Are duplicate deal names allowed on create and on Clone save, or are they blocked/warned like accounts and contacts?
  A: Yes
- Q: [Behavior][Nice-to-have] For the Recycle Bin: is Restore expected to return the deal to its original pipeline stage and fields, and are tests permitted to use Forget (permanent delete) on deals the run itself created?
  A: Yes
- Q: [Scope][Nice-to-have] Which of these are in scope for test cases: Group by view, Add new saved view form, Import deals, the 13 other saved views, Add note/quote/file and Discussions tabs on a deal (all unexercised by explore)?
  A: Yes
- Q: [Edge Case][Nice-to-have] Deal name and field limits: max Deal name length, max Deal value, and Probability range (0-100?) - what validation messages should negative tests expect?
  A: Yes
