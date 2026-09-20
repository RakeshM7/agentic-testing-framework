# Event Booking — Test Case Summary

Target: eventhub | Feature: event-booking
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
