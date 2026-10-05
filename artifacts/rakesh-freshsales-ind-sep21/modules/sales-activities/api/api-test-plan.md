# API test plan: sales-activities (Freshsales, mode full-run)

Discovery: per-page network captures were placeholders, so contracts were live-probed 2026-10-05 against the trial tenant (session from `.auth/freshsales-handoff.json`), plus the observed `POST /crm/sales/phone_calls = 201`. 22 endpoint/method pairs in `discovered-endpoints.json`.

Key contract facts
- Reads authenticate with the session cookie alone. Mutations ALSO need the Rails CSRF token (`<meta name="csrf-token">` from an HTML page, sent as `X-CSRF-Token`); without it every POST/PUT/DELETE returns `422 {"error_code":422}`. The shared fixture sends a bare Cookie header, so this track uses its own helper (`api-tests/playwright-api/helpers/freshsales/sales-activities-track.ts`).
- Unauthenticated: `Accept: application/json` -> 401 `{login:"failed"}`; `Accept: text/html` -> 302.
- Validation errors: 400 `{errors:{code,message:[...]}}`; missing rows: 404 with entity-specific message.

Matrix (spec: `api-tests/playwright-api/tests/freshsales/sales-activities/sales-activities.spec.ts`)
| Endpoint | Functional | Negative | Boundary | Auth | Schema |
|---|---|---|---|---|---|
| tasks list/show | list open | 404 id, non-numeric id | per_page, page=99999, page=0/per_page=0 (defect 500) | 401/302 on 5 resources | tasks[] shape, meta.total |
| tasks create/update/delete | create with targetable, rename, complete, delete | blank title, missing due_date, no wrapper, malformed JSON, PUT 404, repeat DELETE 404 | 2000-char title (no 5xx) | missing CSRF -> 422; delete refuses ids outside the run log | targetables |
| appointments | create/update/get/delete | blank fields (3 msgs), IANA tz rejected | - | 401/302 | list + meta |
| phone_calls | create (201), get, delete | collection GET 404 | - | - | notes/call |
| sales_activities | list | /fields 404 | - | 401/302 | meta.total_pages |
| settings/sales_activity_types (+selector) | list, show | 404, wrong path 404, blank name (defect 500), bad internal_name 400 | - | 401/302 | default types, partial flag |
| activities_dashboard, activity_goals | summary, widgets | - | - | goals 403 | widgets |

Not covered (explicit): successful custom activity-type creation (valid `internal_name` format undiscovered), activity-goal CRUD (403 on the API route; UI-only), SMS and email sends (excluded by authorization).

Performance: `api-tests/k6/scripts/sales-activities-tasks-load-test.js`, read-only GETs on 4 dashboard calls, 0->5 VUs 20s, hold 40s, down 10s; thresholds p95<1500ms, failure rate <1%.
Execution: `k6 inspect` passed. A live run was attempted and BLOCKED by `.claude/hooks/guard-bash.mjs` (process env AUTHORIZATIONS_MODE not full-run); hook not overridden. No result file exists for this script.

Entities: `created-entities.json` (this folder): all ZZ contact/task/meeting/call entities logged at creation and deleted in the same run; DELETE guarded by `isOurs()`.
