# Dashboards - Clarifications

Target: rakesh-freshsales-ind-sep21 (Freshsales CRM, trial tenant). Track: dashboards. Source of answers: modules/dashboards/clarifications/answers-block.md. Flows covered: every slug in explore/flows/index.json (open-dashboards, switch-dashboard-tab, configure-activities-widgets, filter-activity-types, add-report-tab, export-dashboard, edit-curated-dashboard).

## Feature summary
Dashboards (My dashboards, `/crm/sales/my_dashboards`) shows a row of dashboard tabs, each with widgets, filters, Export and (for curated reports) Edit. Users can add a curated or analytics-built report as a new tab via "+", remove run-created tabs, configure widgets on the Activities Dashboard, export/email a dashboard, and enter/discard edit mode on curated dashboards.

Default tabs (confirmed targets, Q1):
- Sales Essentials Dashboard: tab 353503. Export/Edit enabled. Pages include Summary, Contacts, Sales activities, Revenue breakdown.
- Sales Dashboard: tab 81767.
- Activities Dashboard: `?tab=activities`. Native widgets (My calendar, Quick Links, Today's summary, Freddy AI insights), no Export/Edit.

## In scope / Out of scope
In scope:
- All seven flows listed above.
- Default tabs listed above.
- Add-report-tab, then removal of that run-created tab.
- Configure widgets Save, then restore of the original 4/4 visible state.
- Export (Email Now / Download) and Edit/Discard of curated dashboards.
- Custom dashboard creation from existing analytics reports (confirmed possible, A3).

Out of scope / must not be done:
- Clicking top-bar "Request demo" (auto-creates a Freshdesk support ticket).
- Removing any of the three default tabs.
- Any delete of entities not created by the run.

## Confirmed behaviors
- Output and mode: test cases are delivered as CSV; `authorizations.mode` is `full-run` (set explicitly by the user for their own trial tenant). Deletes apply only to entities the run created.
- Default tabs: the three observed tabs above are the default dashboards for test cases (Q1: Yes). The discovery description (Activities tab 353503 with Export/Edit disabled) is superseded.
- Direct URL navigation to `/crm/sales/my_dashboards` opens My dashboards (A2). Earlier explorer observations of landing on Contacts/Deals/Accounts are treated as a false observation. Tests may navigate by URL.
- Curated dashboards can be edited. Custom dashboards can be created by choosing any report already created in the Analytics module (A3).
- Email Now sends the report by email to the currently logged-in user. Export/Download downloads the file directly to the user's machine. Both are safe in test runs (A4).
- Configure widgets Save (hide/show/reorder) is safe to run live. The test must restore the original 4/4 visible state afterward (Q5: Yes).
- Removing a dashboard tab is permitted only for tabs created by the run (e.g. Sales Trends). The three default tabs are never removed (Q6: Yes).
- "Request demo" is excluded from tests (Q12: Yes, interpreted as "exclude"; see Open questions for ticket 21095814).

Live-execution ruling (basis: `authorizations.mode = full-run`):
- (a) Submissions that can succeed and mutate data (add report tab, Configure widgets Save, Add task/meeting if included): run live, with cleanup/restore limited to run-created entities or the restored original state.
- (b) Submissions expected to be blocked by validation before any mutation (e.g. report search with no match, invalid filter input): not mutating, run live in any mode.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Direct URL to /crm/sales/my_dashboards | Opens My dashboards module (A2) |
| Attempt to remove a default tab | Not performed; never in tests |
| Add same report as tab twice | UNCONFIRMED (see Open questions) |
| Report search with no match | UNCONFIRMED (see Open questions) |
| Activity-type filter / due-date (Today) / All-Open-Overdue-Completed pills, incl. empty state | UNCONFIRMED (see Open questions) |
| Edit mode then Discard on curated dashboard | Edit exposes Discard and filters only (explorer observation); Discard returns to view mode with no change |
| Configure widgets Save, then restore | Original 4/4 widgets visible after restore |

## Non-functional constraints
- Widget data is cached (Data Updated stamp), so values can be stale; see Open questions on value assertions.
- Export downloads to the local machine; Email Now goes only to the logged-in user.
- No requirement docs, performance or accessibility constraints were raised.

## Confirmed test-case output format
CSV

## Open questions
Non-answers (the answer "Yes" was given to a question that was not yes/no, so no spec is derived; defaults below are assumptions only):
1. Which popular reports should add-report-tab cover (Chat Dashboard, Ecommerce Marketing Journey Report, Product Dashboard, Team activity report, Sales Trends, Sales Forecast, Contact generation and trends)? Answer was "Yes". Assumption: Sales Trends is the live-executed case; others are listed as lower-priority/optional.
2. Expected behavior when the same report is added twice, or the report search finds no match? Answer was "Yes". No behavior known; test cases must not assert a specific outcome until observed or confirmed.
3. Assert widget values (Revenue won $12.3K, win rate 66.67%, tasks open 4) or only presence/titles? Answer was "Yes". Assumption: assert presence/titles and non-empty values only, not exact figures (data cached, tenant may change).
4. Behavior of the activity-type filter, due-date filter (Today) and All/Open/Overdue/Completed pills, including the empty state? Answer was "Yes", which does not describe behavior. Expected results are unconfirmed.
5. Sales Essentials pages not exercised (Contacts, Sales activities, Revenue breakdown), page Rename/Delete, favourite star, filter panel +filter/+date range: cover them or only observed flows? Answer was "Yes" (ambiguous between the two options). Assumption: include as additional cases, with expected results unconfirmed. Rename/Delete limited to run-created pages.
6. Add task / Add meeting on Activities Dashboard: test live (then delete) or exclude? Answer was "Yes" (ambiguous). Assumption: live only with run-created tasks/meetings deleted afterward; confirm.
7. Request demo: answer "Yes" to a compound question; assumed "exclude". Whether a human has closed Freshdesk ticket 21095814 is unconfirmed.

Contradictions / discrepancies recorded, not resolved:
- Explorer observed direct URL navigation landing on other modules, while the human states this is a false observation (A2). Tests should navigate by URL but flag if flakiness recurs.
- flows/index.json marks configure-activities-widgets as `mutating: false` (flow only opens the panel), but the confirmed ruling covers Save and restore, which mutates. Flow `edit-curated-dashboard` navPath uses "Sales Trends > Edit" while Q1 states Sales Essentials (353503) also has Edit enabled.
- "Add report" flow is marked create+remove; a custom-dashboard creation flow (from Analytics reports) was confirmed to exist but was not explored: no flow, steps, or UI observed.

Coverage gaps: check `modules/dashboards/explore/crawl-log.md` `## Coverage gaps` and `## Feature-mapping caveats`; no new caveat items were supplied to this pass.

## Follow-up Questions
- [Behavior] [Nice-to-have] What happens when the same report is added as a dashboard tab twice, and what message appears when the report search has no match? Navigate: Dashboards > + > Select a report > Search report (flow add-report-tab).
- [Behavior] [Nice-to-have] What results should the activity-type filter, due-date filter (Today) and All/Open/Overdue/Completed pills produce, including the empty state? Navigate: Dashboards > Activities Dashboard > activity type filter (flow filter-activity-types).
- [Scope] [Nice-to-have] Should Add task / Add meeting on the Activities Dashboard be tested live (run-created, then deleted) or excluded? Navigate: Dashboards > Activities Dashboard > Add task / Add meeting.
- [Scope] [Nice-to-have] Should a new flow be explored/tested for creating a custom dashboard from an existing Analytics report, and which report should be used? Navigate: Dashboards > + > Select a report (flow add-report-tab).
- [Behavior] [Nice-to-have] Has the Freshdesk ticket 21095814 created by Request demo been closed by a human? Navigate: Dashboards > top bar > Request demo (do not click; ticket is in the Freshdesk support portal).
