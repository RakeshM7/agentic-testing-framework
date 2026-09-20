# App-Wide (Non-Booking) Coverage — Clarifications

Target: eventhub (https://eventhub.rahulshettyacademy.com)
Feature: app-wide (everything outside the separately-covered `event-booking` feature)
Source: explore-agent crawl artifacts (`artifacts/eventhub/explore/sitemap.json`, `crawl-log.md`,
`pages/register/`, `pages/login/`, `pages/events/`, `pages/my-bookings/`, `pages/admin/`,
`login-attempt-failed/`) + `config/eventhub-app-wide.yaml` (run-config) + Pass-1/Pass-2 clarification.

This document uses three source tags throughout so downstream agents can tell *why* something is
asserted the way it is:
- **[Config-confirmed]** — the run-config's `answers` list matched the Pass-1 question directly;
  treated as an authoritative human-equivalent answer, not a guess.
- **[Config-applied-default]** — no `answers` entry matched; the run-config's
  `defaults.unconfirmed_behavior_policy` (`assume-standard-and-flag`) or
  `defaults.unconfirmed_edge_case_policy` (`flag-as-unconfirmed-case`) was applied instead. Still
  an assumption, not a verified fact.
- **[Orchestrator override]** — the run-config asked for something the orchestrator is not
  authorized to grant (see item 10 / the FIFO-eviction flow below). The override wins.

## Feature summary

This suite covers the parts of EventHub the `event-booking` suite explicitly excludes: account
registration (`/register`), login (`/login`), the Events listing's search/filter controls
(`/events`, excluding the card-click/Book Now navigation itself), My Bookings management
(`/bookings`, specifically the empty state and the "Clear all bookings" bulk action), Admin event
management (`/admin/events`, including the "+ New Event" creation form and the 6-event FIFO
eviction business rule), and role-based access control for `/admin/events`.

**Test-account strategy (governs every case in this suite) [Config-confirmed, item 2]:**
- `akashmrakesh+1@gmail.com` is the sole reusable authenticated fixture account for this run
  (admin-capable; confirmed via the crawl to see the Admin nav item and reach `/admin/events`).
  No brand-new account is registered live for this run.
- No new non-admin account is registered live either. The non-admin/RBAC case against
  `/admin/events` is written as a flagged/unconfirmed placeholder (see Edge cases and Open
  questions).
- `akashmrakesh@gmail.com`'s behavior does **not** need live re-verification. Exploration already
  directly observed a real `400` response from `POST /api/auth/login` for this account, with UI
  toast "Invalid email or password" (`artifacts/eventhub/explore/login-attempt-failed/network-request.json`).
  This is **directly-observed evidence, not an assumption**, and is used as-is as the
  "invalid credentials" negative-test fixture.

Three real, seeded, non-deletable ("Read-only" / "Featured") events exist in this environment
(shared ground truth with the `event-booking` suite — do not re-derive a different mapping):

| Event ID | Title | Category | City / Venue | Price/ticket | Seats available/total (at crawl time) |
|---|---|---|---|---|---|
| 285 | Dilli Diwali Mela | Festival | Pragati Maidan Exhibition Grounds, Delhi | $300 | 8912 / 10000 |
| 284 | Hollywood Monsoon Night — Los Angeles | Concert | Dome, NSCI SVP Stadium, Worli, Los Angeles | $2,500 | 2959 / 3000 |
| 283 | World Tech Summit | Conference | Hitech City, Hyderabad | $1,500 | 233 / 500 |

Notably, **"Hollywood Monsoon Night"'s city is Los Angeles, which is not one of the six options in
the `/events` City filter dropdown** (Mumbai, Bangalore, Delhi, Hyderabad, Chennai, Pune) — see the
dedicated edge case below.

## In scope / Out of scope

**In scope:**
1. **Registration (`/register`)** — Email/Password/Confirm Password fields, the displayed password
   policy (≥8 chars, 1 uppercase, 1 number, 1 special character), "Create Account" submit,
   duplicate-email handling, the "Sign in" link to `/login`.
2. **Login (`/login`)** — valid-credentials login, invalid-credentials login (using the
   directly-observed `akashmrakesh@gmail.com` 400 fixture), empty-field submission, the "Register"
   link to `/register`.
3. **Events listing search & filtering (`/events`)** — the free-text search box, the "All
   Categories" filter (Conference/Concert/Sports/Workshop/Festival), the "All Cities" filter
   (Mumbai/Bangalore/Delhi/Hyderabad/Chennai/Pune), and combinations thereof. Card-click / "Book
   Now" navigation itself is **out of scope here** (owned by `event-booking`).
4. **My Bookings management (`/bookings`)** — the empty state (directly observed: "No bookings
   yet... Browse upcoming events and grab your tickets!" with a "Browse Events" button, since
   `akashmrakesh+1@gmail.com` has zero existing bookings), and the "Clear all bookings" bulk
   action, written as documented-but-not-executed (see item 9).
5. **Admin event management (`/admin/events`)** — the "+ New Event" creation form (Title,
   Description, Category, City, Venue, Event Date & Time, Price, Total Seats, Image URL) and its
   field validation; the 6-event-max / 7th-event-FIFO-eviction business rule, written as
   documented-but-not-executed (see item 10 — **orchestrator override**, not live); the "All
   Events" table where the 3 seeded events show "Read-only" (no Edit/Delete controls), verified at
   the UI level only.
6. **Role-based access control** — non-admin access to `/admin/events`, written as a flagged/
   unconfirmed placeholder case, documented-only (no live execution, no non-admin account
   available).

**Out of scope:**
- Event booking itself (card click, "Book Now", the booking widget, Confirm Booking, seat
  decrement, My Bookings *population* from a completed booking) — owned entirely by the
  `event-booking` suite; not duplicated here.
- Any event other than the three seeded fixtures (283, 284, 285) — no other events exist in this
  environment (and no new ones are created live in this run — see item 10).
- Backend/API-level bypass testing of admin authorization (e.g. calling admin-only endpoints
  directly with a non-admin token) — UI-level verification only in this suite; flagged as a
  candidate for a companion `api-testing-agent` effort (see item 12).
- Live creation of a new user account (registration) or live execution of "Clear all bookings" or
  the 6-event FIFO-eviction flow — all three are documented-but-not-executed per the non-mutation
  stance (see items 3, 9, 10).

## Confirmed behaviors

- **[Config-confirmed, item 2]** `akashmrakesh+1@gmail.com` is the sole authenticated fixture
  account for login/bookings/admin cases in this suite; no new account is registered live.
  `akashmrakesh@gmail.com`'s invalid-credentials 400 response is directly-observed evidence (not
  an assumption) and is reused as-is for the invalid-login test case.
- **[Config-confirmed, item 3]** Successful registration submission is assumed to auto-log the
  user in and redirect to `/events` (or home). Flagged as an assumption — "Create Account" was
  never submitted live during exploration.
- **[Config-confirmed, item 3]** Duplicate-email registration is assumed to be rejected by the
  backend with a clear error, shown as an inline message near the Email field (e.g. "Email already
  registered"). Flagged as an assumption — never exercised live.
- **[Config-applied-default, item 4]** Password-policy validation on `/register` is assumed to be
  standard on-submit client-side validation (not live/on-blur). A "passwords do not match" (or
  similarly generic) error is assumed when Confirm Password mismatches Password. Both flagged as
  assumptions.
- **[Config-applied-default, item 5]** Empty-field submission on `/login` and `/register` is
  assumed to be blocked by client-side required-field validation with no network call made.
  Flagged as an unconfirmed case.
- **[Config-applied-default, item 6]** The `/events` search box is assumed to perform a free-text
  match against event title/venue/city, case-insensitive. The exact mechanism (live/debounced
  filtering vs. submit-only) and the exact zero-results empty-state copy are unconfirmed; assume
  live/debounced filtering with a "No events found" (or similar) empty state. Flagged as an
  assumption — not directly confirmed by DOM inspection during exploration.
- **[Config-applied-default, item 7]** Category + City filter combination is assumed to use
  AND/intersection semantics (all active filters narrow the result set together, not OR/union).
  Flagged as an assumption. (Note: the run-config's `search` answer entry addresses free-text
  search-field scope, a different topic, so it does not resolve this AND/OR question — the general
  `unconfirmed_behavior_policy` default applies here instead.)
- **[Config-confirmed, item 9]** "Clear all bookings" is documented but never executed live in
  this run (same non-execution stance as booking confirmation in the `event-booking` suite).
  Expected behavior: empties the My Bookings list for that account only.
- **[Config-confirmed, item 10]** The admin 6-events-max / 7th-event-FIFO-eviction rule is a
  **confirmed business rule**, per the admin page's own banner text: "You can add up to 6 events.
  Once the limit is reached, your oldest event is automatically replaced when you add a new one."
  (`artifacts/eventhub/explore/pages/admin/dom-snapshot.md`). However — see the **orchestrator
  override** immediately below — this confirmed rule is written as documented-but-not-executed,
  not as a live-execution instruction, despite the rule's own confirmed status.
- **[Config-applied-default, item 11]** Field validation on the "+ New Event" admin form is
  assumed standard: Price requires a positive number (>0), Total Seats requires a positive
  integer. No past-date restriction is confirmed for Event Date & Time. Image URL is treated as
  optional free text with no confirmed format enforcement. All flagged as unconfirmed.
- **[Config-applied-default, item 12]** For the 3 seeded Read-only events in the admin "All
  Events" table, UI-level verification only (confirm no Edit/Delete controls render, as directly
  observed in `pages/admin/dom-snapshot.md`) is sufficient scope for this suite. Backend-level
  bypass testing (direct API calls attempting to edit/delete a Read-only event) is explicitly out
  of scope here and left as a candidate for a companion `api-testing-agent` effort.
- **[Config-confirmed, item 13]** Non-admin access to `/admin/events` is written as a flagged/
  unconfirmed RBAC case — expected redirect to `/` or a 403 — since no non-admin account was
  crawled and none is registered live for this run. Documented only, not executed live.

## Edge cases

| Scenario | Expected behavior | Source |
|---|---|---|
| Registration with duplicate (already-registered) email | Assumed: backend rejects with a clear inline error near the Email field (e.g. "Email already registered"). Flagged assumption, never exercised live. | Config-confirmed |
| Registration with password violating the displayed policy (< 8 chars / missing uppercase / missing number / missing special char) | Assumed: standard on-submit client-side validation error(s) shown, submission blocked. Flagged assumption. | Config-applied-default |
| Registration with Confirm Password ≠ Password | Assumed: generic "passwords do not match" error shown, submission blocked. Flagged assumption. | Config-applied-default |
| Successful registration submission | Assumed: user is auto-logged-in and redirected to `/events` (or home). Flagged assumption — never submitted live. | Config-confirmed |
| Empty-field submission on `/register` or `/login` | Assumed: client-side required-field validation blocks submission with no network call. Flagged as an unconfirmed case. | Config-applied-default |
| Login with valid credentials (`akashmrakesh+1@gmail.com`) | Assumed: successful auth, redirect into the authenticated app (`/events` or home). This account was used throughout the authenticated crawl, so a successful prior login is implied, but the login submission itself (vs. an already-authenticated session) was not independently re-observed as a fresh action. Flagged assumption for the login-submission step specifically. | Config-applied-default |
| Login with invalid credentials (`akashmrakesh@gmail.com`) | **Directly observed, not an assumption.** `POST /api/auth/login` returned `400`; UI toast displayed "Invalid email or password". Use as-is. | Config-confirmed, directly observed (`login-attempt-failed/network-request.json`) |
| Free-text search on `/events` (e.g. by title, venue, or city substring) | Assumed: case-insensitive match against title/venue/city, live/debounced filtering, "No events found" (or similar) empty state on zero results. Flagged assumption — mechanism and exact copy unconfirmed. | Config-applied-default |
| Category filter alone (e.g. "Festival") | Narrows the listing to events matching that category only. In scope, assertable against the 3 known fixtures (e.g. "Festival" → Dilli Diwali Mela only). | Directly derivable from fixture data |
| City filter alone (e.g. "Delhi") | Narrows the listing to events matching that city only. In scope, assertable (e.g. "Delhi" → Dilli Diwali Mela only). | Directly derivable from fixture data |
| Category + City filter combined | Assumed AND/intersection semantics (both filters narrow the result set together). Flagged assumption. | Config-applied-default |
| City filter cannot select "Los Angeles" — "Hollywood Monsoon Night" (city = Los Angeles) is unreachable via the City filter dropdown | **Not expected/known behavior — treat as a likely bug.** The City filter dropdown's 6 options (Mumbai, Bangalore, Delhi, Hyderabad, Chennai, Pune) do not include Los Angeles, yet a real seeded event has that city value. Write the test case documenting this as a probable data/dropdown-mismatch bug (an event exists with a city value the filter UI can never select) — not as intended behavior. | Config-confirmed |
| "Clear all bookings" on `/bookings` | Documented but never executed live in this run (same non-execution stance as booking confirmation in `event-booking`). Expected: empties the My Bookings list for that account only. | Config-confirmed |
| My Bookings empty state | Directly observed: "No bookings yet — You haven't booked any events yet. Browse upcoming events and grab your tickets!" with a "Browse Events" button, for `akashmrakesh+1@gmail.com` (zero existing bookings). | Directly observed (`pages/my-bookings/dom-snapshot.md`) |
| Admin "+ New Event" form — Price field | Assumed: requires a positive number (> 0); no confirmed error copy. Flagged unconfirmed. | Config-applied-default |
| Admin "+ New Event" form — Total Seats field | Assumed: requires a positive integer; no confirmed error copy. Flagged unconfirmed. | Config-applied-default |
| Admin "+ New Event" form — Event Date & Time field | No past-date restriction confirmed; assume none enforced unless observed otherwise. Flagged unconfirmed. | Config-applied-default |
| Admin "+ New Event" form — Image URL field | Optional; assumed free text with no confirmed URL-format enforcement. Flagged unconfirmed. | Config-applied-default |
| Admin "+ New Event" form — required-field validation (Title, Category, City, Venue, Event Date & Time, Price, Total Seats all marked `*`) | Assumed: standard client-side required-field validation blocks submission when empty. Flagged unconfirmed. | Config-applied-default |
| Admin account at exactly 6 events, adding a 6th succeeds (at-limit boundary) | Documented-but-not-executed (see Orchestrator override below). Expected per the admin banner's own text: the 6th event is added normally, no eviction occurs. | Config-confirmed rule; **orchestrator-overridden to non-execution** |
| Admin account at 6 events, adding a 7th (over-limit boundary) | Documented-but-not-executed (see Orchestrator override below). Expected per the admin banner's own text: the oldest of the 6 existing events is automatically evicted (FIFO) to make room for the 7th. | Config-confirmed rule; **orchestrator-overridden to non-execution** |
| Seeded/Featured events (285, 284, 283) in the admin "All Events" table | Directly observed: all 3 rows show "Read-only" in the Actions column; no Edit/Delete controls render for them at the UI level. UI-level verification only is in scope; backend bypass testing is out of scope. | Directly observed (`pages/admin/dom-snapshot.md`); scope per Config-applied-default, item 12 |
| Non-admin account attempting to reach `/admin/events` directly | Flagged/unconfirmed placeholder case. Expected: redirect to `/` or a 403 response. Documented only — not executed live; no non-admin account is available or registered for this run. | Config-confirmed, item 13 |

## Non-functional constraints

- No load, performance-timing, or accessibility (a11y) requirements were surfaced by the crawl,
  the run-config, or the clarification answers; treat these as not applicable to this suite unless
  raised separately.
- **Authorization/RBAC is explicitly in scope for this suite** (the run-config's `role-based
  access` answer explicitly overrides the `event-booking` suite's own out-of-scope note on this
  topic — that note only ever applied to the `event-booking` feature, not app-wide).
- The only performance/reliability signal in this application area (the intermittent 503 on
  event-detail RSC prefetch) belongs to `event-booking`, not this suite; not re-documented here.

## Orchestrator-level non-execution override (item 10) — recorded verbatim

The run-config (`config/eventhub-app-wide.yaml`, `answers` entries matching `"6-event"` /
`"6 events"`) explicitly requested that this flow be executed **live** by
`playwright-automation-agent`: create events up to and past the 6-event limit (i.e. a 7th event)
using the admin-capable account to verify FIFO eviction, then clean up the created events
afterward.

**The orchestrator is NOT authorizing that live execution.** Per `docs/conventions.md`'s
"Orchestrator & run-config contract → What the config can never do" section, and
`playwright-automation-agent`'s own governing instructions, both explicitly enumerate
`playwright-automation-agent`'s no-live-mutation default as a hard rule that a run-config file can
never override — in the same category as `api-testing-agent`'s non-overridable no-live-k6-run
rule. A config-level "explicit, scoped exception" (as this run-config attempted) is exactly the
kind of request that rule exists to refuse.

**Therefore:** the 6-event-max / 7th-event-FIFO-eviction business rule and its two boundary test
cases (at-limit / over-limit, above) are written as **documented-but-not-executed test cases
only** — the same non-execution stance applied elsewhere in this suite to "Clear all bookings"
(item 9) and duplicate-email registration (item 3). Downstream agents must **not** mark these two
cases for live execution, and `playwright-automation-agent` must **not** create or delete real
events for this flow, regardless of what the run-config's `answers` entry requested.

## Confirmed test-case output format

**Markdown table** — same format as the `event-booking` run, for consistency across the suite.
This is the single, explicit format `testcase-generator-agent` should use verbatim for every test
case in this suite — no Gherkin, no CSV, no TestRail import format.

## Open questions

- **Registration flow end-to-end** (auto-login-on-success, duplicate-email error copy/placement,
  password-policy validation timing, confirm-password mismatch error copy) is entirely assumed —
  "Create Account" was never submitted live during exploration or during this clarification pass.
  Needs live verification before being treated as ground truth.
- **Login empty-field and valid-credentials submission behavior** is assumed standard but was
  never exercised as a fresh interactive submission during exploration (the authenticated crawl
  used an already-established session for `akashmrakesh+1@gmail.com`). Needs live verification.
- **Events search mechanism** (live/debounced vs. submit-only) and the exact zero-results
  empty-state copy are unconfirmed — flagged for human follow-up if precise assertions are needed.
- **Category + City filter combination semantics (AND vs. OR)** is assumed AND but was never
  interactively exercised during exploration. Needs live verification.
- **"Hollywood Monsoon Night" / Los Angeles vs. the City filter's 6 fixed options** — flagged as a
  likely bug (event exists with a city value the filter can never select), not confirmed as a
  defect via a bug-tracker entry. Recommend a human/product-owner follow-up to confirm whether this
  is a known data-seeding issue or an actual defect.
- **"Clear all bookings" actual effect** is assumed (empties the list for that account only) but
  never exercised live — needs verification once a completed booking exists in the account (which
  itself depends on the `event-booking` suite's own unexecuted "Confirm Booking" flow).
- **Admin "+ New Event" form field validation** (Price, Total Seats, Event Date & Time, Image URL,
  required-field errors) is entirely assumed/standard and was never exercised interactively —
  needs live verification, though note this does **not** require creating a 7th event or exceeding
  the 6-event limit; a single, cleanly-removable test event (staying within the 6-event cap) could
  in principle validate field-level behavior without touching the FIFO-eviction boundary — but per
  this suite's non-mutation stance, no such live event creation is authorized in this run either;
  flagged for a human decision on whether a narrower, non-limit-touching live exception should be
  considered in a future run.
- **6-event-max / FIFO-eviction rule** — the rule's *text* is confirmed (admin banner copy), but
  its *actual runtime behavior* (which event is evicted on a tie, whether eviction is truly FIFO
  by creation order vs. some other ordering, whether the evicted event's existing bookings are
  affected) has never been observed, since the orchestrator is not authorizing the live execution
  the run-config requested (see override above). Flagged for human follow-up — likely candidate
  for either a future run with a narrower, explicitly human-approved (not run-config-level)
  mutation exception, or a dedicated non-production test environment.
- **Non-admin RBAC behavior against `/admin/events`** is entirely unconfirmed — no non-admin
  account was ever crawled or created. The expected redirect-to-`/`-or-403 behavior is a
  placeholder assumption only. Flagged for human follow-up: a non-admin test account would need to
  be provisioned (out of band, not by this pipeline) before this case can move from documented-only
  to executed.
- **Backend-level authorization bypass on Read-only seeded events** (direct API calls to
  edit/delete events 283/284/285, or to reach admin endpoints with a non-admin token) is out of
  scope for this suite and flagged as a candidate for a companion `api-testing-agent` effort.
