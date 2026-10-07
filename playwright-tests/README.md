# Playwright Suite

Functional + visual-regression Playwright suite, originally scaffolded for
[EventHub](https://eventhub.rahulshettyacademy.com) and now also covering the
`rakesh-freshsales-ind-sep21` Freshsales CRM target — see "Multi-target structure" below. See
`docs/playwright-framework-research.md` at the repo root for the original design rationale.

## EventHub target

Automates the P0/smoke subset (and adjacent safe coverage) of
`artifacts/eventhub/testcases/event-booking-testcases.md` (booking flow) and
`artifacts/eventhub/testcases/app-wide-testcases.md` (registration, login, events search/filter,
My Bookings, admin event management, RBAC).

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
                pages/freshsales/  — Freshsales-target POM classes (see "Multi-target structure")
fixtures/       base.ts — page-object fixtures + shared event fixtures (ids/titles/prices)
                freshsales.ts — Freshsales-target fixtures + created-entities.json writer
tests/setup/    auth.setup.ts — logs in once, saves storageState to .auth/user.json
                auth.freshsales.setup.ts — Freshsales-target login (see "Known blocker" below)
tests/functional/
  booking-*.spec.ts, navigation.spec.ts, reliability.spec.ts, validation.spec.ts  — event-booking
  registration.spec.ts, login.spec.ts, events-search-filter.spec.ts, my-bookings.spec.ts,
  admin-events.spec.ts, rbac.spec.ts                                              — app-wide
  freshsales/lead-to-deal-pipeline.spec.ts, freshsales/validation.spec.ts         — Freshsales target
tests/visual/   toHaveScreenshot specs; baselines under tests/visual/*-snapshots/
                (login, register, events listing, my-bookings-empty)
                freshsales/login-page.unauth.spec.ts — Freshsales target
```

## Multi-target structure

This project now covers two independent, unrelated targets that happen to share one Node project
and one `playwright.config.ts`:

1. **EventHub** (`eventhub.rahulshettyacademy.com`) — the original target, described above.
2. **Freshsales** (`rakesh-freshsales-ind-sep21.myfreshworks.com`) — a CRM covering
   `artifacts/rakesh-freshsales-ind-sep21/testcases/lead-to-deal-pipeline-testcases.csv`
   (TC-lead-to-deal-pipeline-001 through 014: Contact create+qualify as the tenant's lead-equivalent,
   Deal creation, full pipeline stage progression to Won, a separate Lost branch, Task/Call/Note
   activity logging, and required-field/invalid-email validation). Run under
   `authorizations.mode: full-run` for this tenant, per
   `artifacts/rakesh-freshsales-ind-sep21/clarifications/lead-to-deal-pipeline-clarifications.md`.

Each target gets its own `playwright.config.ts` project(s) (own baseURL, own setup/login flow, own
`storageState` file under `.auth/`), scoped by `testMatch`/`testIgnore` so neither target's tests
ever run under the other's session or base URL — see the `projects` array in
`playwright.config.ts`. Freshsales-specific credentials live in a separate
`playwright-tests/.env.freshsales` file (not the root `.env`, which holds `EVENTHUB_*` only), read
explicitly by `tests/setup/auth.freshsales.setup.ts`.

**Design note:** the two targets' POM classes are *not* merged into one shared `pages/` namespace
(EventHub's are flat, Freshsales' live under `pages/freshsales/`) because the two apps have nothing
in common beyond "this repo automates both of them" — EventHub is an events-booking demo site,
Freshsales is a Freshworks CRM. Forcing a shared abstraction between them would add indirection
with no reuse benefit. If a third target is added later, the same per-target subdirectory pattern
should be repeated rather than introducing a premature "generic CRUD page" abstraction.

### Freshsales setup

```bash
cd playwright-tests
npm install
npx playwright install
# playwright-tests/.env.freshsales already exists in this repo for this tenant; if recreating it,
# use this exact shape (the password is quoted because it contains a '#', which dotenv would
# otherwise treat as a comment start and silently truncate):
#   FRESHSALES_URL=https://rakesh-freshsales-ind-sep21.myfreshworks.com/
#   FRESHSALES_EMAIL=<real tenant login email>
#   FRESHSALES_PASSWORD="<real tenant password>"
```

### Known blocker: Freshsales login is reCAPTCHA-gated for scripted browsers

**This run's `setup-freshsales` project reliably fails**, and every test that depends on it
(all of `tests/functional/freshsales/lead-to-deal-pipeline.spec.ts` and
`tests/functional/freshsales/validation.spec.ts` — 14 test cases) is reported as **skipped due to
a failed dependency**, not silently absent, not fabricated as passing.

Verified directly during this run: submitting valid credentials to this tenant's `/login` form via
Playwright reliably triggers a Google reCAPTCHA image challenge instead of completing the login —
reproduced across:
- headless bundled Chromium,
- headed bundled Chromium,
- a headed real Chrome (`channel: 'chrome'`) browser,
- both instant `.fill()` input and human-paced character-by-character typing with mouse movement.

This is Google's own automation-detection gate on the login form, not an application bug, and not
something this agent attempts to solve or bypass — using a CAPTCHA-solving service or other
circumvention technique is out of scope for a testing agent and would defeat an anti-bot control
rather than test the application, independent of any run's `authorizations.mode`. The one page in
this target this suite *can* still exercise for real without a session is the login page itself
(`tests/visual/freshsales/login-page.unauth.spec.ts`, run under the `freshsales-unauth` project,
which has no dependency on `setup-freshsales`) — its visual-regression baseline was generated and
passes live.

**Remediation options for a future run**, in rough order of preference:
1. A human completes the reCAPTCHA challenge once interactively (e.g. via the same kind of
   interactive Playwright MCP session `explore-agent` uses) and hands off the resulting
   `storageState` JSON for this agent to reuse, bypassing scripted login entirely.
2. The tenant/IP this automation runs from is placed on a CAPTCHA allowlist (a Freshworks
   admin-side control, outside this agent's scope).
3. Re-attempt this run from a different network/IP reputation if the trigger turns out to be
   IP-reputation-based rather than universal to all scripted browsers.

See the filed feedback file for this finding (path in this run's automation report) for the fuller
writeup of what was tried.

## Enterprise reusable framework structure

This Playwright module is intentionally layered so the agent can keep generating tests without
duplicating framework code.

```text
playwright-tests/
├── config/
│   ├── env.ts                  # .env parsing + validation
│   ├── timeouts.ts             # named timeout categories
│   ├── framework.config.ts     # single runtime configuration object
│   └── environments/           # optional environment extension points
├── fixtures/
│   ├── framework.ts            # common waits/config fixtures
│   ├── base.ts                 # EventHub domain fixtures
│   └── freshsales.ts           # Freshsales domain fixtures
├── helpers/
│   ├── wait.helper.ts          # reusable condition/URL/load waits
│   ├── date.helper.ts
│   └── string.helper.ts
├── utils/
│   ├── logger.ts
│   └── test-data.ts            # reusable unique test-data generators
├── api/
│   └── base-api-client.ts      # reusable API client foundation
├── types/
│   └── framework.ts
├── test-data/
│   └── factories.ts
├── pages/                      # existing domain Page Objects are preserved
├── tests/
│   ├── functional/
│   ├── visual/
│   └── setup/
├── .env.example
└── playwright.config.ts
```

### Wait/timeout standard

Do not add arbitrary values such as `timeout: 15000` or `waitForTimeout(3000)` to individual
tests or page objects.

Use Playwright auto-waiting first. When an explicit condition wait is required, use:

```ts
await waits.forUrl(page, /\/crm\/sales\/deals\/\d+/);
await waits.forVisible(locator);
await waits.forLoadState(page, 'networkidle');
```

The timeout values are configured centrally in `.env`:

```env
PW_TEST_TIMEOUT_MS=30000
PW_EXPECT_TIMEOUT_MS=10000
PW_ACTION_TIMEOUT_MS=10000
PW_NAVIGATION_TIMEOUT_MS=30000
PW_API_TIMEOUT_MS=30000
PW_EXPLICIT_WAIT_MS=1000
```

This means the same framework can be reused across applications/environments without editing
every page object or test when timing characteristics change.

### Compatibility rule for the agent

Existing `pages/`, `fixtures/`, and `tests/` entry points are retained so the current agent can
continue generating and importing tests using the paths it already knows. New reusable framework
code belongs in `config/`, `helpers/`, `utils/`, `api/`, `types/`, and `test-data/`.

### Layering rule

```text
Tests
  ↓
Domain Fixtures
  ↓
Page Objects / API Clients
  ↓
Reusable Helpers / Utilities
  ↓
Central Configuration (.env)
```

Tests should express business intent. Page Objects should own UI interaction details. Helpers should
own repeated technical behaviour. Configuration should own environment-specific values.
