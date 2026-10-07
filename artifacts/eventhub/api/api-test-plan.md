# EventHub API — Test Plan

Target: `https://eventhub.rahulshettyacademy.com` (frontend) / `https://api.eventhub.rahulshettyacademy.com` (API host)
Feature cross-reference: `artifacts/eventhub/clarifications/event-booking-clarifications.md`,
`artifacts/eventhub/testcases/event-booking-testcases.md`,
`artifacts/eventhub/clarifications/app-wide-clarifications.md`,
`artifacts/eventhub/testcases/app-wide-testcases.md`
Endpoint inventory: `artifacts/eventhub/api/discovered-endpoints.json`

**This document covers two feature runs against the same 15-endpoint API surface:**
- Sections 1–13 (original): the `event-booking` feature (booking creation/cancellation flow).
- Sections 14–19 (added by the `app-wide` run, 2026-09-20): registration, login,
  events search/filtering, My Bookings management, admin event management, and RBAC. No new
  endpoints were discovered for this second pass — see `discovered-endpoints.json`'s
  `appWideRunExtension` key for the re-verification note and feature-to-endpoint map. Sections
  1–13 are left as originally written; the app-wide sections extend/cross-reference them rather
  than duplicating their content.

## Discovery summary

**Primary source: OpenAPI/Swagger spec**, `openapi: 3.0.0`, `info.title: EventHub API`, `info.version: 1.0.0`.
The rendered docs page is at `https://api.eventhub.rahulshettyacademy.com/api/docs/`. There is no
dedicated JSON-export route (`/api/docs/json`, `/api/docs-json`, `/openapi.json`, `/api/docs.json`
all 404 or fall through to the same swagger-ui HTML shell). The full spec is embedded as the
`swaggerDoc` object inside `https://api.eventhub.rahulshettyacademy.com/api/docs/swagger-ui-init.js`,
which the static swagger-ui bundle evaluates client-side — it was extracted from there.

**15 operations across 10 path templates**, tags: Auth, Events, Bookings, Health, plus one untagged
`Config` route:

| Resource | Operations |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Events | `GET /events`, `POST /events`, `GET /events/:id`, `PUT /events/:id`, `DELETE /events/:id` |
| Bookings | `GET /bookings`, `POST /bookings`, `GET /bookings/ref/:ref`, `GET /bookings/:id`, `DELETE /bookings/:id` |
| Health | `GET /health` |
| Config | `GET /config` |

**Secondary source (cross-reference only):** the 8 `network-requests.json` captures from
explore-agent. As predicted in the crawl-log, client-visible XHR is sparse (this is a Next.js app
that fetches almost everything server-side via RSC). The only client-visible API call observed
anywhere is `GET https://api.eventhub.rahulshettyacademy.com/api/config`, which matches `GET
/config` in the spec exactly — confirming the spec is live/accurate for at least this route.

**Reliability signal carried over from the clarifications doc (not a REST endpoint, but in scope
per that doc):** all 8 captures show intermittent `503`s on Next.js RSC prefetches
(`/events/283|284|285?_rsc=...`) when prefetched from the listing/home page, while direct
navigation to the same route succeeds. This is frontend SSR behavior, not part of the documented
REST surface, so it isn't a numbered API endpoint below, but a note is included under Bookings/Events
performance and reliability sections since it may share root cause with backend load.

### Contract discrepancy flagged during discovery

The spec declares `security: [{bearerAuth: []}]` **only** on `GET /auth/me`. Every Events and
Bookings route is documented with **no** security requirement, yet the spec's own top-level
description says: *"Each registered user gets a fully isolated sandbox — events and bookings are
private to their account."* That's a direct contradiction: sandboxed-per-account data implies
Bookings (and plausibly Events) must be gated by the bearer token, but the spec's `security` blocks
say otherwise. Treated as unverified/unknown, not as ground truth. Every Bookings/Events read
scenario below is tested three ways (no token / valid token / invalid token) specifically to resolve
this discrepancy empirically, and the actual observed behavior — not the spec's silence — is what
should be captured as the real contract going forward.

### Known real fixtures used throughout

| Event ID | Title | Price/ticket | Seats (approx, drifts over time) |
|---|---|---|---|
| 283 | World Tech Summit | $1,500 | ~229–233 / 500 |
| 284 | Hollywood Monsoon Night | $2,500 | ~2,959 / 3,000 |
| 285 | Dilli Diwali Mela | $300 | ~8,912 / 10,000 |

Test account: `EVENTHUB_EMAIL` / `EVENTHUB_PASSWORD` from `playwright-tests/.env` (existing,
verified-working dogfood account, reused rather than registering a new one).

---

## Guardrails applied to this plan

- **No live k6 load run, ever**, regardless of what's below — this document only records the
  *intended* profile for a human to run against a target they control (e.g. a staging clone), or
  for `k6 inspect` static validation.
- **Playwright API specs are GET-only against the live target.** The one narrow exception is a
  single `POST /auth/login` call in test setup, used purely to obtain a bearer token so the
  auth-required `GET /auth/me` and the auth-discrepancy checks on Bookings/Events can be exercised —
  it authenticates an already-existing account, it does not create or mutate any business data.
  `POST /auth/register`, `POST /events`, `PUT /events/:id`, `DELETE /events/:id`, `POST /bookings`,
  and `DELETE /bookings/:id` are **not** called by any generated Playwright test. They still appear
  in the scenario matrix below (a test plan documents intended coverage even where the harness
  deliberately abstains), each row marked `NOT EXECUTED (mutating, live 3rd-party target)`.

---

## Scenario matrix

### 1. `POST /auth/register` — NOT EXECUTED (mutating, live 3rd-party target)

| Category | Scenario | Expected |
|---|---|---|
| Functional | Valid email + password ≥ 6 chars | 201, `AuthResponse` (token + user.id/email) |
| Negative | Missing email or password | 400, `ValidationErrorResponse` with `details[].field` |
| Negative | Malformed email (no `@`) | 400, validation error on `email` |
| Negative | Password < 6 chars | 400, validation error on `password` |
| Negative | Email already registered | 400, `"error": "..."` (spec: "email already registered") |
| Negative | Wrong `Content-Type` (e.g. `text/plain` body) | 400/415 depending on framework body-parser behavior |
| Boundary | Password exactly 6 chars (min boundary) | 201 accepted |
| Schema | Response shape matches `AuthResponse`: `success:boolean`, `token:string`, `user:{id:int,email:string}` | pass |

### 2. `POST /auth/login` — setup-only exception (executed once per test run to acquire a token)

| Category | Scenario | Expected |
|---|---|---|
| Functional | Valid `EVENTHUB_EMAIL` / `EVENTHUB_PASSWORD` | 200, `AuthResponse` with non-empty JWT `token` |
| Negative | Correct email, wrong password | 400, `{"error":"Invalid credentials"}` (or similar) |
| Negative | Unregistered email | 404, `{"error":"User not found"}` |
| Negative | Missing password field entirely | 400 validation error |
| Negative | Missing `Content-Type: application/json` | 400/415 |
| Schema | Response shape matches `AuthResponse` | pass |

*(Executed via a worker-scoped Playwright fixture, not as a standalone assertion-heavy spec file —
only the happy-path call is actually made live, to avoid needlessly hammering the login endpoint;
the negative sub-cases above are documented here for completeness/handoff but are not auto-executed,
consistent with keeping live traffic to this third-party target minimal.)*

### 3. `GET /auth/me`

| Category | Scenario | Expected |
|---|---|---|
| Functional | Valid bearer token from login | 200, `MeResponse` (`user.userId`, `user.email` matching the logged-in account) |
| Auth | No `Authorization` header | 401, `{"success":false,"error":"Unauthorized"}` |
| Auth | Malformed header (`Authorization: <token>` without `Bearer ` prefix) | 401 expected |
| Auth | Well-formed but garbage/invalid JWT | 401 expected |
| Auth | Expired token | 401 expected — **not independently reproducible without waiting out the 7-day expiry or a forged-exp token; documented as a gap, not executed** |
| Schema | Response shape matches `MeResponse` | pass |

### 4. `GET /events`

| Category | Scenario | Expected |
|---|---|---|
| Functional | No query params (defaults) | 200, `data[]` of `Event`, `pagination` present, `pagination.limit === 10` |
| Functional | `category=Conference` | 200, every returned `data[].category === "Conference"` |
| Functional | `city=Hyderabad` | 200, every returned `data[].city === "Hyderabad"` |
| Functional | `search=Tech` | 200, results relevant to the term (best-effort substring check on title/description) |
| Boundary | `limit=100` (max) | 200, ≤ 100 items returned |
| Boundary | `limit=101` (over max) | Contract question: spec says `maximum:100` — verify live whether API clamps, ignores, or 400s; assert observed behavior, don't assume |
| Boundary | `limit=0` or negative | Contract question: spec says `minimum:1` — same treatment |
| Boundary | `page` far beyond last page (e.g. `page=9999`) | 200 with empty `data:[]`, not a 404/500 |
| Negative | `category` value not in the documented enum (e.g. `category=Bogus`) | Verify: empty result set vs 400 — spec doesn't say |
| Negative | Non-numeric `page`/`limit` (e.g. `page=abc`) | Verify: 400 vs silently coerced to default |
| Auth | No token vs valid token vs invalid token | **Resolves the contract discrepancy** — spec says no auth required; confirm actual behavior is identical across all three, or flag if it differs |
| Schema | `data[]` items match `Event` schema; `pagination` matches `PaginationMeta` | pass |
| Performance | Candidate — see Performance section | — |

### 5. `GET /events/:id`

| Category | Scenario | Expected |
|---|---|---|
| Functional | Valid id 283 | 200, `Event` with `title: "World Tech Summit"`, `price: 1500` |
| Functional | Valid id 284 | 200, `Event` with `title` containing "Hollywood Monsoon Night", `price: 2500` |
| Functional | Valid id 285 | 200, `Event` with `title: "Dilli Diwali Mela"`, `price: 300` |
| Negative | Nonexistent numeric id (e.g. `999999`) | 404, `ErrorResponse` |
| Negative | Non-numeric id (e.g. `/events/abc`) | Verify: 400 vs 404 — spec declares `type: integer` but doesn't define the error path for a non-coercible value |
| Negative | Negative or zero id (`/events/-1`, `/events/0`) | Verify: 404 vs 400 |
| Boundary | Very large id (beyond int32, e.g. `99999999999999999999`) | Verify: graceful 400/404, not a 500 |
| Schema | Response matches `Event` schema exactly (all fields present, correct types, `availableSeats <= totalSeats`) | pass |
| Cross-check | `availableSeats` for 283/284/285 is close to (≤) the last-known crawl values, confirming it only decreases, never randomly resets | pass |

### 6. `POST /events`, `PUT /events/:id`, `DELETE /events/:id` — NOT EXECUTED (mutating, live 3rd-party target)

| Category | Scenario | Expected |
|---|---|---|
| Functional | Create with all required fields (`title, category, venue, city, eventDate, price, totalSeats`) | 201, `Event` |
| Negative | Missing a required field | 400, `ValidationErrorResponse` |
| Negative | `price` negative or non-numeric | 400 expected — not documented, verify |
| Negative | `totalSeats` 0 or negative | 400 expected — not documented, verify |
| Negative | `eventDate` in the past | Contract question: spec doesn't say whether past dates are rejected |
| Boundary | Update (`PUT`) a nonexistent id | 404, `ErrorResponse` |
| Boundary | Delete a nonexistent id | 404, `ErrorResponse` |
| Auth | No documented auth requirement in spec, but admin UI exists (`/admin/events`) — verify whether these routes are actually open or gated | contract discrepancy, same as Bookings |
| Schema | Created/updated `Event` matches schema | pass |

### 7. `GET /bookings`

| Category | Scenario | Expected |
|---|---|---|
| Functional | No filters | 200, `data[]` of `Booking`, `pagination` present |
| Functional | `eventId=283` | 200, every `data[].eventId === 283` |
| Functional | `status=confirmed` | 200, every `data[].status === "confirmed"` |
| Functional | `status=cancelled` | 200, every `data[].status === "cancelled"` (may be empty set — acceptable) |
| Boundary | `limit=100` | 200, ≤ 100 items |
| Boundary | `page` beyond last page | 200, empty `data:[]` |
| Negative | `status=bogus` (not in enum) | Verify: 400 vs ignored |
| Negative | `eventId=abc` (non-numeric) | Verify: 400 vs ignored/500 |
| Auth | No token vs valid token vs invalid token | **Contract discrepancy check** — spec says no auth, but per-account-sandboxing in the spec description implies otherwise; if `GET /bookings` returns bookings for *any* account without a token, that's a data-isolation finding worth flagging, not just a test failure |
| Schema | `data[]` items match `Booking` (nested `event` matches `Event`); `pagination` matches `PaginationMeta` | pass |
| Performance | Candidate — see Performance section | — |

### 8. `GET /bookings/:id`

| Category | Scenario | Expected |
|---|---|---|
| Functional | Valid existing booking id (if any bookings exist in this account/environment at test time — see note) | 200, `Booking` |
| Negative | Nonexistent id (e.g. `999999`) | 404, `ErrorResponse` |
| Negative | Non-numeric id | Verify: 400 vs 404 |
| Auth | No token vs valid vs invalid | contract discrepancy check, same as above |
| Schema | Response matches `Booking` schema | pass |

*Note: at explore-agent crawl time, `/bookings/network-requests.json` observed an empty bookings
list for the crawled account (`admin-user@example.com`), and no booking was ever created during
exploration or by this agent (no mutating calls made). The "valid existing booking id" functional
case may have no live fixture to run against; if so it's marked skipped/inconclusive in the spec
file rather than faked.*

### 9. `GET /bookings/ref/:ref`

| Category | Scenario | Expected |
|---|---|---|
| Functional | Valid existing `bookingRef` (format `EVT-XXXXXX`) — same fixture caveat as above | 200, `Booking` |
| Negative | Nonexistent ref (e.g. `EVT-ZZZZZZ`) | 404, `ErrorResponse` |
| Negative | Malformed ref (wrong prefix/length, e.g. `abc`) | Verify: 404 vs 400 |
| Boundary | Ref with unexpected characters/URL-encoding edge cases (e.g. `EVT-A1B2C3%20`) | Verify graceful handling, not 500 |
| Schema | Response matches `Booking` schema | pass |

### 10. `DELETE /bookings/:id` — NOT EXECUTED (mutating, live 3rd-party target)

| Category | Scenario | Expected |
|---|---|---|
| Functional | Cancel an existing confirmed booking | 200, `{"success":true,"message":"Booking cancelled"}`; per spec description this also restores seats |
| Negative | Cancel a nonexistent booking id | 404, `ErrorResponse` |
| Negative | Cancel an already-cancelled booking (double-cancel) | Verify: idempotent 200 vs 400/409 — not documented |
| Cross-functional | After cancel, `GET /events/:id` for the associated event shows `availableSeats` incremented back by the cancelled quantity | matches "seats restored" in spec description |

### 11. `POST /bookings` — NOT EXECUTED (mutating, live 3rd-party target)

This is the highest-value endpoint in the whole API (atomic seat decrement + booking creation) and
is fully covered functionally by the existing UI test suite
(`artifacts/eventhub/testcases/event-booking-testcases.md`, TC-event-booking-005 through -016,
-019). At the API-contract level:

| Category | Scenario | Expected |
|---|---|---|
| Functional | Valid body: real `eventId` (283/284/285), valid name/email/phone, `quantity` 1–10 | 201, `Booking` with generated `bookingRef` matching `EVT-[A-Z0-9]{6}`, `totalPrice === price * quantity` |
| Negative | Missing any required field (`eventId`, `customerName`, `customerEmail`, `customerPhone`, `quantity`) | 400, `ValidationErrorResponse` |
| Negative | `customerEmail` malformed | 400, validation error on `customerEmail` |
| Negative | `customerName` shorter than `minLength: 2` | 400 |
| Negative | `customerPhone` shorter than `minLength: 10` | 400 |
| Negative | `quantity` 0 or negative | 400 |
| Negative | `quantity` > 10 (documented max) | 400 |
| Negative | `quantity` requested exceeds `availableSeats` | 400, `ErrorResponse` (spec: "insufficient seats") — **this is the sold-out edge case flagged as unverifiable in the clarifications doc; testable here without needing a fully sold-out event, just a quantity request that exceeds current availability** |
| Negative | `eventId` references a nonexistent event | 404, `ErrorResponse` |
| Boundary | `quantity` exactly 1 (min) | 201 accepted |
| Boundary | `quantity` exactly 10 (max) | 201 accepted |
| Boundary | `quantity` exactly equal to remaining `availableSeats` (last-seats edge case) | 201 accepted, event becomes 0 available afterward — resolves the sold-out open question from the clarifications doc if ever run in an authorized environment |
| Cross-functional | After success, `GET /events/:id` shows `availableSeats` decremented by `quantity`; the returned `Booking.event` sub-object is consistent | matches spec's "atomic" claim |
| Duplicate | Same account books the same event twice | per clarifications doc, assumed permitted — verify no uniqueness constraint (409/400) is enforced server-side |
| Performance | Candidate — see Performance section; this is the concurrency-sensitive one (atomic seat decrement under simultaneous requests) | — |

### 12. `GET /health`

| Category | Scenario | Expected |
|---|---|---|
| Functional | No params | 200, `{"status":"ok","timestamp":<ISO date>,"dbStatus":"connected"}` |
| Schema | `status` and `dbStatus` are strings, `timestamp` parses as a valid date | pass |
| Performance | Lightweight synthetic-monitoring candidate (see Performance section) | — |

### 13. `GET /config`

| Category | Scenario | Expected |
|---|---|---|
| Functional | No params | 200, `{"showExploreLinks": <boolean>}` |
| Cross-check | Matches the value implied by live frontend behavior at crawl time (`showExploreLinks: false` per spec example — cross-referenced against `network-requests.json`, which only confirms the call succeeds, not the value) | informational |
| Schema | `showExploreLinks` is a boolean | pass |

---

## App-wide feature sections (added 2026-09-20)

Cross-reference: `artifacts/eventhub/clarifications/app-wide-clarifications.md`,
`artifacts/eventhub/testcases/app-wide-testcases.md` (TC-app-wide-001 through -039). The guardrails
from the top of this document apply identically here: **GET-only against the live target**, plus
the same single sanctioned exception pattern used for `POST /auth/login` in section 2 above — this
run additionally exercises `POST /auth/login`'s negative paths live (see section 15) because doing
so authenticates against existing accounts without creating or mutating any data, the same
justification already used for the happy-path login call. `POST /auth/register` and all
Events-mutation routes (`POST`/`PUT`/`DELETE /events/:id`) remain **not executed** in any form —
including invalid-payload attempts — per this run's explicit authorization scope.

### 14. App-wide feature → endpoint traceability

| App-wide feature | Backing endpoint(s) | Executable this run? |
|---|---|---|
| Registration (`/register`) | `POST /auth/register` | No — documented only (section 1, extended in section 16) |
| Login (`/login`) | `POST /auth/login` | Yes — functional + negative, live (section 15) |
| Events search & filtering (`/events`) | `GET /events` (query params `category`, `city`, `search`) | Yes — live (section 17, extends section 4) |
| My Bookings management (`/bookings`) | `GET /bookings`, `GET /bookings/:id`, `GET /bookings/ref/:ref`, `DELETE /bookings/:id` | Read paths yes (sections 7–9, already covered, not duplicated); `DELETE` no |
| "Clear all bookings" bulk action | No dedicated endpoint discovered — see `discovered-endpoints.json`'s `unbackedFrontendFeatures` | No — documented only (section 18) |
| Admin event management (`/admin/events`) — create/edit/delete | `POST /events`, `PUT /events/:id`, `DELETE /events/:id` | No — documented only (section 6, extended in section 18) |
| Admin 6-event / FIFO-eviction rule | `POST /events` (business logic inline, no separate route — see `discovered-endpoints.json`) | No — documented only, orchestrator-overridden (section 18) |
| RBAC (admin vs non-admin) | No dedicated endpoint/role field found | Partially — schema-absence check only, live (section 19) |

### 15. `POST /auth/login` — expanded live coverage (supersedes section 2's "not auto-executed" note for negative cases)

Unlike section 2 above (written during the `event-booking` run, which only executed the happy-path
login as a fixture setup step), this run's `login.spec.ts` **does** execute the negative sub-cases
below live, because none of them create or mutate any business data — they only authenticate (or
fail to authenticate) against existing accounts, the same category of call already sanctioned for
the happy path.

| Category | Scenario | Expected |
|---|---|---|
| Functional | Valid `EVENTHUB_EMAIL` / `EVENTHUB_PASSWORD` | 200, `AuthResponse` (`success:true`, non-empty `token`, `user.email` matches) |
| Negative | Fixture: `known-bad-user@example.com` (placeholder; the 400 was observed live for the original real unregistered address, re-verify) + any password | 400 — **directly observed during explore-agent's app-wide crawl**, not a guess (`artifacts/eventhub/explore/login-attempt-failed/network-request.json`); UI toast was "Invalid email or password" |
| Negative | Correct `EVENTHUB_EMAIL`, deliberately wrong password | 400, `{"success":false,"error":"..."}` |
| Negative | Well-formed but never-registered email | Verify: 400 vs 404 — spec documents both as plausible (`400` = wrong password/validation, `404` = "User not found"); live behavior for this exact case is not yet directly observed, so this case asserts "one of {400,404}" rather than a single hard-coded value |
| Negative | Missing `password` field entirely | 400, `ValidationErrorResponse` |
| Negative | Missing `email` field entirely | 400, `ValidationErrorResponse` |
| Negative | Malformed email (no `@`) | 400, validation error on `email` |
| Negative | Empty request body `{}` | 400 |
| Schema | Success response matches `AuthResponse`; failure responses have `success:false` + string `error` | pass |

### 16. `POST /auth/register` — extended documentation (not executed; extends section 1)

**Password-policy contract discrepancy** (see `discovered-endpoints.json`'s
`passwordPolicyDiscrepancy`): the frontend enforces ≥8 chars / 1 uppercase / 1 number / 1 special
character client-side (verified live by the UI suite to block submission with zero network calls
for every violation), but the documented `AuthInput` schema backing this endpoint only declares
`minLength: 6` with no complexity constraints. Whether the *backend* independently enforces the
same complexity policy, or relies entirely on the frontend, is an open contract question — **not
resolvable without calling `POST /auth/register` directly, which is out of scope this run.**
Flagged for a future authorized run.

| Category | Scenario | Expected | Executed? |
|---|---|---|---|
| Negative | Password satisfying only the backend's documented `minLength:6` but violating the frontend's complexity policy (e.g. `"abcdef"`) | Contract question: does the backend reject this server-side, or would it be accepted if the frontend's client-side gate were bypassed? | Not executed — requires a live `POST /auth/register` call |
| Negative | Duplicate email (TC-app-wide-017) | 400, `{"error":"..."}` (assumed "email already registered") | Not executed — would create/attempt a real account |
| Boundary | Successful registration (TC-app-wide-002 / -020) | 201, `AuthResponse`, assumed auto-login semantics at the UI layer (not an API-contract concern — the API itself just returns a token) | Not executed — creates a real account |

### 17. `GET /events` — search/filter combination & data-anomaly extensions (extends section 4)

New live-executed coverage in `events-search-filter.spec.ts`, on top of (not duplicating) the
basic single-filter and pagination coverage already in `events.spec.ts`:

| Category | Scenario | Expected |
|---|---|---|
| Functional | `category=Concert&city=Los Angeles` combined (matches event 284 only) | 200, AND/intersection semantics — result set is the intersection of both filters, not the union (resolves TC-app-wide-027's open question at the API level) |
| Functional | `category=Concert&city=Delhi` combined (a combination matching **zero** seeded events — 284 is Concert but not Delhi; 285 is Delhi but not Concert) | 200, empty `data:[]` — confirms AND semantics, since OR/union would incorrectly still return one of them |
| Negative/Boundary | `search=zzz-no-match-zzz` (matches no seeded event) | 200, empty `data:[]`, not a 404/500 (TC-app-wide-016) |
| Boundary — data anomaly | `city=Los Angeles` (URL-encoded) — **not a selectable option in the frontend's City filter dropdown**, but a real seeded event (284) has exactly this city value | 200, event 284 present in the result — demonstrates the API itself has no problem with this city value; the gap is purely in the frontend's fixed 6-option dropdown (Mumbai/Bangalore/Delhi/Hyderabad/Chennai/Pune). **Documents the likely data/dropdown-mismatch bug flagged in the clarifications doc at the API level**: the API can select this event by city, the UI cannot. |
| Schema/contract | `city` query param has no `enum` constraint in the spec (unlike `category`, which does) | Confirmed by spec inspection — cross-referenced against the Los Angeles case above |

### 18. Unbacked frontend features — "Clear all bookings" and 6-event FIFO eviction (NOT EXECUTED, no endpoint to call safely)

Neither feature has a dedicated endpoint in the live OpenAPI spec (re-verified this run — see
`discovered-endpoints.json`'s `unbackedFrontendFeatures`). Both are documented here as
functional/negative/boundary scenarios per the invocation's explicit instruction, but **no
generated test calls any endpoint for either feature** — there is no safe read-only way to exercise
them, and the underlying primitives they'd rely on (`DELETE /bookings/:id` looped, or `POST
/events` at the 6/7-event boundary) are themselves excluded from execution this run.

**"Clear all bookings" (`/bookings` page):**

| Category | Scenario | Expected | Notes |
|---|---|---|---|
| Functional | Account with ≥1 existing booking clicks "Clear all bookings" | All bookings for that account are removed; `GET /bookings` (scoped to the account, if auth scoping is real — see the existing contract discrepancy in section 7) afterward returns empty `data:[]` | Likely implemented as N×`DELETE /bookings/:id` client-side, or an undocumented bulk route — see `discovered-endpoints.json` |
| Negative | Account with zero bookings clicks "Clear all bookings" | Idempotent no-op — list is already empty, no error | Assumed, unverified |
| Boundary | Concurrent "Clear all" while a booking is being created elsewhere | Race condition possible if implemented as a client-side loop rather than a server-side atomic bulk-delete transaction | Flagged as an architectural risk worth a human follow-up if this feature is ever load-tested |

**6-event-max / 7th-event-FIFO-eviction (`/admin/events` page):**

| Category | Scenario | Expected | Notes |
|---|---|---|---|
| Boundary | Admin account at exactly 5 events adds a 6th (at-limit boundary, TC-app-wide-036) | `POST /events` → 201; 6th event added normally, no eviction (per the admin banner's own copy) | Orchestrator explicitly declined to authorize live execution — see clarifications doc |
| Boundary | Admin account at exactly 6 events adds a 7th (over-limit boundary, TC-app-wide-037) | `POST /events` → 201 for the new event; the oldest of the 6 existing events is automatically evicted server-side (assumed to be a cascading delete of that event's bookings too, consistent with the documented `DELETE /events/:id` cascade behavior in section 6, though this is inferred, not confirmed) | Same orchestrator override; also flagged: whether the evicted event's *existing bookings* are cascade-deleted or handled some other way is unconfirmed |
| Negative | Tie-breaking behavior when multiple events share the same `createdAt` (sub-second precision boundary) | Unconfirmed — which event is "oldest" in a tie is not documented | Flagged for human follow-up only |

### 19. RBAC / Authorization — schema findings + non-admin placeholder

Authorization/RBAC is explicitly in scope for the app-wide suite (unlike `event-booking`, where
it's out of scope) per the clarifications doc's "Non-functional constraints" section. At the API
level, the *only* safe, GET-only, live-executable coverage is a schema/contract check — genuine
authorization-bypass testing (calling `POST`/`PUT`/`DELETE /events` with a non-admin or invalid
token to see if the mutation succeeds anyway) requires calling those mutating routes, which is
explicitly out of scope this run regardless of the token used.

| Category | Scenario | Expected | Executed? |
|---|---|---|---|
| Schema/contract | `GET /auth/me`'s `MeResponse` does not expose any `role`/`isAdmin`/`permissions` field | Confirmed by spec inspection; live-asserted in `rbac.spec.ts` that the actual response for the (admin-capable) dogfood account also only contains `userId`/`email` | Yes — live, GET-only |
| Auth/contract | Whether `POST /events`, `PUT /events/:id`, `DELETE /events/:id` actually reject a non-admin or missing token, or accept any caller regardless of role (the core RBAC-bypass question) | **Unresolved.** The spec declares no `security` requirement on any of these three routes. Whether admin-gating is UI-only (zero backend enforcement) or server-enforced-but-undocumented cannot be determined without calling them | Not executed — the mutating routes themselves are out of scope this run, independent of which token/credential would be used |
| RBAC placeholder | Non-admin account navigating directly to `/admin/events` (TC-app-wide-039) | Assumed: redirect to `/` or 403 | Not executed — no non-admin EventHub account exists or is registered this run (same fixture gap as the UI suite's `test.fixme` for this case) |
| Cross-check | Seeded events 283/284/285 render as "Read-only" (no Edit/Delete) in the admin UI table — does the `Event` schema expose any field (e.g. an owner/creator id, or a `readOnly`/`featured` boolean) that would explain this at the data level? | No such field exists in the documented `Event` schema (`id, title, description, category, venue, city, eventDate, price, totalSeats, availableSeats, imageUrl, createdAt, updatedAt`) — the "Read-only" designation for these 3 events appears to be a **frontend-only** concept (e.g. a hardcoded id allowlist), not something the API itself is aware of. This is a notable finding: if true, a `PUT`/`DELETE` call against event 283/284/285's id might not actually be rejected server-side either — same unresolved RBAC-bypass question as above, now specifically scoped to the "Read-only" seeded events | Schema-inspection finding, live-asserted via `GET /events/283` etc. (read-only) in `admin-events.spec.ts` |

---

## Performance section — candidate endpoints and suggested k6 profiles

Per the hard rule, **none of these are executed live**. Scripts are generated for static review /
future use against a target the user controls (e.g. a staging clone of EventHub), or run manually
by a human who accepts that responsibility.

| Endpoint | Why it's a candidate | Suggested VUs / duration | Thresholds |
|---|---|---|---|
| `GET /events` | Highest-traffic read path (event listing is the app's main landing surface); pagination/filtering adds query-plan variability | Ramp 0→30 VUs over 30s, hold 30 VUs for 2m, ramp down 30s | `http_req_duration{p(95)}<800ms`, `http_req_failed<1%` |
| `GET /events/:id` | Second-highest-traffic read; also the route showing intermittent 503s at the RSC/frontend layer — worth checking whether the underlying API itself is stable under load even if the Next.js RSC layer isn't | Ramp 0→20 VUs over 20s, hold 20 VUs for 2m | `http_req_duration{p(95)}<500ms`, `http_req_failed<1%` |
| `GET /bookings` | Read-heavy, paginated, potentially large result sets at scale | Ramp 0→20 VUs over 20s, hold 20 VUs for 1m | `http_req_duration{p(95)}<800ms`, `http_req_failed<1%` |
| `POST /bookings` | Write-path with atomic seat-decrement logic — the endpoint most likely to reveal race conditions (overselling) or lock contention under concurrent load. Script generated for a controlled/authorized environment only — **never point this at the live production/demo target** | 10 VUs, 1 iteration each, all fired within a ~2s window against a *single* low-availability event id (deliberately designed to test the atomic-decrement guarantee, not to overload the server) | `http_req_failed<1%`, and a post-run custom check that `sum(quantities of all 201 responses) <= seats available at test start` (i.e. no overselling) |
| `GET /health` | Cheap synthetic-monitoring / uptime-style check candidate | 5 VUs constant for 1m | `http_req_duration{p(95)}<200ms`, `http_req_failed<0.1%` |
| `GET /events` (search/filter variants) | Added by the app-wide run: the search box and category/city filters are the primary interaction on `/events` beyond plain listing; a `search=` query is plausibly a `LIKE`/full-text lookup with different query-plan characteristics (and likely higher latency variance) than the plain paginated list already covered above | Ramp 0→25 VUs over 20s, hold 25 VUs for 90s, cycling through `search=`, `category=`, `city=`, and combined-filter requests | `http_req_duration{p(95)}<900ms` (slightly looser than plain listing, given `search=` query-plan uncertainty), `http_req_failed<1%` |
| `POST /auth/login` | Added by the app-wide run: login is a high-frequency entry-point endpoint. Non-mutating (authenticates existing accounts only), but repeated automated login attempts against a *shared public demo account* risk looking like credential-stuffing/brute-force traffic to any rate-limiting or security monitoring in front of the API — script defaults `BASE_URL` to a local/staging host for this reason (see script header), same caution pattern as the `POST /bookings` creation script | 10 VUs, 1 iteration each, fired within a ~5s window against one fixed valid account | `http_req_failed<1%`, `http_req_duration{p(95)}<600ms`, plus a manual post-run check (documented in the script) that no account lockout/rate-limit response (429) appeared |

---

## Traceability to functional test cases

The booking-flow UI test cases in `event-booking-testcases.md` (TC-event-booking-005, -006, -009,
-010, -011, -015, -016, -019) all describe behavior that ultimately routes through `POST /bookings`
and `GET /events/:id`. This API-level plan complements those by testing the same business rules
(quantity bounds 1–10, price × quantity total, duplicate-booking permissiveness, insufficient-seats
handling) directly at the HTTP contract level, independent of the UI, and — where the UI test cases
were explicitly flagged as "never verified live" (e.g. TC-005, TC-016's booking-success assumptions,
TC-009's sold-out placeholder) — the API-level negative/boundary cases above (`POST /bookings`
insufficient-seats and quantity-at-max-availability rows) are the more directly executable path to
eventually resolving those open questions, once the guardrail against live mutating calls is lifted
for an authorized run.

**App-wide traceability:** `app-wide-testcases.md`'s 39 UI-level test cases map onto sections 14–19
above as follows — TC-app-wide-003/004/011/012/021/022/023 (login form/behavior) → section 15;
TC-app-wide-001/002/013/014/015/017/018/019/020 (registration) → section 16 (all "DO NOT EXECUTE
LIVE" registration cases stay documented-only at the API level too, consistent with the UI suite's
own `test.fixme` treatment); TC-app-wide-005/006/007/016/024/025/026/027/028 (events search/filter,
including the Los Angeles data anomaly) → section 17; TC-app-wide-008/029/030 (My Bookings, "Clear
all bookings") → sections 7–9 (existing, not duplicated) + section 18; TC-app-wide-009/010/031
through -038 (admin event management, 6-event FIFO eviction) → section 18; TC-app-wide-039 (RBAC
non-admin placeholder) → section 19. Of the 39 UI test cases, 12 are flagged "DO NOT EXECUTE LIVE" —
every one of those 12 has a corresponding "not executed" row in this document's app-wide sections,
with no generated Playwright API test calling the underlying mutating endpoint in any of those 12
cases.
