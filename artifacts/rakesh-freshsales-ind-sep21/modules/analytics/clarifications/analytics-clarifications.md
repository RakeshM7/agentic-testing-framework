# Analytics module clarifications (feature slug: analytics)

## Feature summary
Verify, create, edit, trash and navigate Freshsales Analytics: the reports library, report creation from Gallery templates, report details, favorites, curated (System) reports, schedules and Export (Email Now / Download), Trash, and Analytics Settings (Data Export, Custom Metrics, Custom Attributes). Coverage must span every flow in `explore/flows/index.json`: open-analytics-reports-list, create-report-from-gallery-template, view-report-details, favorite-report, schedule-report-validation, open-curated-report, browse-analytics-settings, create-custom-attribute-form, trash-report. No requirement documents were supplied.

## Safety basis
`authorizations.mode` = **full-run** (set explicitly by the user for their own trial tenant). Mutating flows are executed live. Deletes/trash apply only to entities the run created (tracked in `created-entities.json`); never pre-existing or curated reports.
- (a) Submissions that could succeed and mutate data: run live under full-run, scoped as above.
- (b) Submissions expected to be blocked by validation before mutation (e.g. empty required schedule fields, empty report name): non-mutating, run live regardless of mode.

## In scope
- Reports library navigation, sidebar filters (Recent, Favorites, My, Curated, Private, Shared), Sort By, paging (10 per page) as UI navigation checks.
- Create report from Gallery template; view Report Details; favorite; move own report to Trash.
- Opening curated reports (e.g. Sales Dashboard).
- Schedule report form (validation and a valid save for the logged-in user); Email Now and Download on a report.
- Analytics Settings: list/navigation checks for Data Export, Custom Metrics and Custom Attributes, and opening the New Attribute form.

## Out of scope
- Editing, trashing or deleting curated/System reports or any pre-existing report not created by the run.
- Creating Data Export and Custom Metric records, and Custom Attribute formula validation (deferred until forms are explored; see Confirmed behaviors).
- Live-saved schedules with recipients other than the logged-in user (not confirmed; see Open questions).

## Confirmed behaviors
- Output format and mode: CSV; full-run (run-config).
- Trash retention: answer given as "4w 2d" (round 1). Interpreted as the retention period shown for trashed reports; exact semantics unconfirmed (Open questions).
- Schedule frequencies other than Monthly are permitted. Recipients other than the logged-in user are permitted by the product provided they are a Lead, Contact or Agent in the system (round 1).
- A valid schedule MAY be saved live for the logged-in user only, and the test MUST delete or disable the schedule it created afterwards (round 1).
- Email Now and Download on a report are safe to run live (email goes to the logged-in user only; download saves a file locally) (round 1).
- Data Export and Custom Metrics: answer "Defer until forms are explored" (round 2). Therefore these get list/navigation test cases only; no Create Export / Create Metric cases until the forms are explored.
- A report cannot be saved with an empty name (round 2). Test case: attempt Save with empty name, expect it blocked, nothing created. This is a validation-blocked (case b) attempt and runs live regardless of mode. Exact message to be taken from the live UI.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Schedule form submitted with required fields empty | Blocked by validation, nothing saved; runs live (case b). Exact messages per `flows/schedule-report-validation.md`. |
| Valid schedule, logged-in user as sole recipient, non-Monthly frequency | Saved; test cleans up (delete/disable). |
| Schedule recipient is a Lead/Contact/Agent other than self | Permitted by the product; live save NOT authorized by default (round-2 answer "Yes" was ambiguous; see Open questions). Case written, flagged, not executed live. |
| Schedule recipient not a Lead/Contact/Agent | Not confirmed (inferred rejection only). |
| Report saved with empty name | Cannot be saved (confirmed, round 2). Runs live (case b). |
| Report with duplicate / over-long name / default "Untitled Report" | Not confirmed (see Open questions). Flag as unconfirmed; assert observed behavior only. |
| Trash a report created by the run | Moves to Trash; retention shown as "4w 2d". |
| Edit/Clone/Trash/Favorite on a curated report | Not confirmed (see Open questions). Tests must not trash or edit curated reports. |
| Data Export / Custom Metrics create forms | Deferred; list/navigation only. |

## Non-functional constraints
None raised. Authorization: tenant is the user's own trial tenant; credentials via env-file path only.

## Confirmed test-case output format
CSV

## Open questions
Bare "yes"/"Yes" answers to either/or questions, skips and unanswered sub-parts are carried here, not treated as spec. Defaults follow config (assume-standard-and-flag / flag-as-unconfirmed-case).
1. Third-party schedule recipients (round 2): the answer "Yes" to an either/or question ("save live for another Lead/Contact/Agent, or only the logged-in user?") does not say which. ASSUMED DEFAULT (flagged): only the logged-in user may be used in live execution; other-recipient cases are written but marked not-executed-live, since they would email third parties.
2. Report name validation, beyond empty name: duplicate name, max length, default "Untitled Report" rules and whether those may be attempted live are unanswered. ASSUMED DEFAULT (flagged): duplicate/over-long cases written as unconfirmed cases asserting observed behavior; a duplicate that succeeds is created by the run and trashed afterwards.
3. Curated (System) report protection (Edit/Clone/Move to trash/Favorite): round-1 "yes" unclear on which actions are protected. Tests must not trash or edit curated reports regardless.
4. Sidebar filters, Sort By, 10-per-page paging, Private vs Shared visibility: "yes" gives no behaviors. Default: generic navigation/filter checks only.
5. Landing on /analytics: "Yes" to an either/or question. Default: non-deterministic; assert only that Analytics loads.
6. Trash: "4w 2d" assumed to be retention before auto-purge. Unanswered: whether an org admin can restore or permanently delete from Trash.
7. Schedule: how failed deliveries are surfaced and behavior for recipients who are not Lead/Contact/Agent are unanswered.
8. Custom Attribute formula and Custom Metric validation (functions, name uniqueness, limits): deferred, flagged for later.
9. Coverage gaps from explore (Data Export and Custom Metrics create forms never opened) remain; per round-2 ruling these stay list/navigation only until explored. Notes in `explore/crawl-log.md` apply.

## Follow-up Questions
- [Behavior][Nice-to-have] Please answer explicitly (not Yes/No): may a test save a recurring schedule live with a Lead/Contact/Agent other than the logged-in user, or must live schedules use the logged-in user only? Navigate: Analytics > <report> > Export > Schedule report (flow schedule-report-validation).
- [Edge Case][Nice-to-have] What happens when a report is saved with a duplicate name or an over-long name (rejected with a message, or allowed), and is there a max length? Navigate: Analytics > New Report > Save (flow create-report-from-gallery-template).
