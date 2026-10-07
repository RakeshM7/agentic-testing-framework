# EventHub — Test Case Summary (All Features)

Target: eventhub (https://eventhub.rahulshettyacademy.com)
Features covered: `event-booking`, `app-wide`

---

# Feature: event-booking

Generated from: `artifacts/eventhub/clarifications/event-booking-clarifications.md`
Test cases: `artifacts/eventhub/testcases/event-booking-testcases.md`
Output format used: Plain Markdown steps table (per the clarifications doc's confirmed format).

## Counts

**Total test cases: 19**

### By category

| Category | Count | IDs |
|---|---|---|
| Happy path | 6 | TC-event-booking-001..006 |
| Negative | 2 | TC-event-booking-007, 008 |
| Boundary (from edge-case table) | 11 | TC-event-booking-009..019 |

### By priority

| Priority | Count | IDs |
|---|---|---|
| P0 | 5 | TC-event-booking-001, 002, 004, 005, 016 |
| P1 | 10 | TC-event-booking-003, 006, 007, 010, 011, 012, 013, 014, 015, 019 |
| P2 | 4 | TC-event-booking-008, 009, 017, 018 |

### By category × priority

| | P0 | P1 | P2 | Total |
|---|---|---|---|---|
| Happy path | 4 | 2 | 0 | 6 |
| Negative | 0 | 1 | 1 | 2 |
| Boundary | 1 | 7 | 3 | 11 |
| **Total** | **5** | **10** | **4** | **19** |

## Traceability matrix

Maps each test case to the clarification-doc item (confirmed behavior or edge-case-table row) it
covers. Every row of the clarifications doc's edge-case table is covered by exactly one boundary
test case (TC-009 through TC-019), with no row skipped.

| Test case ID | Category | Clarifications-doc source item covered |
|---|---|---|
| TC-event-booking-001 | Happy path | Confirmed behavior: event-card click on `/events` navigates to `/events/{id}` |
| TC-event-booking-002 | Happy path | Confirmed behavior: standalone "Book Now" button navigates to `/events/{id}` (distinct entry point) |
| TC-event-booking-003 | Happy path | Confirmed behavior: booking widget requires Full Name/Email/Phone Number, stepper defaults to 1 (max 10) |
| TC-event-booking-004 | Happy path | Confirmed behavior: order total computed as price/ticket × quantity (directly assertable DOM value) |
| TC-event-booking-005 | Happy path | Confirmed behavior: standard booking-success behaviors (confirmation, `/bookings` appearance) — flagged inferred/unverified |
| TC-event-booking-006 | Happy path | Edge case row: "Price/total calculation display" — recalculation as quantity changes (non-boundary, mid-range) |
| TC-event-booking-007 | Negative | Confirmed behavior / edge case row: "Submit booking form with Full Name, Email, or Phone Number empty" — extended to all-three-empty case |
| TC-event-booking-008 | Negative | Non-functional constraint: reliability signal (intermittent 503s) — extrapolated to the booking-submission write path; flagged speculative |
| TC-event-booking-009 | Boundary | Edge case row: "Sold-out event booking attempt" — flagged/unconfirmed, no fixture exists |
| TC-event-booking-010 | Boundary | Edge case row: "Ticket stepper at minimum (qty = 1), user clicks '−'" |
| TC-event-booking-011 | Boundary | Edge case row: "Ticket stepper at maximum (qty = 10), user clicks '+'" |
| TC-event-booking-012 | Boundary | Edge case row: "Submit booking form with Full Name, Email, or Phone Number empty" (per-field isolation) |
| TC-event-booking-013 | Boundary | Edge case row: "Submit booking form with malformed email" |
| TC-event-booking-014 | Boundary | Edge case row: "Submit booking form with malformed phone number" |
| TC-event-booking-015 | Boundary | Edge case row: "Same user books the same event a second time" |
| TC-event-booking-016 | Boundary | Edge case row: "Successful booking submission" (seat decrement, confirmation, `/bookings` appearance) — flagged inferred/unverified |
| TC-event-booking-017 | Boundary | Edge case row: "Navigating to an event detail page from the `/events` listing (either via card click or 'Book Now' button)" |
| TC-event-booking-018 | Boundary | Edge case row: "RSC prefetch of `/events/{id}` from the `/events` listing page" (intermittent 503, flagged negative/reliability) |
| TC-event-booking-019 | Boundary | Edge case row: "Price/total calculation display" — recalculation across a full stepper sequence including the max boundary |

### Edge-case-table coverage check

All 11 rows of the clarifications doc's edge-case table are represented, none skipped:

1. Sold-out event booking attempt → TC-009
2. Ticket stepper at minimum, click "−" → TC-010
3. Ticket stepper at maximum, click "+" → TC-011
4. Submit with Full Name/Email/Phone empty → TC-012 (also TC-007 for the all-empty variant)
5. Submit with malformed email → TC-013
6. Submit with malformed phone number → TC-014
7. Same user books same event twice → TC-015
8. Successful booking submission → TC-016 (also TC-005 for the single-ticket happy-path variant)
9. Navigating to event detail from `/events` (card or Book Now) → TC-017 (also TC-001/TC-002 for the individual happy-path entry points)
10. RSC prefetch 503 reliability → TC-018
11. Price/total calculation display → TC-019 (also TC-006 for the non-boundary mid-range variant)

## Notes carried from the clarifications doc

- Every test case whose expected result depends on a completed booking (seat-count decrement,
  confirmation UI, `/bookings` appearance) is explicitly flagged in the test case body as inferred
  from UI structure only — "Confirm Booking" was never clicked during the source exploration.
- TC-009 (sold-out) cannot currently be executed against seeded data; no fixture in this
  environment reaches 0 available seats. Flagged for human follow-up, consistent with the
  clarifications doc's "Open questions" section.
- TC-008 (server error on submission) is the one test case not directly sourced from a
  clarifications-doc edge-case-table row; it is a bounded extrapolation of the documented RSC-503
  reliability signal onto the (never-observed) booking write path, flagged accordingly.
- Authorization/RBAC and login/registration flows are explicitly out of scope per the
  clarifications doc and are not covered by any test case in this suite.

---

# Feature: app-wide

Generated from: `artifacts/eventhub/clarifications/app-wide-clarifications.md`
Test cases: `artifacts/eventhub/testcases/app-wide-testcases.md`
Output format used: Plain Markdown steps table (per the clarifications doc's confirmed format,
matching the `event-booking` suite's format for consistency).

Covers: registration (`/register`), login (`/login`), events search/filter (`/events`), My Bookings
management (`/bookings`), admin event management (`/admin/events`), and role-based access control.
Explicitly excludes booking itself (card click / "Book Now" navigation, the booking widget, seat
decrement) — owned by `event-booking`.

## Counts

**Total test cases: 39**

### By category

| Category | Count | IDs |
|---|---|---|
| Happy path | 10 | TC-app-wide-001..010 |
| Negative | 6 | TC-app-wide-011..016 |
| Boundary (from edge-case table) | 23 | TC-app-wide-017..039 |

### By priority

| Priority | Count | IDs |
|---|---|---|
| P0 | 3 | TC-app-wide-004, 011, 023 |
| P1 | 23 | TC-app-wide-002, 006, 007, 008, 010, 012, 013, 014, 015, 017, 018, 020, 022, 024, 025, 026, 027, 028, 035, 036, 037, 038, 039 |
| P2 | 13 | TC-app-wide-001, 003, 005, 009, 016, 019, 021, 029, 030, 031, 032, 033, 034 |

### By category × priority

| | P0 | P1 | P2 | Total |
|---|---|---|---|---|
| Happy path | 1 | 6 | 3 | 10 |
| Negative | 1 | 4 | 1 | 6 |
| Boundary | 1 | 13 | 9 | 23 |
| **Total** | **3** | **23** | **13** | **39** |

### "DO NOT EXECUTE LIVE" flag summary

12 of the 39 test cases in this suite are flagged **"DO NOT EXECUTE LIVE — documented-but-not-executed
only"** and must not be automated as live mutating actions by `playwright-automation-agent`:

| Test case ID | Reason |
|---|---|
| TC-app-wide-002 | Would create a real account (registration non-mutation stance, item 3) |
| TC-app-wide-017 | Duplicate-email registration attempt — requires live account-creation testing (item 3) |
| TC-app-wide-020 | Would create a real account (same as TC-002, boundary/edge-case-row variant) |
| TC-app-wide-029 | "Clear all bookings" — destructive bulk action (item 9) |
| TC-app-wide-031 | Admin "+ New Event" form submission — Price field (no live event creation authorized, item 11 / Open questions) |
| TC-app-wide-032 | Admin "+ New Event" form submission — Total Seats field |
| TC-app-wide-033 | Admin "+ New Event" form submission — Event Date & Time field |
| TC-app-wide-034 | Admin "+ New Event" form submission — Image URL field |
| TC-app-wide-035 | Admin "+ New Event" form submission — required-field validation |
| TC-app-wide-036 | 6-event-max at-limit boundary — **orchestrator-level non-execution override (item 10)**; run-config's request for live execution explicitly overridden |
| TC-app-wide-037 | 7th-event FIFO-eviction over-limit boundary — **orchestrator-level non-execution override (item 10)**; same override as TC-036 |
| TC-app-wide-039 | Non-admin RBAC case — no non-admin account available/registered this run (item 13) |

TC-app-wide-036 and TC-app-wide-037 carry the strongest form of this flag: the run-config for this
run explicitly requested live execution of the 6-event/FIFO-eviction flow, and the orchestrator
explicitly refused to authorize it (recorded verbatim in the clarifications doc's
"Orchestrator-level non-execution override (item 10)" section). This is a **hard override that no
run-config can grant**, per `docs/conventions.md`'s "Orchestrator & run-config contract" and
`playwright-automation-agent`'s own non-overridable no-live-mutation default.

## Traceability matrix

Maps each test case to the clarification-doc item (confirmed behavior or edge-case-table row) it
covers. Every row of the clarifications doc's edge-case table (23 rows) is covered by exactly one
boundary test case (TC-app-wide-017 through TC-app-wide-039), with no row skipped.

| Test case ID | Category | Clarifications-doc source item covered |
|---|---|---|
| TC-app-wide-001 | Happy path | Confirmed behavior: `/register` form fields, password policy display, "Sign in" link |
| TC-app-wide-002 | Happy path | Confirmed behavior (item 3): successful registration auto-logs in and redirects — flagged assumption, DO NOT EXECUTE LIVE |
| TC-app-wide-003 | Happy path | Confirmed behavior: `/login` form fields, "Register" link |
| TC-app-wide-004 | Happy path | Confirmed behavior: valid-credentials login for `admin-user@example.com` |
| TC-app-wide-005 | Happy path | Confirmed behavior: `/events` search box + Category/City filter option sets |
| TC-app-wide-006 | Happy path | Edge case row: "Category filter alone" |
| TC-app-wide-007 | Happy path | Edge case row: "City filter alone" |
| TC-app-wide-008 | Happy path | Edge case row: "My Bookings empty state" |
| TC-app-wide-009 | Happy path | Edge case row: "Seeded/Featured events in the admin All Events table" (field values) |
| TC-app-wide-010 | Happy path | Confirmed behavior (item 2): admin-capable account can reach `/admin/events` |
| TC-app-wide-011 | Negative | Edge case row: "Login with invalid credentials" (directly observed, UI-level) |
| TC-app-wide-012 | Negative | Edge case row: "Empty-field submission on `/login`" |
| TC-app-wide-013 | Negative | Edge case row: "Empty-field submission on `/register`" |
| TC-app-wide-014 | Negative | Edge case row: "Registration with password violating the displayed policy" |
| TC-app-wide-015 | Negative | Edge case row: "Registration with Confirm Password ≠ Password" |
| TC-app-wide-016 | Negative | Confirmed behavior (item 6): search zero-results empty state |
| TC-app-wide-017 | Boundary | Edge case row: "Registration with duplicate (already-registered) email" — DO NOT EXECUTE LIVE |
| TC-app-wide-018 | Boundary | Edge case row: "Registration with password violating the displayed policy" (per-rule isolation) |
| TC-app-wide-019 | Boundary | Edge case row: "Registration with Confirm Password ≠ Password" (single-character mismatch) |
| TC-app-wide-020 | Boundary | Edge case row: "Successful registration submission" — DO NOT EXECUTE LIVE |
| TC-app-wide-021 | Boundary | Edge case row: "Empty-field submission on `/register` or `/login`" (per-field isolation) |
| TC-app-wide-022 | Boundary | Edge case row: "Login with valid credentials" (fresh interactive submission from logged-out state) |
| TC-app-wide-023 | Boundary | Edge case row: "Login with invalid credentials" (directly observed, API-level: `POST /api/auth/login` → 400) |
| TC-app-wide-024 | Boundary | Edge case row: "Free-text search on `/events`" |
| TC-app-wide-025 | Boundary | Edge case row: "Category filter alone" (fixture-assertable variant) |
| TC-app-wide-026 | Boundary | Edge case row: "City filter alone" (fixture-assertable variant) |
| TC-app-wide-027 | Boundary | Edge case row: "Category + City filter combined" |
| TC-app-wide-028 | Boundary | Edge case row: "City filter cannot select 'Los Angeles'" — likely bug |
| TC-app-wide-029 | Boundary | Edge case row: "'Clear all bookings' on `/bookings`" — DO NOT EXECUTE LIVE |
| TC-app-wide-030 | Boundary | Edge case row: "My Bookings empty state" (exact copy verification, directly observed) |
| TC-app-wide-031 | Boundary | Edge case row: "Admin '+ New Event' form — Price field" — DO NOT EXECUTE LIVE |
| TC-app-wide-032 | Boundary | Edge case row: "Admin '+ New Event' form — Total Seats field" — DO NOT EXECUTE LIVE |
| TC-app-wide-033 | Boundary | Edge case row: "Admin '+ New Event' form — Event Date & Time field" — DO NOT EXECUTE LIVE |
| TC-app-wide-034 | Boundary | Edge case row: "Admin '+ New Event' form — Image URL field" — DO NOT EXECUTE LIVE |
| TC-app-wide-035 | Boundary | Edge case row: "Admin '+ New Event' form — required-field validation" — DO NOT EXECUTE LIVE |
| TC-app-wide-036 | Boundary | Edge case row: "Admin account at exactly 6 events, adding a 6th succeeds (at-limit boundary)" — DO NOT EXECUTE LIVE, orchestrator override |
| TC-app-wide-037 | Boundary | Edge case row: "Admin account at 6 events, adding a 7th (over-limit boundary)" — DO NOT EXECUTE LIVE, orchestrator override |
| TC-app-wide-038 | Boundary | Edge case row: "Seeded/Featured events (285, 284, 283) in the admin All Events table" (Read-only Actions column, directly observed) |
| TC-app-wide-039 | Boundary | Edge case row: "Non-admin account attempting to reach `/admin/events` directly" — DO NOT EXECUTE LIVE (no fixture account) |

### Edge-case-table coverage check

All 23 rows of the clarifications doc's edge-case table are represented, none skipped:

1. Registration with duplicate email → TC-017
2. Registration with password violating policy → TC-018 (also TC-014 for the general negative variant)
3. Registration with Confirm Password ≠ Password → TC-019 (also TC-015 for the general negative variant)
4. Successful registration submission → TC-020 (also TC-002 for the happy-path variant)
5. Empty-field submission on `/register` or `/login` → TC-021 (also TC-012/TC-013 for the per-page negative variants)
6. Login with valid credentials → TC-022 (also TC-004 for the happy-path variant)
7. Login with invalid credentials → TC-023 (also TC-011 for the UI-level negative variant)
8. Free-text search on `/events` → TC-024 (also TC-016 for the zero-results negative variant)
9. Category filter alone → TC-025 (also TC-006 for the happy-path variant)
10. City filter alone → TC-026 (also TC-007 for the happy-path variant)
11. Category + City filter combined → TC-027
12. City filter cannot select "Los Angeles" (bug) → TC-028
13. "Clear all bookings" → TC-029
14. My Bookings empty state → TC-030 (also TC-008 for the happy-path variant)
15. Admin New Event form — Price field → TC-031
16. Admin New Event form — Total Seats field → TC-032
17. Admin New Event form — Event Date & Time field → TC-033
18. Admin New Event form — Image URL field → TC-034
19. Admin New Event form — required-field validation → TC-035
20. Admin account at exactly 6 events, adding a 6th (at-limit) → TC-036
21. Admin account at 6 events, adding a 7th (over-limit, FIFO) → TC-037
22. Seeded/Featured events Read-only in admin table → TC-038 (also TC-009 for the happy-path field-values variant)
23. Non-admin account attempting `/admin/events` (RBAC) → TC-039

## Notes carried from the clarifications doc

- No live account was registered, no "Clear all bookings" action was executed, and no admin event
  was created/deleted during generation of this suite — consistent with the clarifications doc's
  non-mutation stance and its dedicated "Orchestrator-level non-execution override" section for the
  6-event/FIFO-eviction flow (item 10). The run-config's explicit request for live execution of that
  flow was overridden by the orchestrator; `playwright-automation-agent` must not attempt it.
- Registration, "Clear all bookings", and all Admin "+ New Event" form submissions (both valid and
  invalid data) are treated as out-of-scope for live execution this run, per the clarifications
  doc's "Open questions" section explicitly declining even narrow, non-limit-touching live
  exceptions for admin form field validation.
- The non-admin RBAC case (TC-app-wide-039) is a flagged/unconfirmed placeholder — no non-admin
  account exists in this environment or was registered for this run.
- The City-filter/"Los Angeles" mismatch (TC-app-wide-028) is documented as a likely bug, not
  confirmed behavior — flagged for human/product-owner follow-up.
- Authorization/RBAC is explicitly in scope for this suite (unlike `event-booking`, where it is
  explicitly out of scope) — see the clarifications doc's "Non-functional constraints" section.
