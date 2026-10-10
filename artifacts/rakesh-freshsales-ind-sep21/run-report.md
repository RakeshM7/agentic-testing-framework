# Full-product run report: rakesh-freshsales-ind-sep21

**Mode: `full-run`** (set explicitly in the run-config by the user for their own trial tenant). Deletes were limited to entities each track created. Config: `config/run-config-full-product.example.yaml` (`explore_concurrency=1`, `max_parallel_tracks=4`, `max_modules=20`). This report replaces the earlier single-feature run report.

**Overall status: Awaiting clarifications (7 of 12 modules).** 5 modules completed all stages; 7 are held for human answers; none are `uncovered`.

## Module selection
- Discovered 19 modules (17 reachable). Unreachable (findings): `marketing-lists` (403), `workflows` (Page Not Found). Both excluded.
- Selected 12: dashboards, contacts, accounts, deals, conversations, analytics, products-quotes, sales-sequences, sales-activities, settings-data-model, settings-pipelines-forecasting, settings-teams-territories.
- Discovery root: `discovery/` (modules.json, flows, product-overview). Discovery's `dashboards` entry was wrong (tab 353503 is Sales Essentials; Activities Dashboard is `?tab=activities`); not corrected.

## Per-track status

| Module | Explore | Pass 1 | Pass 2 | Testcases (CSV) | Playwright | API | Status |
|---|---|---|---|---|---|---|---|
| dashboards | done (12 pages, 7 flows, gaps) | done | done | 34 | 28 pass / 0 fail / 5 skip | 12 pass; 7 endpoints (6 verified GET) | done |
| contacts | done (17 flows; own-browser deviation) | done | done | 47 | 46 pass / 0 fail / 3 skip | 77 pass; 19 endpoints | done |
| accounts | done (13 flows) | done | done | 49 | 28 pass (24 + 4 flaky re-run; 6 are intentional expected-fail) | 42 pass; 10 endpoints | done |
| sales-activities | done (18 flows) | done | done | 48 | 31 pass / 0 fail / 4 skip | 54 pass; 22 endpoint/method pairs | done |
| sales-sequences | done, partial (3 flows) | done | done | 26 | 24 pass / 0 fail / 2 skip | 41 pass; 5 operations | done |
| deals | done (21 flows) | done | done (round 1) | not started | not started | not started | awaiting-user (answers-003.csv) |
| conversations | done (13 flows) | done | done | not started | not started | not started | awaiting-user (answers-004.csv) |
| analytics | done, partial | done | done | not started | not started | not started | awaiting-user (answers-004.csv) |
| products-quotes | done (13 flows, re-explored) | done | done | not started | not started | not started | awaiting-user (answers-004.csv) |
| settings-data-model | done, view-only | done | done | not started | not started | not started | awaiting-user (answers-006.csv) |
| settings-pipelines-forecasting | done, view-only | done | done | not started | not started | not started | awaiting-user (answers-005.csv) |
| settings-teams-territories | done, view-only | done | done | not started | not started | not started | awaiting-user (answers-005.csv) |

Playwright project: `playwright-tests/freshsales/` (tests under `tests/functional/<slug>/`, `tests/visual/<slug>/`, `pages/<slug>/`). API project: `api-tests/playwright-api/` (tests under `tests/freshsales/<slug>/`). k6 scripts exist for the 5 finished tracks but **no live k6 run happened** in any track: the repo guard hook (`.claude/hooks/guard-bash.mjs`) blocked `k6 run` because `AUTHORIZATIONS_MODE` was not set in the agents' shell. The hook was not overridden.

## Clarification state (`clarifications/`)
- Main questionnaire: `questions.csv` (script-written). Answer sheets: `answers/answers-001.csv` (82 rows, answered by the human), `answers-002.csv` (11, answered), `answers-003.csv` (1, deals), `answers-004.csv` (6: conversations 1, analytics 3, products-quotes 2), `answers-005.csv` (4: settings-teams-territories 1, settings-pipelines-forecasting 3), `answers-006.csv` (1, settings-data-model). Sheets 003 to 006 (12 blocking questions) are **unanswered**.
- `answers-001.csv`: the human's save reordered the columns to `Module, Question, Answer by the user, How to navigate...`, so `scripts/clarification-csv.mjs` rejects it (header must be exact). Answers were read directly from the sheet with the script's parser. The sheet was left untouched and was **not merged** into `questions.csv`.
- `open-questions.csv` (explorers' questions) is fully answered by the human (39 rows). One row (accounts delete-cascade) was malformed; it was re-asked in the questionnaire.
- Held modules and their blocking follow-ups: deals (forecast/Won-Lost/Commit/field-limit rules, a bare "Yes"), conversations (generate Inbox/thread cases despite unstable seeded data), analytics (non-self schedule recipients, data export/custom metrics scope, report-name validation), products-quotes (test email/CSV for Send and Import, template validation messages), settings-teams-territories (Enable vs Save-as-draft for auto-assignment rules), settings-pipelines-forecasting (quota flow, system dependency edits, Add goal validation), settings-data-model (plan limits).
- Config-applied defaults used for Nice-to-have follow-ups (assume-standard-and-flag / flag-as-unconfirmed-case): generated as "unconfirmed assumption" cases. Bare "Yes" answers to non-yes/no questions and "skip / flag for later" were carried under Open questions, not as spec.

## Created entities (`created-entities.json` per track)
- Explore: dashboards 1, contacts 1, accounts 1, deals 3, conversations 2, analytics 1 (in Trash), products-quotes 3, sales-sequences 1, sales-activities 3: all deleted or soft-deleted (Recycle Bin, 90-day retention) at the time of reporting.
- Playwright tracks: dashboards 18, contacts 69, accounts 136, sales-activities 81, sales-sequences 70 entries. API tracks: dashboards 0, contacts 185, accounts 22, sales-activities 17, sales-sequences 125 entries. The one remaining undeleted entry in the accounts Playwright log (`ZZ Edit Acct 00657454`, id 402012714525) was verified gone in the tenant by the cleanup agent. All other entries are marked deleted; the sales-sequences logs are append-only, so they also hold separate created/deleted rows.
- Two cut-off sessions (rate limits) orphaned entities; a cleanup agent soft-deleted 16 `TCContacts` contacts, 2 `ZZ` accounts, and one more `TCContacts` contact, matching only recorded or `ZZ`/`TCContacts` patterns.

## Manual items for the human
- Freshdesk ticket https://support.freshdesk.com/a/tickets/21095814 (created by a misdirected "Request demo" click in the dashboards explorer). Close it.
- Six contacts `tccontacts.badmob.*@example.com` (1791193063623, 1791195227988, 1791196108603, 1791196596843, 1791197045692, 1791201187537) and `AgentTest Lead1791201398495`, `AgentTest BadPhone1791201804392`: not recorded in any `created-entities.json`; very likely test leftovers but not provably this run's, so not deleted.
- Probe task `zz task` (id 402014344358) and `TC task 1791195902885`: not found in the tenant (likely removed with their contact); not confirmed in Overdue/Completed filters.
- Dashboards: Activities Dashboard widget order changed (Quick Links is now last; all 4 visible).
- Pre-existing AgentTest contacts and the 17 pre-existing deals were not modified. `ZZ Edit Acct`, `ZZ Probe Acct` and test sequences are removed.
- Analytics test report `Explore QA Report` is in Analytics Trash; test deals/contacts/accounts/products/quote are in Recycle Bins (soft delete, nothing permanently deleted).

## Notable findings
- Explorer agents deviated from their tool rules in places: contacts used its own headless Playwright scripts; deals used `browser_run_code_unsafe`; pipelines-forecasting used `browser_evaluate` once. The shared Playwright MCP browser was not isolated when 4 explorers ran in parallel (fixed by `explore_concurrency=1`).
- Mutating API calls need the Rails CSRF token (`X-CSRF-Token`) or return 422; the shared API fixture does not send it, so earlier single-feature mutating specs (`tests/freshsales/contacts.spec.ts` has 3 failures) likely fail. Each track used its own helper.
- App defects/deviations from clarifications: accounts Phone `abc` accepted (expected-fail); account website only rejects non-URLs; account Name max 255; contacts Mobile-only save blocked (Email required); Lost with no reason saved; call-log Outcome not marked mandatory; deal value -5 accepted (human says it must be rejected); `GET /tasks?page=0&per_page=0` and blank-name `POST sales_activity_types` return 500.
- Several Playwright tracks have unautomated lower-priority cases (accounts about 17 groups, sales-activities 14, dashboards 5 skipped); see each track's testcases summary.

## Feedback files filed (not auto-implemented; `feedback_loop.auto_invoke_implementor=false`)
`feedback/playwright-automation-agent/`: 2026-10-05-dashboards-persisted-ui-state, -sales-activities-parallel-tracks, -accounts-filter-state-and-unconfirmed-rules, -contacts-clarification-vs-live-behaviour, -sales-sequences-track, -sales-sequences-resume. `feedback/api-testing-agent/`: 2026-10-05-full-run-hook-env-vs-prompt-mode, -freshsales-csrf-required-for-mutations, -freshsales-accounts-track-findings, -contacts-track-api-findings, -sales-sequences-track-findings.

## Resume
Fill `clarifications/answers/answers-003.csv` through `answers-006.csv` (and fix the `answers-001.csv` column order if you want it merged), then re-invoke with the same `configPath`. Held modules go to a second Pass 2, then testcases, Playwright and API; completed tracks are skipped.

---

# Update 2026-10-06 (second resume): answers merged, held modules run

**Overall status: Completed with 2 held modules and 2 incomplete tracks.** Mode unchanged: `full-run`; `explore_concurrency=1`.

## Clarifications
- Sheets `answers-002`, `-003`, `-004`, `-006` are complete and were merged into `questions.csv` with the script. `answers-001.csv` (82 rows) is fully answered but still rejected by the script (reordered columns); read directly, not merged. `answers-005.csv` (4 rows: settings-teams-territories 1, settings-pipelines-forecasting 3) is **unanswered**, so those two modules stay held.
- Round-2 Pass 2 ran for deals, conversations, analytics, settings-data-model and products-quotes. Non-answers ("Explore and find out", bare "Yes"/"yes", "Defer ...") were carried as Open questions with flagged defaults, not spec. No new blocking follow-ups; all remaining follow-ups are Nice-to-have.

## Track status (changes since the earlier report)

| Module | Testcases | Playwright | API | Status |
|---|---|---|---|---|
| deals | 44 | 44 pass / 0 fail / 2 skip (46 tests) | 47 pass + 1 expected-fail; 10 endpoints | done |
| conversations | 52 | 36 pass / 0 fail / 4 skip (40 tests) | 54 pass; 12 endpoints discovered, 10 covered | done |
| settings-data-model | 44 | 35 pass / 2 fail / 7 skip (44 tests); the 2 failures are product deviations left failing on purpose | 75 pass / 0 fail / 2 skip; 15 operations | done |
| analytics | 34 | 29 pass / 0 fail / 4 skip | **not completed** (agent produced no output; no `api/` folder) | incomplete (API stage) |
| products-quotes | 58 | **not finalized**: stage was stopped by the user mid-run (its last status: two tenant-timing flakes, product clone kebab and Recycle Bin lag, were being fixed); specs exist under `tests/functional/products-quotes/` | not started | incomplete (Playwright + API) |
| settings-teams-territories | not started | not started | not started | held: `answers-005.csv` unanswered (blocking: Enable vs Save-as-draft for auto-assignment rules) |
| settings-pipelines-forecasting | not started | not started | not started | held: `answers-005.csv` unanswered (blocking: quota flow, system field dependencies, Add goal validation) |

The 5 tracks reported earlier (dashboards, contacts, accounts, sales-activities, sales-sequences) are unchanged and complete.

## Created entities
All `created-entities.json` entries for the finished and resumed tracks are marked deleted (deals Playwright 115, deals API 13, conversations Playwright 17 and API 40, analytics Playwright 25, settings-data-model Playwright 106 and API 20, products-quotes Playwright 147). Test records are soft-deleted (Recycle Bin or Trash); nothing was permanently deleted. Not verified live for products-quotes after the stop.

## Manual items added
- Three email templates named "ZZ-..." (ids 402001313891, 402001313900, 402001313897) were seen on the tenant by the conversations API agent; they are not in the conversations Playwright log, so their origin is unknown. Not deleted.
- "ZZ Test Deal 912..." deals were seen by the deals Playwright agent and are not in the deals log; not deleted.
- Two Email Now messages likely went to the logged-in user (analytics); one report Download occurred.
- Soft-deleted ZZ deals, products and quotes remain in Recycle Bins (Forget is permanent and was not used).
- Live k6 never ran for any track (guard hook reads `AUTHORIZATIONS_MODE` from the shell; not overridden). For mutating API tests, `AUTHORIZATIONS_MODE=full-run` must be exported in the Playwright process.

## New feedback files (2026-10-06)
playwright-automation-agent: conversations-track, analytics-track, settings-data-model-track, deals-track. api-testing-agent: conversations-email-template-api-defects, settings-data-model-track, deals-track.

## Resume
1. Answer `clarifications/answers/answers-005.csv`.
2. Re-invoke with the same `configPath`: held modules run Pass 2 round 2, then testcases, Playwright and API; products-quotes (finish and verify Playwright, then API) and analytics (API) are redone; completed tracks are skipped.
