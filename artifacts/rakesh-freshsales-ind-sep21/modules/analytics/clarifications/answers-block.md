# Answers block for module analytics (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior][Nice-to-have] Is moving a report to Trash recoverable and for how long, and can an org admin permanently delete or restore it from Trash?
  A: 4w 2d
- Q: [Behavior][Nice-to-have] Are Schedule frequencies other than Monthly and recipients other than the logged-in user permitted, and how are failed deliveries surfaced?
  A: Scheduled frequencies other than monthly are permitter. Receipients other than login are permitted as long as the user is a Lead/Contact/Agent in the system
- Q: [Edge Case][Nice-to-have] What validation rules apply to Custom Attribute formulas and Custom Metrics (allowed functions, name uniqueness, limits)?
  A: Skip; flag for later

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Scope][Blocking] The feature goal covers data export and custom metrics, but the crawl only saw their list pages (Create Export / Create Metric forms were never opened); should test cases for creating these be written from assumed fields, limited to list/navigation checks, or deferred until the forms are explored?
  A: yes
- Q: [Behavior][Blocking] Under full-run, may a valid schedule be saved live for the logged-in user only (it creates recurring emails), and must the test delete or disable the schedule it created afterwards?
  A: yes
- Q: [Edge Case][Blocking] What are the validation rules for report names and Save (empty name, duplicate name, maximum length, default 'Untitled Report'), and may a report with empty or duplicate name be attempted live?
  A: yes
- Q: [Behavior][Nice-to-have] Are curated (System) reports protected from Edit, Clone, Move to trash and favorite, or only some of them?
  A: yes
- Q: [Behavior][Nice-to-have] Which behaviors should tests verify for sidebar filters (Recent, Favorites, My, Curated, Private, Shared), Sort By and the 10-per-page paging, and how does Private versus Shared visibility work for a report created by the test?
  A: yes
- Q: [Behavior][Nice-to-have] Are Email Now and Download (export) on a report safe to run live in tests, as answered for dashboards (email goes only to the logged-in user, download saves a file locally)?
  A: Yes
- Q: [Behavior][Nice-to-have] Should tests assert that opening /analytics redirects to the last viewed report, or treat the landing destination as non-deterministic?
  A: Yes
