# Analytics module clarifications (feature slug: analytics)

## Feature summary
Verify, create, edit, trash and navigate Freshsales Analytics: the reports library, report creation from Gallery templates, report details, favorites, curated (System) reports, schedules and Export (Email Now / Download), Trash, and Analytics Settings (Data Export, Custom Metrics, Custom Attributes). Coverage must span every flow in `explore/flows/index.json`: open-analytics-reports-list, create-report-from-gallery-template, view-report-details, favorite-report, schedule-report-validation, open-curated-report, browse-analytics-settings, create-custom-attribute-form, trash-report. No requirement documents were supplied.

## Safety basis
`authorizations.mode` = **full-run** (set explicitly by the user for their own trial tenant). Mutating flows are executed live. Deletes/trash apply only to entities the run created (tracked in `created-entities.json`); never pre-existing or curated reports.
- (a) Submissions that could succeed and mutate data: run live under full-run, scoped as above.
- (b) Submissions expected to be blocked by validation before mutation (e.g. empty required schedule fields, empty report name if the UI blocks it): non-mutating, run live regardless of mode.

## In scope
- Reports library navigation, sidebar filters (Recent, Favorites, My, Curated, Private, Shared), Sort By, paging (10 per page) as UI navigation checks.
- Create report from Gallery template; view Report Details; favorite; move own report to Trash.
- Opening curated reports (e.g. Sales Dashboard).
- Schedule report form (validation and a valid save for the logged-in user); Email Now and Download on a report.
- Analytics Settings browsing (Data Export, Custom Metrics, Custom Attributes lists) and opening the New Attribute form.

## Out of scope
- Editing, trashing or deleting curated/System reports or any pre-existing report not created by the run.
- Creating Data Export and Custom Metric records, and Custom Attribute formula validation (forms not explored; see Open questions).
- Schedules with recipients other than the logged-in user (permitted by the product, but not authorized for live execution; see Confirmed behaviors).

## Confirmed behaviors
- Output format and mode: CSV; full-run (run-config).
- Trash retention: answer given as "4w 2d" (source: trash recoverability question). Interpreted as the retention period shown for trashed reports; exact semantics unconfirmed (see Open questions).
- Schedule frequencies other than Monthly are permitted. Recipients other than the logged-in user are permitted provided they are a Lead, Contact or Agent in the system (source: schedule frequencies/recipients question).
- A valid schedule MAY be saved live for the logged-in user only, and the test MUST delete or disable the schedule it created afterwards (answer "yes" to a genuine yes/no question).
- Email Now and Download on a report are safe to run live (email goes to the logged-in user only; download saves a file locally). Answer "Yes".
- Recurring emails to anyone other than the logged-in user are not authorized for tests: the recipients answer says it is permitted by the product, while the live-save authorization covers the logged-in user only. These do not conflict, but test cases for other recipients should be written without live execution unless a human confirms.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Schedule form submitted with required fields empty | Blocked by validation, nothing saved; runs live (case b). Exact messages per `flows/schedule-report-validation.md`. |
| Valid schedule, logged-in user as sole recipient, non-Monthly frequency | Saved; test cleans up (delete/disable). |
| Schedule recipient is a Lead/Contact/Agent other than self | Permitted by the product; live execution not authorized. |
| Schedule recipient not a Lead/Contact/Agent | Not confirmed (inferred rejection only; see Open questions). |
| Trash a report created by the run | Moves to Trash; retention shown as "4w 2d". |
| Report name empty / duplicate / max length / default "Untitled Report" | Not confirmed (see Open questions). |
| Edit/Clone/Trash/Favorite on a curated report | Not confirmed (see Open questions). |

## Non-functional constraints
None raised. Authorization: tenant is the user's own trial tenant; credentials via env-file path only.

## Confirmed test-case output format
CSV

## Open questions
Bare "yes"/"Yes" answers to non-yes/no questions, a skip and unanswered sub-parts are carried here, not treated as spec.
1. Data export and custom metrics scope: the answer "yes" does not choose among assumed-fields / list-and-navigation-only / defer. Default until clarified: list/navigation checks only for Data Export and Custom Metrics; Create Export/Create Metric forms deferred pending exploration.
2. Report name and Save validation (empty name, duplicate name, max length, default "Untitled Report"): the answer "yes" gives no rules. Whether empty/duplicate names may be attempted live is also unresolved (a validation-blocked attempt is non-mutating; a duplicate that succeeds would create a report, allowed only under full-run and trashed afterwards).
3. Curated (System) report protection (Edit/Clone/Move to trash/Favorite): the answer "yes" is unclear as to which actions are protected. Tests must not trash or edit curated reports regardless.
4. Sidebar filters, Sort By, 10-per-page paging, Private vs Shared visibility: "yes" does not specify behaviors to verify or visibility rules. Default: generic navigation/filter checks only.
5. Landing on /analytics: "Yes" to an either/or question; unclear whether tests assert redirect to last viewed report or treat it as non-deterministic. Default: non-deterministic, assert only that Analytics loads.
6. Trash: "4w 2d" is ambiguous (retention before auto-purge assumed). Not answered: whether an org admin can restore or permanently delete from Trash.
7. Schedule: how failed deliveries are surfaced is unanswered; behavior for recipients who are not Lead/Contact/Agent is unanswered.
8. Custom Attribute formula and Custom Metric validation (functions, name uniqueness, limits): skipped, flagged for later.
9. Coverage gaps from explore (Data Export and Custom Metrics create forms never opened) remain; the notes in `explore/crawl-log.md` apply.

## Follow-up Questions
- [Behavior][Nice-to-have] Does "4w 2d" mean a trashed report is auto-purged after 4 weeks 2 days, and can it be restored in that window? Navigate: Analytics > Trash (flow trash-report).
- [Behavior][Blocking] When a Schedule recipient is a Lead/Contact/Agent other than the logged-in user, may a test save it live (sends recurring emails to a third party), or only the logged-in user? Navigate: Analytics > <report> > Export > Schedule report (flow schedule-report-validation).
- [Scope][Blocking] For Data Export and Custom Metrics, please pick one: list/navigation checks only, tests from assumed fields, or defer until forms are explored. Navigate: Analytics > Settings > Data Export / Custom Metrics (flow browse-analytics-settings).
- [Edge Case][Blocking] What should happen when a report is saved with an empty name, a duplicate name, or an over-long name, and may these be tried live? Navigate: Analytics > New Report > Save (flow create-report-from-gallery-template).
