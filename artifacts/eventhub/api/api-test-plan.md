# EventHub API — Test Plan

Target: `https://eventhub.rahulshettyacademy.com` (frontend) / `https://api.eventhub.rahulshettyacademy.com` (API host)
Feature cross-reference: `artifacts/eventhub/clarifications/event-booking-clarifications.md`,
`artifacts/eventhub/testcases/event-booking-testcases.md`
Endpoint inventory: `artifacts/eventhub/api/discovered-endpoints.json`

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
list for the crawled account (`akashmrakesh+1@gmail.com`), and no booking was ever created during
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
