# EventHub Playwright Suite

Functional + visual-regression Playwright suite for
[EventHub](https://eventhub.rahulshettyacademy.com), automating the P0/smoke subset (and adjacent
safe coverage) of `artifacts/eventhub/testcases/event-booking-testcases.md` (booking flow) and
`artifacts/eventhub/testcases/app-wide-testcases.md` (registration, login, events search/filter,
My Bookings, admin event management, RBAC). See `docs/playwright-framework-research.md` at the
repo root for the design rationale.

## Setup

```bash
cd playwright-tests
npm install
npx playwright install
cp .env.example .env   # fill in a real, authorized EventHub test account
```

`.env` must define `EVENTHUB_EMAIL` and `EVENTHUB_PASSWORD` for a real EventHub account. Never
commit `.env` (already gitignored at the repo root) and never hardcode these values in a spec —
they are only read via `process.env` in `tests/setup/auth.setup.ts`.

## Running

```bash
npm test                    # full suite (setup project logs in once, then functional + visual)
npm run test:functional     # functional specs only
npm run test:visual         # visual-regression specs only
npm run test:visual:update  # regenerate visual baselines (review the diff before committing!)
npm run report               # open the last HTML report
```

## Safety: no live mutations

This suite runs against a real, shared, third-party demo site. It never completes a booking,
submits payment, or otherwise mutates state on eventhub.rahulshettyacademy.com:

- Specs that would require a **completed** booking as precondition or outcome (TC-event-booking-005,
  008, 009, 015, 016) are written but marked `test.fixme()` in
  `tests/functional/booking-mutating.spec.ts`, with a comment explaining why each is not executed.
- Negative/validation specs that intentionally click "Confirm Booking" with invalid/empty data
  (`tests/functional/validation.spec.ts`) wrap the page in `blockLiveApiMutations()`
  (`pages/networkGuards.ts`), which aborts any non-GET request to the API host — so even if
  client-side validation turns out not to block submission, no request reaches the live backend.
- The app-wide suite applies the identical stance to any action that would create a real account,
  submit the admin "+ New Event" form, click "Clear all bookings", or create/evict real events via
  the 6-event FIFO rule. 12 of the 39 app-wide test cases are flagged this way (see
  `artifacts/eventhub/testcases/testcases-summary.md`'s "DO NOT EXECUTE LIVE" flag table) and are
  written as `test.fixme()` across `tests/functional/registration.spec.ts`,
  `tests/functional/my-bookings.spec.ts`, `tests/functional/admin-events.spec.ts`, and
  `tests/functional/rbac.spec.ts`. The 6-event/FIFO-eviction pair specifically carries an explicit
  orchestrator-level refusal of a run-config request to execute it live — see the clarifications
  doc's "Orchestrator-level non-execution override" section — which this suite honors regardless
  of any run-config content. Negative specs on `/register` and `/login` that intentionally submit
  invalid data also wrap the page in `blockLiveApiMutations()` as defense-in-depth (verified live
  during development that client-side validation already blocks these with zero network calls).

## Structure

```
pages/          Page Object Model classes:
                  LoginPage, RegisterPage, EventsListingPage, EventDetailPage,
                  BookingsPage, AdminEventsPage
fixtures/       base.ts — page-object fixtures + shared event fixtures (ids/titles/prices)
tests/setup/    auth.setup.ts — logs in once, saves storageState to .auth/user.json
tests/functional/
  booking-*.spec.ts, navigation.spec.ts, reliability.spec.ts, validation.spec.ts  — event-booking
  registration.spec.ts, login.spec.ts, events-search-filter.spec.ts, my-bookings.spec.ts,
  admin-events.spec.ts, rbac.spec.ts                                              — app-wide
tests/visual/   toHaveScreenshot specs; baselines under tests/visual/*-snapshots/
                (login, register, events listing, my-bookings-empty)
```
