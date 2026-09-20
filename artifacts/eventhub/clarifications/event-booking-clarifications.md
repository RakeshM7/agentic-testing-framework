# Event Booking — Clarifications

Target: eventhub (https://eventhub.rahulshettyacademy.com)
Feature: event-booking
Source: explore-agent crawl artifacts (`artifacts/eventhub/explore/sitemap.json`, `crawl-log.md`,
`pages/events/`, `pages/event-detail/`, `pages/my-bookings/`) + Pass-1/Pass-2 human clarification.

---

## Feature summary

The booking flow lets an authenticated user browse the Upcoming Events listing (`/events`), enter
an individual event's detail page (`/events/{id}`) via either the event card or its "Book Now"
button, choose a ticket quantity (1–10) in the right-rail "Book Tickets" widget, fill in Full
Name / Email / Phone Number, review the computed order total ($/ticket × quantity), and submit via
"Confirm Booking" to create a booking that should then decrement seat availability and appear on
the "My Bookings" (`/bookings`) page.

**Caveat carried through this whole document:** the explore-agent crawl was read-only and
deliberately never clicked "Confirm Booking" (or any other mutating control). No booking was ever
actually completed, so every post-submission behavior below is inferred from UI copy, layout, and
observed DOM state rather than independently verified end-to-end. This is called out again per
item below and is not to be treated as verified fact by the test-generation agent.

Three real, seeded, non-deletable ("Read-only" / "Featured") events exist in this environment and
should be used as the stable fixtures for this suite:

| Event ID | Title | Category | City / Venue | Price/ticket | Seats available/total (at crawl time) |
|---|---|---|---|---|---|
| 285 | Dilli Diwali Mela | Festival | Pragati Maidan Exhibition Grounds, Delhi | $300 | 8912 / 10000 |
| 284 | Hollywood Monsoon Night — Los Angeles | Concert | Dome, NSCI SVP Stadium, Worli, Los Angeles | $2,500 | 2959 / 3000 |
| 283 | World Tech Summit | Conference | Hitech City, Hyderabad | $1,500 | 233 / 500 |

(Ground truth for id→title mapping is the confirmed `event-detail` capture for id 285 plus
`sitemap.json`'s authenticated-crawl notes; an earlier, superseded snapshot of the `/events`
listing page flagged the id-to-card mapping as unconfirmed before the detail-page visit resolved
it — downstream agents should use the table above, not the earlier uncertain note.)

None of the three seeded events is anywhere near sold out; event 283 (World Tech Summit) has the
lowest available-seat ratio (233/500 ≈ 47% available) and is the closest available proxy for
low-availability testing, but no seeded event is actually sold out or near-zero-availability.

## In scope / Out of scope

**In scope:**
- Booking entry via the event card click on `/events` (navigates to `/events/{id}`).
- Booking entry via the separate "Book Now" button on `/events` (also navigates to
  `/events/{id}`) — both are real, distinct interactive elements and both must be covered.
- The booking widget on `/events/{id}`: ticket quantity stepper, Full Name / Email / Phone Number
  fields, order total display, "Confirm Booking" submit.
- Standard booking-success behaviors (seat count decrement, confirmation feedback, appearance in
  My Bookings) — asserted as expected results, flagged as inferred/unverified (see Confirmed
  behaviors below).
- Ticket stepper boundary behavior (min 1, max 10) — flagged assumption.
- Field-level validation (required fields, email format, phone format) — flagged assumption.
- Duplicate booking of the same event by the same user — flagged assumption (permitted).
- Price/total calculation (qty × price/ticket) — in scope, directly assertable from DOM.
- The intermittent 503 on event-detail RSC prefetches from the `/events` listing — included as a
  flagged negative/reliability test case.
- Sold-out event coverage — included only as a flagged/unconfirmed test case (no environment fixture
  exists to verify it against).

**Out of scope:**
- Authorization / role-based access control (consumer vs. admin nav visibility, whether a
  non-admin account can reach `/admin/events`) — explicit user decision to exclude from this suite.
- Admin event management (create/edit/delete events, the 6-event FIFO-eviction cap) — not part of
  the booking flow.
- "Clear all bookings" destructive action on `/bookings` — never exercised, not part of booking
  creation.
- Login/registration flows themselves (covered by a separate auth-focused suite, not this one).
- Any event other than the three seeded fixtures (283, 284, 285) — no other events exist in this
  environment.

## Confirmed behaviors

- Both the event-card click and the standalone "Book Now" button on `/events` navigate to
  `/events/{id}` and are both real, independently clickable entry points into the booking flow.
  *(Source: Q8 answer; `pages/events/dom-snapshot.md` interactive-elements list shows both `ref_11`
  and `ref_12` as separate links to the same href.)*
- The booking widget on `/events/{id}` requires Full Name, Email, and Phone Number (all marked
  required with `*`), plus a ticket-quantity stepper defaulting to 1 with a stated max of 10.
  *(Source: `pages/event-detail/dom-snapshot.md`.)*
- Order total is computed and displayed as `price/ticket × quantity = total` (observed on event
  285: "$300 × 1 ticket = $300", Total $300) — this is a directly assertable DOM value, in scope
  as a test assertion. *(Source: Q10 answer + `pages/event-detail/dom-snapshot.md`.)*
- Standard booking-success behaviors — seat-available count decreasing by the booked quantity,
  a confirmation indicator on submit, and the new booking appearing on `/bookings` — are asserted
  as the suite's expected results for a successful booking. **These are inferred from UI structure
  and copy only; "Confirm Booking" was never actually clicked during exploration, so no completed
  booking or its downstream effects were independently observed.** Treat as expected-result
  assertions to verify, not as pre-verified fact. *(Source: Q2 answer.)*
- Duplicate booking of the same event by the same authenticated user is assumed to be **permitted**
  — no uniqueness constraint, disabled state, or warning was observed anywhere in the crawled UI
  (the booking widget, `/bookings`, or elsewhere). This is an assumption to verify live, not a
  confirmed rule. *(Source: Q6 answer.)*
- Ticket stepper boundary behavior is assumed standard: decrement is blocked/disabled at quantity 1,
  increment is blocked/disabled at quantity 10. Never exercised interactively during exploration —
  flagged as an assumption to verify live. *(Source: Q4 answer; stepper bounds "1–10" stated in
  `pages/event-detail/dom-snapshot.md`.)*
- Field-level validation is assumed standard client-side behavior: empty-required-field errors for
  Full Name/Email/Phone Number, email-format validation on the Email field, phone-format validation
  on the Phone Number field. Never exercised interactively — flagged as an assumption to verify
  live. *(Source: Q5 answer.)*

## Edge cases

| Scenario | Expected behavior |
|---|---|
| Sold-out event booking attempt | **Flagged/unconfirmed.** No seeded event is sold out or near-zero-availability in this environment (lowest is event 283 at 233/500 available). Write the test case as a placeholder describing expected behavior (e.g., booking blocked / quantity capped / error shown) but flag it as unverifiable in this environment until a sold-out fixture exists. |
| Ticket stepper at minimum (qty = 1), user clicks "−" | Assumed: decrement button is disabled/no-ops at 1; quantity does not go below 1. Flagged assumption, not observed live. |
| Ticket stepper at maximum (qty = 10), user clicks "+" | Assumed: increment button is disabled/no-ops at 10; quantity does not exceed 10. Flagged assumption, not observed live. |
| Submit booking form with Full Name, Email, or Phone Number empty | Assumed: standard required-field validation error(s) shown, submission blocked. Flagged assumption, not observed live. |
| Submit booking form with malformed email (e.g. missing `@`) | Assumed: standard email-format validation error shown, submission blocked. Flagged assumption, not observed live. |
| Submit booking form with malformed phone number | Assumed: standard phone-format validation error shown, submission blocked. Flagged assumption, not observed live. (Placeholder format shown in UI: `+91 98765 43210`.) |
| Same user books the same event a second time | Assumed **permitted** (no uniqueness constraint observed anywhere in the UI). Flagged assumption, not observed live. |
| Successful booking submission | Assumed: seat-available count for the event decreases by the booked quantity, a confirmation is shown to the user, and the booking appears on `/bookings`. Flagged as inferred from UI structure only — never independently verified by an actual completed booking (Confirm Booking was never clicked during exploration). |
| Navigating to an event detail page from the `/events` listing (either via card click or "Book Now" button) | Both entry points navigate to `/events/{id}` and should render the same booking widget. In scope per explicit user decision. |
| RSC prefetch of `/events/{id}` from the `/events` listing page | **Flagged negative/reliability test case, in scope.** Intermittent `503` responses were observed on Next.js RSC prefetches for all three event ids (283, 284, 285) when prefetched from the `/events` listing context, while a *direct* navigation to the same route succeeded with `200`. Suggests flaky/rate-limited server-side rendering rather than a hard failure. Should be tested as: does a direct navigation/click-through to the event detail page reliably succeed even when the listing-page prefetch has failed/returned 503? |
| Price/total calculation display | In scope, assertable: total shown = price/ticket × selected quantity (e.g., event 285: $300 × qty). Verify recalculation as quantity changes via the stepper. |

## Non-functional constraints

- **Reliability:** the intermittent 503 on RSC prefetch of event-detail routes (see Edge cases
  table) is the only non-functional signal observed during exploration and should be captured as a
  reliability/negative test case per the user's explicit scope decision (Q7). No other performance,
  accessibility, or security constraints were observed or raised during exploration; none of those
  categories are otherwise in scope for this suite (authorization/RBAC explicitly excluded, see
  Out of scope).
- No load, performance-timing, or accessibility (a11y) requirements were surfaced by the crawl or
  by the user; treat these as not applicable to this suite unless raised separately.

## Confirmed test-case output format

**Plain Markdown steps table.** This is the single, explicit format the
`testcase-generator-agent` should use verbatim for every test case in this suite — no Gherkin, no
CSV, no TestRail import format.

## Open questions

- **Sold-out behavior is entirely unverified.** No seeded event in this environment ever reaches
  0 available seats, so the actual sold-out UI/error behavior (disabled booking widget? error
  message? waitlist? nothing prevents overbooking?) is unknown and cannot be confirmed without a
  sold-out fixture or a way to drive event 283 (or another) down to 0 availability. Flagged for
  human follow-up.
- **Ticket stepper boundary behavior (min 1 / max 10)** is assumed standard but was never clicked
  during exploration — needs live verification before being treated as confirmed.
- **Field-level validation rules** (required-field, email-format, phone-format) are assumed
  standard client-side behavior but were never triggered during exploration — exact error copy,
  timing (on-blur vs on-submit), and whether server-side validation also applies are unknown.
- **Duplicate-booking permissiveness** is assumed (no uniqueness constraint observed) but was never
  tested by actually submitting two bookings for the same event/user — needs live verification.
- **Post-submission effects of a successful booking** (seat-count decrement, confirmation UI,
  appearance on `/bookings`) are inferred from page structure/copy only. "Confirm Booking" was
  never clicked during exploration (deliberately, per the explore-agent's read-only/no-mutation
  mandate), so none of this was independently observed. Needs live verification via an actual
  completed booking before being treated as ground truth.
- **The exact REST endpoint(s) backing booking creation** (e.g. `POST /api/bookings` on
  `api.eventhub.rahulshettyacademy.com`) were never observed client-side — the frontend appears to
  use Next.js server-side rendering/RSC rather than visible client XHR for most reads, and the
  write path for Confirm Booking was never exercised. If API-level (not just UI-level) test cases
  are needed for this feature, the Swagger docs at
  `https://api.eventhub.rahulshettyacademy.com/api/docs` should be consulted directly — out of
  scope for this UI-focused clarification but flagged for any companion api-testing-agent work.
- **Root cause of the intermittent 503 on RSC prefetch** is unknown (flaky SSR vs. rate limiting vs.
  something else) — flagged only as a test case to write, not something this document can explain.
