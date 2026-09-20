# EventHub Playwright Suite

Functional + visual-regression Playwright suite for
[EventHub](https://eventhub.rahulshettyacademy.com), automating the P0/smoke subset (and adjacent
safe coverage) of `artifacts/eventhub/testcases/event-booking-testcases.md`. See
`docs/playwright-framework-research.md` at the repo root for the design rationale.

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

- Specs that would require a **completed** booking as precondition or outcome (TC-005, TC-008,
  TC-009, TC-015, TC-016) are written but marked `test.fixme()` in
  `tests/functional/booking-mutating.spec.ts`, with a comment explaining why each is not executed.
- Negative/validation specs that intentionally click "Confirm Booking" with invalid/empty data
  (`tests/functional/validation.spec.ts`) wrap the page in `blockLiveBookingMutations()`
  (`pages/networkGuards.ts`), which aborts any non-GET request to the API host — so even if
  client-side validation turns out not to block submission, no request reaches the live backend.

## Structure

```
pages/          Page Object Model classes (LoginPage, EventsListingPage, EventDetailPage)
fixtures/       base.ts — page-object fixtures + shared event fixtures (ids/titles/prices)
tests/setup/    auth.setup.ts — logs in once, saves storageState to .auth/user.json
tests/functional/
tests/visual/   toHaveScreenshot specs; baselines under tests/visual/*-snapshots/
```
