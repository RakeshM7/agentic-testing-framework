# API Test Plan - rakesh-freshsales-ind-sep21 (lead-to-deal-pipeline)

Target: `https://rakesh-freshsales-ind-sep21.myfreshworks.com/` | Requested mode: `full-run` | Effective mode this run: **readonly in practice** (see Execution status).
Endpoints discovered: 71 (`discovered-endpoints.json`, from explore network captures; the text-format logs carry no bodies, so shapes were verified live via GETs).

## Execution status
- Session: valid `_freshsales_session` cookie from `playwright-tests/.auth/freshsales-handoff.json` (the fixture now reads it; no scripted login, no CAPTCHA contact). Authenticated GETs ran live.
- Mutations NOT executed: the process environment lacks `AUTHORIZATIONS_MODE=full-run`; `.claude/hooks/guard-bash.mjs` and `fixtures/mutationGuard.ts` require it, and the hook says a human must relaunch with it set. The agent did not self-grant it. All mutating tests are real code, skipped via `skipUnlessMutationReady()` with an explicit reason. `created-entities.json` = `[]`.
- Mutating tests only touch entities they create first (logged by `fixtures/created-entities.ts`). The previous version issued PUTs against pre-existing deals/contacts; that was removed. No DELETE tests.
- Request-body envelopes (`{contact:{...}}`) and any CSRF requirement for POST/PUT are UNVERIFIED (could not run).
- k6: inspect only (passes). No live load run.

## Live-verified contract facts (2026-10-04)
- Unauthenticated + `Accept: application/json` -> 401 `{"login":"failed","message":null}`; `Accept: */*` -> 302 to signin.
- Responses are enveloped: `{contact}`, `{deal}` (+ sideloaded `deal_stages`), `{sales_account}`; lists `{contacts|deals|sales_accounts:[], meta}`. `deal.amount` is a decimal string.
- FINDING: list endpoints (`/contacts`, `/sales_accounts`) return 403 "not authorized" for a valid admin session unless a valid `segment_id` is supplied (also for `?name=` and `segment_id=abc`); a missing/invalid param should be 400/422.
- Unknown ids -> 404 `{errors:{code,message}}`; `/contacts/abc` -> 404 with empty body.
- `page=99999` -> 200 `{contacts:[],meta:{total_pages:0,total:0}}`. `per_page=1000` -> 200.
- Kanban `aggregated_data` without `group_by_value[]` -> 400.
- `GET /deals/:id/activity_counts` without `types[]` -> 200 with body `null`.

## Matrix (specs in `api-tests/playwright-api/tests/freshsales/`)
| Resource | Functional | Negative | Boundary | Auth | Schema | Status |
|---|---|---|---|---|---|---|
| Contacts | list (segment), detail; create+qualify (mutating) | 404 id, non-numeric id, no-segment 403, missing last_name*, bad email* | page 99999, per_page 1000 | unauth 401/302 (auth.spec) | {contact}, emails[] | reads PASS live; * skipped |
| Accounts | list, detail | no/invalid segment 403, 404 id, blank name* | page 9999, per_page 1000 | unauth | {sales_account} | reads PASS live; * skipped |
| Deals | list, detail, kanban aggregated; create + stage walk New>Qualification>Won* | 404, non-numeric, bad stage id*, blank name*, kanban w/o group_by_value 400 | - | unauth | amount string, stage ids | reads PASS live; * skipped |
| Tasks | list on deal; create task on run-created deal* | blank title*, nonexistent deal | - | - | {tasks:[{id,title}]} | reads PASS live; * skipped |
| Selectors | stages/statuses/lifecycle/pipelines | - | - | - | array shapes | PASS live |

Call-log and Note creation endpoints were never captured, so no tests are generated for them (previous no-op placeholders removed).

Result: `playwright test --project=freshsales-api`: 36 passed, 9 skipped (all mutating), 0 failed.

## Performance (k6, inspect-only)
- `freshsales-contacts-list-load-test.js`: GET contacts list (now with the required segment_id), ramp 0 to 15 VUs over 20s, 1m hold; p95<800ms, failures<1%.
- `freshsales-deals-kanban-load-test.js`: kanban_headers/kanban_funnels (POST, read-like; empty `{}` bodies unverified) plus aggregated_data (now with group_by_value[]), ramp to 10 VUs. Modest load.
Both load the cookie from the storageState file (`scripts/lib/freshsales-session.js`).
