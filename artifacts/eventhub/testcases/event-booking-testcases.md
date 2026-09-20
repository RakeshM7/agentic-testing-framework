# Event Booking — Test Cases

Target: eventhub (https://eventhub.rahulshettyacademy.com)
Feature: event-booking
Source: `artifacts/eventhub/clarifications/event-booking-clarifications.md` (authoritative) +
`artifacts/eventhub/explore/sitemap.json` and page snapshots (`pages/events/`, `pages/event-detail/`,
`pages/my-bookings/`) for real UI element labels.

Format: Plain Markdown steps table, per the confirmed test-case output format in the clarifications
doc (no Gherkin, no CSV, no TestRail import format).

**Global caveat (carried through every test case below that involves "Confirm Booking" or its
downstream effects):** the exploration that produced the clarifications doc never actually clicked
"Confirm Booking" (read-only crawl mandate). Every test case whose expected result depends on
booking creation, seat-count decrement, a confirmation indicator, or `/bookings` appearance is
**inferred from UI copy/structure only and flagged as unverified** until run live. This is repeated
per test case below rather than only stated once, so each test case is self-contained.

**Seeded fixtures used throughout (per clarifications doc; treat this table as ground truth over
any earlier/uncertain id-to-card mapping seen in raw crawl snapshots):**

| Event ID | Title | Category | City / Venue | Price/ticket | Seats available/total (at doc time) |
|---|---|---|---|---|---|
| 285 | Dilli Diwali Mela | Festival | Pragati Maidan Exhibition Grounds, Delhi | $300 | 8912 / 10000 |
| 284 | Hollywood Monsoon Night — Los Angeles | Concert | Dome, NSCI SVP Stadium, Worli, Los Angeles | $2,500 | 2959 / 3000 |
| 283 | World Tech Summit | Conference | Hitech City, Hyderabad | $1,500 | 233 / 500 |

**General precondition for every test case:** tester is logged into EventHub as an authenticated
test account (e.g. `akashmrakesh+1@gmail.com`, the account used during exploration) unless a test
case states otherwise. Login/registration flow itself is out of scope for this suite.

---

## Happy path

### TC-event-booking-001 — Navigate to event detail via event card click
**Priority:** P0
**Preconditions:** Tester is logged in and on the `/events` "Upcoming Events" listing page.
**Steps:**
1. Locate the "Dilli Diwali Mela" event card (id 285) in the listing.
2. Click on the event card itself (the card/image wrapper, not the "Book Now" button).
**Expected result:** Browser navigates to `/events/285`. The event detail page renders showing
title "Dilli Diwali Mela", badges "Festival" / "Featured", date "Tuesday, 20 October", venue
"Pragati Maidan Exhibition Grounds", city "Delhi", "AVAILABLE: 8912 / 10000 seats", "PRICE PER
TICKET: $300", and the "Book Tickets" widget in the right rail.

---

### TC-event-booking-002 — Navigate to event detail via standalone "Book Now" button
**Priority:** P0
**Preconditions:** Tester is logged in and on the `/events` "Upcoming Events" listing page.
**Steps:**
1. Locate the "Hollywood Monsoon Night — Los Angeles" event card (id 284) in the listing.
2. Click the "Book Now" button on that card (a separate interactive element from the card itself).
**Expected result:** Browser navigates to `/events/284`. The event detail page renders showing
title "Hollywood Monsoon Night — Los Angeles", category "Concert", venue "Dome, NSCI SVP Stadium,
Worli, Los Angeles", "PRICE PER TICKET: $2,500", and the "Book Tickets" widget in the right rail.

---

### TC-event-booking-003 — Booking widget renders required fields and default ticket quantity
**Priority:** P1
**Preconditions:** Tester is logged in and navigates directly to `/events/283` (World Tech Summit).
**Steps:**
1. Load the event detail page for event 283.
2. Inspect the "Book Tickets" widget in the right rail.
**Expected result:** Widget header reads "Book Tickets — $1,500 per ticket". Ticket quantity
stepper is present with "−" and "+" buttons and defaults to **1**. "Full Name*" (placeholder "Your
full name"), "Email*" (placeholder "you@email.com", type=email), and "Phone Number*" (placeholder
"+91 98765 43210", type=tel) fields are all present, empty, and marked required with `*`. A
"Confirm Booking" submit button is present.

---

### TC-event-booking-004 — Order total is correctly calculated at default quantity
**Priority:** P0
**Preconditions:** Tester is logged in and navigates directly to `/events/285` (Dilli Diwali Mela,
$300/ticket).
**Steps:**
1. Load the event detail page for event 285.
2. Without changing the ticket stepper (leave at default 1), read the order summary in the
   "Book Tickets" widget.
**Expected result:** Order summary displays "$300 × 1 ticket = $300" and "Total $300", matching
price/ticket × quantity (1) exactly.

---

### TC-event-booking-005 — Successful single-ticket booking submission (happy path, end to end)
**Priority:** P0
**Preconditions:** Tester is logged in, on `/events/285` (Dilli Diwali Mela, $300/ticket, 8912/10000
available at doc time). Tester's account has no prior booking for event 285 in this test run.
**Flagged:** "Confirm Booking" was never clicked during exploration; this test case's expected
result is inferred from UI copy/structure only and must be independently verified live.
**Steps:**
1. Load `/events/285`.
2. Leave ticket quantity at default (1).
3. Fill "Full Name*" with a valid name, e.g. "Test User".
4. Fill "Email*" with a valid email, e.g. "test.user@example.com".
5. Fill "Phone Number*" with a valid phone number, e.g. "+91 98765 43210".
6. Click "Confirm Booking".
**Expected result:** Submission succeeds; a confirmation indicator is shown to the user. Navigate
to `/bookings` and confirm a new booking entry for "Dilli Diwali Mela" (event 285) appears with
quantity 1 and total $300. Reload `/events/285` and confirm "AVAILABLE" seat count has decreased by
1 (from 8912 to 8911).

---

### TC-event-booking-006 — Order total recalculates when ticket quantity changes (mid-range)
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events/283` (World Tech Summit, $1,500/ticket).
**Steps:**
1. Load `/events/283`; confirm stepper starts at 1 and order summary reads "$1,500 × 1 ticket =
   $1,500", Total $1,500.
2. Click the "+" stepper button 4 times to bring quantity to 5.
**Expected result:** After each click the order summary updates live. At quantity 5, order summary
reads "$1,500 × 5 tickets = $7,500", Total $7,500.

---

## Negative

### TC-event-booking-007 — Submit booking form with all required fields left empty
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events/284` (Hollywood Monsoon Night — Los Angeles).
**Flagged:** Field-level validation behavior is an assumption never exercised during exploration;
verify live.
**Steps:**
1. Load `/events/284`.
2. Leave "Full Name*", "Email*", and "Phone Number*" all empty.
3. Click "Confirm Booking" without filling in any field.
**Expected result:** Submission is blocked. A required-field validation error is shown for each of
the three empty fields (Full Name, Email, Phone Number). No navigation occurs and no booking is
created (verify `/bookings` afterward shows no new entry for event 284).

---

### TC-event-booking-008 — Confirm Booking submission encounters a server/network error
**Priority:** P2
**Preconditions:** Tester is logged in and on `/events/285`, with all required fields filled
validly (Full Name, Email, Phone Number) and a valid ticket quantity selected. Requires a way to
simulate/force a server-side or network error on the booking-submission request (e.g. via
network-throttling/mocking tooling, or by reproducing conditions similar to the intermittent 503s
observed on this app's RSC prefetches).
**Flagged:** Entirely speculative/extrapolated. No booking-submission (write-path) network request
was ever observed during exploration (client-side XHR to the booking API was never captured; the
exact endpoint is unconfirmed — see clarifications doc "Open questions"). This test case exists
because the app is independently known to intermittently return `503` on other requests (RSC
prefetches), so is worth checking on the write path too. Must be verified live before being treated
as a real, executable test case; the exact repro mechanism for forcing the error needs to be
determined by the tester/environment.
**Steps:**
1. Fill the booking form on `/events/285` with valid Full Name, Email, and Phone Number.
2. Trigger conditions that cause the "Confirm Booking" submission request to fail server-side
   (e.g. 5xx) or time out.
3. Click "Confirm Booking".
**Expected result:** User is shown a clear error state (not a silent failure or a false
"success" indicator). No partial or duplicate booking is created — verify `/bookings` shows no new
entry for event 285 and that the event's available-seat count on `/events/285` is unchanged.

---

## Boundary (one test case per edge-case-table row in the clarifications doc)

### TC-event-booking-009 — Sold-out event booking attempt
**Priority:** P2
**Preconditions:** Requires an event with 0 available seats. **No seeded fixture in this
environment is sold out** — the lowest-availability seeded event is 283 (World Tech Summit,
233/500 available at doc time). This test case cannot be executed as written until a sold-out
fixture exists or event 283 (or another) can be driven down to 0 availability.
**Flagged: unconfirmed/unverifiable in this environment.** Written as a placeholder per the
clarifications doc's explicit instruction; expected behavior below is a guess, not observed fact.
**Steps:**
1. Navigate to a sold-out event's detail page (0 seats available) — currently not reproducible with
   seeded data; would need a test-data setup step to zero out an event's availability first.
2. Attempt to select a ticket quantity and/or click "Confirm Booking".
**Expected result (unverified placeholder):** Booking is blocked in some form — e.g. the "Book
Tickets" widget shows a sold-out state, the quantity stepper is disabled, or "Confirm Booking" is
disabled/produces an error on click. **Do not treat as ground truth; flag for human follow-up per
clarifications doc "Open questions" until a sold-out fixture is available.**

---

### TC-event-booking-010 — Ticket stepper at minimum (qty = 1): "−" is blocked
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events/285`, ticket stepper at its default value 1.
**Flagged:** Assumed standard, never clicked during exploration; verify live.
**Steps:**
1. Confirm the stepper reads 1.
2. Click the "−" button once.
**Expected result:** Quantity remains at 1 (does not go below 1). The "−" button is either disabled
or is a no-op at quantity 1. Order summary continues to read "$300 × 1 ticket = $300", Total $300.

---

### TC-event-booking-011 — Ticket stepper at maximum (qty = 10): "+" is blocked
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events/285`.
**Flagged:** Assumed standard, never clicked during exploration; verify live.
**Steps:**
1. Click the "+" button 9 times to bring quantity from 1 to 10.
2. Confirm order summary reads "$300 × 10 tickets = $3,000", Total $3,000.
3. Click "+" one more time (10th click, attempting to exceed the stated max of 10).
**Expected result:** Quantity remains at 10 (does not exceed 10). The "+" button is either disabled
or is a no-op at quantity 10. Order summary is unchanged at "$300 × 10 tickets = $3,000", Total
$3,000.

---

### TC-event-booking-012 — Submit booking form with a single required field empty at a time
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events/284`.
**Flagged:** Assumed standard client-side validation, never exercised during exploration; verify
live, including exact error copy and whether validation fires on-blur or only on-submit.
**Steps (three sub-cases, each run independently with the other two fields filled validly):**
1a. Leave "Full Name*" empty; fill Email and Phone Number validly; click "Confirm Booking".
1b. Leave "Email*" empty; fill Full Name and Phone Number validly; click "Confirm Booking".
1c. Leave "Phone Number*" empty; fill Full Name and Email validly; click "Confirm Booking".
**Expected result:** For each sub-case, submission is blocked and a required-field validation error
is shown for exactly the one empty field. No booking is created in any of the three sub-cases
(verify `/bookings` shows no new entry for event 284 after each attempt).

---

### TC-event-booking-013 — Submit booking form with malformed email
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events/283`, Full Name and Phone Number filled
validly.
**Flagged:** Assumed standard email-format validation, never exercised during exploration; verify
live, including exact error copy.
**Steps:**
1. Fill "Email*" with a malformed value missing "@", e.g. "testuserexample.com".
2. Click "Confirm Booking".
**Expected result:** Submission is blocked. An email-format validation error is shown on the Email
field. No booking is created for event 283.

---

### TC-event-booking-014 — Submit booking form with malformed phone number
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events/283`, Full Name and Email filled validly.
**Flagged:** Assumed standard phone-format validation, never exercised during exploration; verify
live, including exact error copy. UI placeholder format is "+91 98765 43210".
**Steps:**
1. Fill "Phone Number*" with a malformed value, e.g. "12345" (too short / non-matching the
   placeholder's expected format).
2. Click "Confirm Booking".
**Expected result:** Submission is blocked. A phone-format validation error is shown on the Phone
Number field. No booking is created for event 283.

---

### TC-event-booking-015 — Same user books the same event a second time (duplicate booking)
**Priority:** P1
**Preconditions:** Tester is logged in and has already completed one successful booking for event
285 (see TC-event-booking-005), or completes one as setup for this test.
**Flagged:** Assumed permitted — no uniqueness constraint, disabled state, or warning was observed
anywhere in the crawled UI, but this was never verified by actually submitting two bookings; verify
live.
**Steps:**
1. Navigate to `/events/285` again (same event already booked once by this account).
2. Fill the booking form with valid Full Name, Email, Phone Number, and a ticket quantity (e.g. 1).
3. Click "Confirm Booking".
**Expected result:** A second, independent booking for event 285 by the same account is accepted
(no uniqueness-constraint error, no disabled widget, no warning blocking submission). `/bookings`
now shows two separate booking entries for event 285 for this account. Event 285's available-seat
count decreases by the second booking's quantity as well.

---

### TC-event-booking-016 — Successful multi-ticket booking: seat decrement and My Bookings appearance
**Priority:** P0
**Preconditions:** Tester is logged in and on `/events/285` (Dilli Diwali Mela, $300/ticket,
availability noted before the test, e.g. 8912/10000 or current value).
**Flagged:** "Confirm Booking" was never clicked during exploration; this test case's expected
result (seat-count decrement, confirmation, `/bookings` appearance) is inferred from UI
structure/copy only and must be independently verified live before being treated as ground truth.
**Steps:**
1. Load `/events/285` and record the current "AVAILABLE" seat count (N).
2. Click "+" twice to bring ticket quantity to 3.
3. Confirm order summary reads "$300 × 3 tickets = $900", Total $900.
4. Fill "Full Name*", "Email*", "Phone Number*" with valid values.
5. Click "Confirm Booking".
**Expected result:** A confirmation indicator is shown. Reload `/events/285`: "AVAILABLE" seat count
is now N − 3. Navigate to `/bookings`: a new booking entry for "Dilli Diwali Mela" appears showing
quantity 3 and total $900.

---

### TC-event-booking-017 — Both entry points (card click and "Book Now") render the identical booking widget
**Priority:** P2
**Preconditions:** Tester is logged in and on `/events`.
**Steps:**
1. From `/events`, click the "World Tech Summit" event card (not the "Book Now" button); note the
   full state of the "Book Tickets" widget on the resulting `/events/283` page (price/ticket,
   default quantity, field labels/placeholders, available seats, Confirm Booking button).
2. Navigate back to `/events`. This time click the "Book Now" button on the same "World Tech
   Summit" card.
**Expected result:** Both interactions navigate to the same URL, `/events/283`. The "Book Tickets"
widget rendered is identical in both cases: same price/ticket ($1,500), same default ticket
quantity (1), same required fields (Full Name*, Email*, Phone Number*), same available-seat count,
and the same "Confirm Booking" button.

---

### TC-event-booking-018 — Direct navigation to event detail succeeds even when listing-page RSC prefetch returns 503
**Priority:** P2
**Preconditions:** Tester is logged in and on `/events`. Requires network-request inspection
tooling (e.g. browser dev tools / network capture) to observe RSC prefetch responses.
**Flagged: negative/reliability test case, in scope per clarifications doc.** Intermittent 503s were
observed on Next.js RSC prefetches for all three event ids when prefetched from the `/events`
listing context, while direct navigation to the same routes succeeded with 200. Root cause (flaky
SSR vs. rate limiting) is unknown.
**Steps:**
1. On `/events`, open network request capture and observe RSC prefetch requests fired for the
   event detail routes (`/events/283`, `/events/284`, `/events/285`) as the listing page loads/is
   hovered.
2. Note whether any of these prefetch requests return `503`.
3. Regardless of the prefetch outcome, click through (card click or "Book Now") to one of the event
   detail pages, e.g. `/events/283`.
**Expected result:** Even if the listing-page RSC prefetch for `/events/283` returned a `503`, the
actual click-through navigation to `/events/283` succeeds and renders the full event detail page
(200), i.e. the earlier prefetch failure does not block or break the user-initiated navigation.

---

### TC-event-booking-019 — Order total recalculates correctly across a full sequence of stepper changes, including at the max boundary
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events/284` (Hollywood Monsoon Night — Los Angeles,
$2,500/ticket).
**Steps:**
1. Confirm stepper starts at 1; order summary reads "$2,500 × 1 ticket = $2,500", Total $2,500.
2. Click "+" to reach quantity 3; confirm order summary reads "$2,500 × 3 tickets = $7,500", Total
   $7,500.
3. Click "+" repeatedly to reach quantity 10 (the stated max); confirm order summary reads "$2,500
   × 10 tickets = $25,000", Total $25,000.
4. Click "−" to bring quantity back down to 6; confirm order summary reads "$2,500 × 6 tickets =
   $15,000", Total $15,000.
**Expected result:** At every step in the sequence, the order summary's displayed total exactly
equals price/ticket ($2,500) × the currently selected quantity, updating live with each stepper
click in both directions, and correctly reflecting the value at the max boundary (10).

---

*(End of test cases — 19 total: 6 happy path, 2 negative, 11 boundary.)*
