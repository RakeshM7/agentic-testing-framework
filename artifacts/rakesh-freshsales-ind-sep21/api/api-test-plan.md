# API Test Plan — rakesh-freshsales-ind-sep21 (lead-to-deal-pipeline)

Target: `https://rakesh-freshsales-ind-sep21.myfreshworks.com/`
Mode: `authorizations.mode: full-run` (explicitly authorized for this tenant)
Source grounding: `artifacts/rakesh-freshsales-ind-sep21/api/discovered-endpoints.json`, `.../explore/crawl-log.md`, `.../clarifications/lead-to-deal-pipeline-clarifications.md`, `.../testcases/lead-to-deal-pipeline-testcases.csv`.

## Execution status — read this first

**`mode: full-run` authorizes full GET/POST/PUT/PATCH/DELETE coverage for this tenant, but almost none of it could actually be executed live this run.** This inherits the exact blocker `playwright-automation-agent` hit and documented in `feedback/playwright-automation-agent/2026-09-21-freshsales-recaptcha-blocks-scripted-login.md`:

- This tenant's `/crm/sales/*` app API authenticates via a **session cookie** obtained only through a full interactive login (confirmed live: an unauthenticated `GET /crm/sales/contacts` returns `302` to `/crm/sales/signin`, not a 401/JSON error — verified by this agent, read-only, 2026-09-21).
- The login form is gated by a **Google reCAPTCHA challenge** that reliably triggers for scripted browser sessions (confirmed by playwright-automation-agent across headless/headed Chromium and a real Chrome channel, human-paced input included).
- Playwright's `APIRequestContext` (what this agent's specs use) has the same limitation as a scripted browser here: it cannot solve a visual CAPTCHA, and there is no token-based alternative auth surface exposed by this tenant's UI (no `Authorization: Bearer` header on any captured call). No pre-authenticated `storageState` file exists in this repo for the `freshsales` target (`playwright-tests/.auth/` only contains the EventHub target's session).
- Per this agent's own hard rule, **this blocker is not attempted to be bypassed** (no CAPTCHA-solving service, no credential-stuffing retries). It is documented and the run proceeds with whatever is possible statically/read-only.

**What *was* actually executed live this run** (safe, non-mutating, does not require the blocked session) — `tests/freshsales/auth.spec.ts`, **5/5 passed**:
- Unauthenticated `GET /crm/sales/{contacts,deals,sales_accounts}` with `Accept: application/json` (this project's default, and what any real API client sends) → confirmed **401** with JSON body `{"login":"failed","message":null}`, never leaking record data.
- The same unauthenticated `GET /crm/sales/contacts` with `Accept: */*` (curl's default / a plain browser navigation) → confirmed **302 → /crm/sales/signin**, an HTML flow.
- This is a genuine **content-negotiated auth-failure contract**, discovered empirically (curl first, then reproduced with a real Playwright `APIRequestContext` to confirm it isn't a curl-only artifact) — not assumed from a single probe.
- `k6 inspect` static validation of every generated k6 script (see `api-tests/k6/README.md`).

**What was generated but could NOT be executed live this run** (requires the authenticated session): every Functional/Boundary/Schema case below, and every Negative case that needs an authenticated request to distinguish "blocked by validation" from "blocked by auth." These are written as real, runnable Playwright specs (not stubs) that will pass/fail meaningfully the moment a valid session is available (see `api-tests/playwright-api/README.md` for how to supply one), and are `test.skip()`-guarded with an explicit reason rather than deleted or faked as passing.

`artifacts/rakesh-freshsales-ind-sep21/api/created-entities.json` is an **empty array** — zero entities were created via the API this run, for the reason above (no mutating call could be attempted without a session in the first place).

---

## 1. Contacts (`/crm/sales/contacts`)

| # | Category | Scenario | Method/Endpoint | Expected | Live status |
|---|---|---|---|---|---|
| 1.1 | Functional | Create a Contact with unique first/last name + email (lead stand-in, default Status=New/Lifecycle=Lead) | `POST /crm/sales/contacts` | 200, body echoes created contact with `contact_status.name === "New"` | Blocked (auth) |
| 1.2 | Functional | Fetch the created Contact by id | `GET /crm/sales/contacts/:id` | 200, id matches, `lifecycle_stage.name === "Lead"` | Blocked (auth) |
| 1.3 | Functional | Advance Contact Status to Qualified | `PUT /crm/sales/contacts/:id` | 200, `contact_status.name === "Qualified"` AND `lifecycle_stage.name === "Sales Qualified Lead"` (auto-promotion) | Blocked (auth) |
| 1.4 | Negative | Create Contact missing required `last_name` | `POST /crm/sales/contacts` | 4xx with a field-level validation error referencing `last_name`; no contact id in response | Blocked (auth) — this is a validation-only, non-mutating expected outcome, but the request itself still needs a session to reach the validator (unauth requests 302 before validation runs) |
| 1.5 | Negative | Create Contact with malformed email (`not-an-email`) | `POST /crm/sales/contacts` | 4xx with a field-level validation error referencing email format | Blocked (auth) |
| 1.6 | Negative | `GET` a nonexistent contact id | `GET /crm/sales/contacts/999999999999` | 404 (not 500) | Blocked (auth) |
| 1.7 | Negative | `GET` a non-numeric contact id | `GET /crm/sales/contacts/abc` | 4xx, not 500 | Blocked (auth) |
| 1.8 | Boundary | Duplicate-email create (email matching an existing contact) | `POST /crm/sales/contacts` + `POST /crm/sales/contacts/:id/duplicates` | UNCONFIRMED (clarifications Open Question 1) — record actual behavior, don't hard-fail on either outcome | Blocked (auth) |
| 1.9 | Auth | Unauthenticated request, JSON-accepting client | `GET /crm/sales/contacts` (no session cookie, `Accept: application/json`) | **401**, body `{"login":"failed","message":null}` | **EXECUTED LIVE — PASSED** |
| 1.9b | Auth | Unauthenticated request, browser-style client | `GET /crm/sales/contacts` (no session cookie, `Accept: */*`) | **302 → `/crm/sales/signin`** | **EXECUTED LIVE — PASSED** |
| 1.10 | Auth | Invalid/garbage session cookie | `GET /crm/sales/contacts` with a bogus `Cookie` header | Expect 401/redirect, not 500 or a data leak | Blocked (cannot meaningfully test without first knowing the real cookie's shape/name) |
| 1.11 | Schema/contract | Contact response shape | (via 1.2) | `id: number`, `first_name/last_name: string`, `emails: array`, `contact_status: {id, name}`, `lifecycle_stage: {id, name}` all present and correctly typed | Blocked (auth) |

## 2. Accounts (`/crm/sales/sales_accounts`)

| # | Category | Scenario | Method/Endpoint | Expected | Live status |
|---|---|---|---|---|---|
| 2.1 | Functional | Inline account auto-create resolves by name | `GET /crm/sales/sales_accounts?name=<name>` | 200, exactly one match after 1.1's inline creation | Blocked (auth) |
| 2.2 | Negative | Inline account create with blank name | `POST /crm/sales/sales_accounts` (name: "") | 4xx validation error | Blocked (auth) |
| 2.3 | Boundary | Accounts list pagination — `per_page` far beyond result count | `GET /crm/sales/sales_accounts?per_page=1000` | 200, returns all available rows, no error | Blocked (auth) |
| 2.4 | Boundary | Accounts list — page beyond last page | `GET /crm/sales/sales_accounts?page=9999` | 200, empty result set, not an error | Blocked (auth) |
| 2.5 | Schema/contract | Account response shape | (via 2.1) | `id: number`, `name: string` present and typed | Blocked (auth) |
| 2.6 | Auth | Unauthenticated request | `GET /crm/sales/sales_accounts` | 302 → signin | Same pattern as 1.9, not separately re-run (covered by the general auth.spec.ts sweep) |

**Note:** per the clarifications doc, standalone Account creation (independent of the inline Contact-form path) is explicitly out of scope — no dedicated `POST /crm/sales/sales_accounts` test case beyond the inline-create verification in 2.1.

## 3. Deals (`/crm/sales/deals`)

| # | Category | Scenario | Method/Endpoint | Expected | Live status |
|---|---|---|---|---|---|
| 3.1 | Functional | Create a Deal on Default Pipeline linked to the qualified Contact/Account | `POST /crm/sales/deals` | 200/201, initial `deal_stage.name === "New"` | Blocked (auth) |
| 3.2 | Functional | Move Deal through New → Qualification → Discovery → Demo → Negotiation → Won (5 sequential PUTs) | `PUT /crm/sales/deals/:id` ×5 | Each 200 with `deal_stage.name` matching the target stage; final state `Won` | Blocked (auth) |
| 3.3 | Functional | Move a **separate** Deal to Lost (distinct terminal branch) | `PUT /crm/sales/deals/:id` | 200, `deal_stage.name === "Lost"` | Blocked (auth) |
| 3.4 | Functional | Kanban board reflects the moved Deal in its new stage column | `GET /crm/sales/deals/view/:viewId/aggregated_data?group_by_value[]=<wonStageId>` | 200, the deal id from 3.2 appears in the Won column's dataset | Blocked (auth) |
| 3.5 | Negative | Create Deal with blank `name` | `POST /crm/sales/deals` | 4xx validation error, no deal id returned | Blocked (auth) |
| 3.6 | Negative | `PUT` an invalid/nonexistent `deal_stage_id` | `PUT /crm/sales/deals/:id` (`deal_stage_id: 999999999`) | 4xx, not 500, and the deal's actual stage remains unchanged | Blocked (auth) |
| 3.7 | Negative | `GET`/`PUT` a nonexistent deal id | `GET/PUT /crm/sales/deals/999999999999` | 404 | Blocked (auth) |
| 3.8 | Boundary | Deals list default segment pagination | `GET /crm/sales/deals?per_page=1` | 200, exactly 1 row returned | Blocked (auth) |
| 3.9 | Schema/contract | Deal response shape | (via 3.1/3.2) | `id: number`, `name: string`, `amount: number`, `deal_stage: {id, name}`, `deal_pipeline: {id, name}`, `contacts`/`sales_account` linkage present | Blocked (auth) |
| 3.10 | Boundary (secondary/optional per Q4) | Drag-and-drop-equivalent stage move via a single PUT to a non-adjacent stage (e.g. New → Demo directly) | `PUT /crm/sales/deals/:id` | Determine live whether the API allows skipping intermediate stages (UI drag-and-drop is nice-to-have per clarifications; the underlying PUT contract question is still worth answering) | Blocked (auth) |

## 4. Activities — Tasks / Calls / Notes

| # | Category | Scenario | Method/Endpoint | Expected | Live status |
|---|---|---|---|---|---|
| 4.1 | Functional | Log a Task against the Deal | `POST /crm/sales/tasks` | **201** (confirmed shape from explore-agent's capture) | Blocked (auth) |
| 4.2 | Functional | Log a Call activity against the Deal | Endpoint NOT captured — likely `POST /crm/sales/sales_activities` or similar; must be discovered live from the "Call log" form's network request | 2xx | Blocked (auth) — additionally blocked on endpoint discovery, not just auth |
| 4.3 | Functional | Log a Note against the Deal | Endpoint NOT captured — likely `POST /crm/sales/deals/:id/notes` (by analogy with `GET /crm/sales/contacts/:id/notes`) | 2xx | Blocked (auth) — additionally blocked on endpoint discovery |
| 4.4 | Functional | Deal's task list reflects the created Task | `GET /crm/sales/deals/:id/tasks` | 200, task from 4.1 present, count +1 | Blocked (auth) |
| 4.5 | Functional | Deal's activity_counts reflects new counts | `GET /crm/sales/deals/:id/activity_counts?types[]=tasks&types[]=notes&types[]=appointments` | 200, `tasks` count matches | Blocked (auth) |
| 4.6 | Negative | Create Task with blank `title` | `POST /crm/sales/tasks` | 4xx validation error | Blocked (auth) |
| 4.7 | Schema/contract | Task response shape | (via 4.1) | `id: number`, `title: string`, `due_date`, `owner: {id, name}`, `completed: boolean` present and typed | Blocked (auth) |

**Note on 4.2/4.3:** per the clarifications doc's own admission, Call/Note creation endpoints were never captured live (only Task creation was, via `POST /crm/sales/tasks` → 201). The generated specs for these two are written defensively — they probe a documented "best-guess" endpoint shape and are `test.skip()`ed with a clear reason (both the auth blocker AND the endpoint-shape unknown) rather than asserting against a guessed contract as if it were confirmed.

## 5. Selectors / Pipeline config (read-only reference data)

| # | Category | Scenario | Method/Endpoint | Expected | Live status |
|---|---|---|---|---|---|
| 5.1 | Functional | Deal pipeline/stage order matches the confirmed Default Pipeline sequence | `GET /crm/sales/settings/deal_pipelines?include=deal_stages` | 200, stage names in order: New, Qualification, Discovery, Demo, Negotiation, Won, Lost | Blocked (auth) |
| 5.2 | Functional | Contact status enum matches confirmed values | `GET /crm/sales/selector/contact_statuses` | 200, includes New/Contacted/Interested/Qualified/Won/Churned | Blocked (auth) |
| 5.3 | Functional | Lifecycle stage enum includes Lead and Sales Qualified Lead | `GET /crm/sales/selector/lifecycle_stages` | 200 | Blocked (auth) |
| 5.4 | Schema/contract | All `/crm/sales/selector/*` endpoints return a consistent `[{id, name}]` shape | All selector endpoints | 200, array of objects with numeric `id` and string `name` | Blocked (auth) |

## 6. Leads module — explicitly out of scope

Per the finalized clarifications doc (human answer, Q2) and this run's explicit instructions: **no test case targets `GET /crm/sales/leads`**, including no negative/403 assertion. It is listed in `discovered-endpoints.json` for discovery completeness only. This is a deliberate scoping decision, not an oversight — do not add coverage for it in a future run without a new human decision overriding Q2.

---

## 7. Performance (k6)

Two candidate endpoints, chosen because they're the highest-traffic reads in the captured flow and have a clear pass/fail latency expectation for a CRM list/board view:

| Script | Endpoint(s) | Profile | Thresholds | Rationale |
|---|---|---|---|---|
| `scripts/freshsales-contacts-list-load-test.js` | `GET /crm/sales/contacts?...` | Ramp 0→15 VUs over 20s, hold 1m, ramp down 10s | `http_req_failed` rate < 1%; `http_req_duration` p95 < 800ms | Contacts list is the highest-traffic authenticated read observed in the crawl (loaded on every Contacts-module page view); models a sales rep repeatedly refreshing/filtering their list. |
| `scripts/freshsales-deals-kanban-load-test.js` | `POST /crm/sales/deals/kanban_headers`, `POST /crm/sales/deals/kanban_funnels`, `GET /crm/sales/deals/view/:id/aggregated_data` | Ramp 0→10 VUs over 15s, hold 1m | `http_req_failed` rate < 1%; `http_req_duration` p95 < 1200ms (Kanban aggregation across multiple stage columns is inherently heavier than a flat list) | The Kanban board is the core "pipeline" UI for this feature; 3 endpoints fire together on every board load/refresh, so it's the realistic multi-call unit to load-test rather than one endpoint in isolation. |

Both scripts require a valid session cookie (`FRESHSALES_SESSION_COOKIE` env var) to run against the live tenant — **neither was run live this session** (same auth blocker as above). Both pass `k6 inspect` (structural/options validation, zero network traffic) — see `api-tests/k6/README.md` for the actual inspect output and instructions for a human to supply a real cookie and run them for real later.

---

## Summary

- **26 endpoints discovered** across contacts, sales_accounts, deals, tasks, selectors, settings, and misc (see `discovered-endpoints.json`'s `endpoints` array for the exact count — 27 entries including the out-of-scope `leads` entry and the non-captured `sales_activities` placeholder).
- **Live execution this run:** 5 unauthenticated auth-boundary checks in `tests/freshsales/auth.spec.ts` (all PASS, and surfaced a genuine content-negotiated 401-JSON-vs-302-HTML contract along the way), plus `k6 inspect` on 2 scripts. Everything else is generated, real, runnable Playwright/k6 code, blocked on the same reCAPTCHA-gated session wall already reported by playwright-automation-agent — not a quality gap in this agent's own output.
- **Recommendation for unblocking a future run:** either (a) a human completes the Freshsales login once interactively and exports a Playwright `storageState`/session-cookie value for reuse (analogous to `credentials_file` but a session snapshot), or (b) the tenant/IP is added to a CAPTCHA allowlist for automation traffic. See the referenced feedback file for the same recommendation already filed by playwright-automation-agent — this agent does not re-file a duplicate, only cross-references it.
