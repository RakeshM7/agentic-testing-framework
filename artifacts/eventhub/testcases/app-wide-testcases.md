# App-Wide (Non-Booking) — Test Cases

Target: eventhub (https://eventhub.rahulshettyacademy.com)
Feature: app-wide (registration, login, events search/filter, My Bookings management, admin event
management, and RBAC — everything outside the separately-covered `event-booking` feature)
Source: `artifacts/eventhub/clarifications/app-wide-clarifications.md` (authoritative) +
`artifacts/eventhub/explore/sitemap.json` and page snapshots (`pages/register/`, `pages/login/`,
`pages/events/`, `pages/my-bookings/`, `pages/admin/`) for real UI element labels.

Format: Plain Markdown steps table, per the confirmed test-case output format in the clarifications
doc ("Confirmed test-case output format" section — no Gherkin, no CSV, no TestRail import format).
Same format as the sibling `event-booking-testcases.md`.

## Legend

- **Priority:** P0 (critical path / directly-observed fact) · P1 (core confirmed behavior or
  primary edge case) · P2 (secondary/cosmetic/exploratory).
- **Execution status flag — "DO NOT EXECUTE LIVE":** applied to every test case whose steps would,
  if actually carried out, perform a real mutating action this run's non-mutation stance forbids
  (creating a real account, submitting the admin "+ New Event" form in any way — positive or
  negative — clicking "Clear all bookings", or creating/evicting real events via the 6-event/FIFO
  rule), or that cannot be executed live at all this run because a required fixture (a non-admin
  account) does not exist. These cases are written to the same level of executable detail as every
  other case, but `playwright-automation-agent` must treat them as **documented-only** and must
  **not** attempt to automate them as live actions. This is the exact same non-execution stance the
  `event-booking` suite applies to "Confirm Booking" flags, extended here per the clarifications
  doc's explicit scope decisions (items 3, 9, 10, 13) and the **orchestrator-level non-execution
  override** recorded in that doc for the 6-event/FIFO-eviction flow specifically (item 10 — the
  run-config's request for live execution of that flow was explicitly overridden by the
  orchestrator; see the clarifications doc's "Orchestrator-level non-execution override" section).
  Test cases *without* this flag are standard negative/validation cases that are safe to execute
  live (e.g. submitting invalid registration/login data is expected to be blocked by validation
  before any account/resource is created).

**Seeded fixtures used throughout (per clarifications doc; ground truth, shared with `event-booking`):**

| Event ID | Title | Category | City / Venue | Price/ticket | Seats available/total (at doc time) |
|---|---|---|---|---|---|
| 285 | Dilli Diwali Mela | Festival | Pragati Maidan Exhibition Grounds, Delhi | $300 | 8912 / 10000 |
| 284 | Hollywood Monsoon Night — Los Angeles | Concert | Dome, NSCI SVP Stadium, Worli, Los Angeles | $2,500 | 2959 / 3000 |
| 283 | World Tech Summit | Conference | Hitech City, Hyderabad | $1,500 | 233 / 500 |

**Test-account strategy (governs every case below):** `admin-user@example.com` is the sole
reusable, admin-capable authenticated fixture account for this run (confirmed via the crawl to see
the Admin nav item and reach `/admin/events`). No new account is registered live, and no non-admin
account is registered or available. `known-bad-user@example.com`'s invalid-credentials behavior
(`POST /api/auth/login` → `400`, toast "Invalid email or password") is directly-observed evidence
from exploration, reused as-is.

**General precondition for every test case below unless stated otherwise:** tester is logged into
EventHub as `admin-user@example.com`. Cases covering `/register` and `/login` themselves instead
start from an unauthenticated session, as stated in each case's own preconditions.

---

## Happy path

### TC-app-wide-001 — Registration form renders required fields, password policy, and navigation link
**Priority:** P2
**Preconditions:** Tester is unauthenticated and navigates to `/register`.
**Steps:**
1. Load `/register`.
2. Inspect the "Create your account" form.
**Expected result:** Page shows heading "Create your account — Get your own EventHub sandbox", an
"Email" field (placeholder "you@email.com", type=email), a "Password" field (placeholder "Min 8
chars, uppercase, number & symbol", type=password) with policy text listing "At least 8 characters",
"One uppercase letter (A-Z)", "One number (0-9)", "One special character (!@#$%^&*...)", a "Confirm
Password" field (placeholder "Repeat your password", type=password), a "Create Account" submit
button, and a "Sign in" link to `/login`.

---

### TC-app-wide-002 — Successful registration submission auto-logs in and redirects
**Priority:** P1
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Submitting valid,
never-before-used registration data would create a real account this run's non-mutation stance
forbids (clarifications doc, item 3 / Out-of-scope: "Live creation of a new user account
(registration)... documented-but-not-executed"). Do not automate this case as a live action.
**Preconditions:** Tester is unauthenticated and on `/register`, with a valid, not-previously-used
email address prepared.
**Flagged:** Entirely assumed — "Create Account" was never submitted live during exploration.
**Steps:**
1. Load `/register`.
2. Fill "Email" with a valid, unused email address.
3. Fill "Password" with a value satisfying the displayed policy (≥8 chars, 1 uppercase, 1 number, 1
   special character), e.g. "TestPass1!".
4. Fill "Confirm Password" with the identical value.
5. Click "Create Account".
**Expected result (assumed, unverified):** Submission succeeds; the user is auto-logged-in and
redirected to `/events` (or home), with the nav bar now showing the authenticated state (Home /
Events / My Bookings / API Docs / Admin / Logout, if the new account has admin privileges, or
without Admin otherwise).

---

### TC-app-wide-003 — Login form renders required fields and "Register" link
**Priority:** P2
**Preconditions:** Tester is unauthenticated and navigates to `/login` (or `/`, which client-side
redirects to `/login`).
**Steps:**
1. Load `/login`.
2. Inspect the sign-in form.
**Expected result:** Page shows an Email field (placeholder "you@email.com", type=email), a Password
field (placeholder "••••••", type=password), a "Sign In" submit button, and a "Register" link to
`/register`.

---

### TC-app-wide-004 — Successful login with valid credentials redirects into the authenticated app
**Priority:** P0
**Preconditions:** Tester is unauthenticated and on `/login`. Uses the confirmed reusable fixture
account `admin-user@example.com`.
**Flagged:** Assumed — this account's authenticated session was used throughout the crawl, implying
a successful prior login, but the login submission itself was never independently re-observed as a
fresh interactive action during exploration. Verify live.
**Steps:**
1. Load `/login`.
2. Fill Email with `admin-user@example.com` and Password with the account's correct password.
3. Click "Sign In".
**Expected result:** Authentication succeeds; user is redirected into the authenticated app (`/` or
`/events`). Nav bar shows Home / Events / My Bookings / API Docs / Admin (dropdown, confirming
admin/event-manager privileges) / Logout.

---

### TC-app-wide-005 — Events listing renders search box, Category filter, and City filter with correct option sets
**Priority:** P2
**Preconditions:** Tester is logged in and on `/events`.
**Steps:**
1. Load `/events`.
2. Inspect the search box and the two filter dropdowns.
**Expected result:** A "Search events, venues…" free-text search box is present. An "All Categories"
dropdown is present with options: All Categories, Conference, Concert, Sports, Workshop, Festival.
An "All Cities" dropdown is present with options: All Cities, Mumbai, Bangalore, Delhi, Hyderabad,
Chennai, Pune. All 3 seeded events (285, 284, 283) render below, unfiltered.

---

### TC-app-wide-006 — Category filter alone narrows the events listing to matching events only
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events`, all 3 seeded events visible unfiltered.
**Flagged:** Assumed narrowing behavior; directly derivable from fixture data but the filtering
mechanism itself was never interactively exercised during exploration. Verify live.
**Steps:**
1. Open the "All Categories" dropdown and select "Festival".
**Expected result:** Listing narrows to show only "Dilli Diwali Mela" (id 285, the only seeded event
with category Festival). "Hollywood Monsoon Night — Los Angeles" (Concert) and "World Tech Summit"
(Conference) are no longer shown.

---

### TC-app-wide-007 — City filter alone narrows the events listing to matching events only
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events`, all 3 seeded events visible unfiltered.
**Flagged:** Assumed narrowing behavior; directly derivable from fixture data but never interactively
exercised during exploration. Verify live.
**Steps:**
1. Open the "All Cities" dropdown and select "Delhi".
**Expected result:** Listing narrows to show only "Dilli Diwali Mela" (id 285, the only seeded event
with city Delhi). The other two events are no longer shown.

---

### TC-app-wide-008 — My Bookings empty state renders for an account with zero bookings
**Priority:** P1
**Preconditions:** Tester is logged in as `admin-user@example.com` (directly observed to have zero
existing bookings at crawl time).
**Steps:**
1. Navigate to `/bookings`.
**Expected result:** Page shows heading "My Bookings — View and manage all your ticket bookings", a
"Clear all bookings" utility link/button, and the empty-state message "No bookings yet — You haven't
booked any events yet. Browse upcoming events and grab your tickets!" with a "Browse Events" button
that links to `/events`.

---

### TC-app-wide-009 — Admin "All Events" table lists all 3 seeded events with correct field values
**Priority:** P2
**Preconditions:** Tester is logged in as `admin-user@example.com` (admin-capable) and on
`/admin/events`.
**Steps:**
1. Load `/admin/events`.
2. Scroll to the "All Events" table below the "+ New Event" form.
**Expected result:** Table shows 3 rows with columns Title | Category | City | Date | Price | Seats |
Actions: "Dilli Diwali Mela (Featured)" / Festival / Delhi / 20 Oct 2026 / $300 / 8912/10000;
"Hollywood Monsoon Night — Los Angeles (Featured)" / Concert / Los Angeles / 12 Jul 2026 / $2,500 /
2959/3000; "World Tech Summit (Featured)" / Conference / Hyderabad / 18 Apr 2026 / $1,500 / 233/500.

---

### TC-app-wide-010 — Admin nav item and `/admin/events` route are reachable for the admin-capable account
**Priority:** P1
**Preconditions:** Tester is logged in as `admin-user@example.com`.
**Steps:**
1. From any authenticated page, open the "Admin" nav dropdown.
2. Navigate to `/admin/events` (directly, or via the dropdown / the "Manage Events" footer link / the
   "+ Add New Event" button on `/events`).
**Expected result:** `/admin/events` loads successfully (no redirect, no 403), showing the "+ New
Event" form and the "All Events" table, confirming this account has admin/event-manager privileges.

---

## Negative

### TC-app-wide-011 — Login with invalid credentials shows "Invalid email or password"
**Priority:** P0
**Preconditions:** Tester is unauthenticated and on `/login`. Uses `known-bad-user@example.com` (an
account confirmed, via direct exploration, to return `400` from the login API).
**Directly observed, not an assumption.** `POST /api/auth/login` returned `400` for this account;
UI toast displayed "Invalid email or password" (`artifacts/eventhub/explore/login-attempt-failed/network-request.json`).
**Steps:**
1. Load `/login`.
2. Fill Email with `known-bad-user@example.com` and Password with an incorrect/any password.
3. Click "Sign In".
**Expected result:** Login is rejected. A toast/error message reading "Invalid email or password" is
shown. User remains on `/login`, not authenticated.

---

### TC-app-wide-012 — Empty-field submission on `/login` is blocked by required-field validation
**Priority:** P1
**Preconditions:** Tester is unauthenticated and on `/login`.
**Flagged:** Assumed — never exercised live during exploration; verify whether validation fires
client-side with no network call, and the exact error copy.
**Steps:**
1. Load `/login`.
2. Leave Email and Password both empty.
3. Click "Sign In".
**Expected result:** Submission is blocked. Required-field validation errors are shown for Email and
Password. No navigation occurs and no network call to the login API is made.

---

### TC-app-wide-013 — Empty-field submission on `/register` is blocked by required-field validation
**Priority:** P1
**Preconditions:** Tester is unauthenticated and on `/register`.
**Flagged:** Assumed — never exercised live during exploration; verify whether validation fires
client-side with no network call, and the exact error copy.
**Steps:**
1. Load `/register`.
2. Leave Email, Password, and Confirm Password all empty.
3. Click "Create Account".
**Expected result:** Submission is blocked. Required-field validation errors are shown for Email,
Password, and Confirm Password. No account is created and no network call to the registration API is
made.

---

### TC-app-wide-014 — Registration with a password violating the displayed policy is blocked
**Priority:** P1
**Preconditions:** Tester is unauthenticated and on `/register`.
**Flagged:** Assumed standard on-submit client-side validation; never exercised live. Verify live,
including exact error copy and whether validation fires on-blur or only on-submit. This case is safe
to execute live: validation is expected to block submission before any account is created.
**Steps:**
1. Fill Email with a valid, unused email address.
2. Fill Password with a value violating the policy, e.g. "short1!" (7 chars, below the 8-char
   minimum).
3. Fill Confirm Password with the identical value.
4. Click "Create Account".
**Expected result:** Submission is blocked. A validation error indicating the password policy is not
met is shown near the Password field. No account is created.

---

### TC-app-wide-015 — Registration with Confirm Password ≠ Password is blocked
**Priority:** P1
**Preconditions:** Tester is unauthenticated and on `/register`.
**Flagged:** Assumed generic "passwords do not match" (or similar) error; never exercised live.
Verify live, including exact error copy. Safe to execute live: validation is expected to block
submission before any account is created.
**Steps:**
1. Fill Email with a valid, unused email address.
2. Fill Password with a policy-compliant value, e.g. "TestPass1!".
3. Fill Confirm Password with a different value, e.g. "TestPass2!".
4. Click "Create Account".
**Expected result:** Submission is blocked. A "passwords do not match" (or similarly generic) error
is shown near the Confirm Password field. No account is created.

---

### TC-app-wide-016 — Events search with a query that matches no events shows an empty/no-results state
**Priority:** P2
**Preconditions:** Tester is logged in and on `/events`.
**Flagged:** Assumed — exact mechanism (live/debounced vs. submit-only) and exact zero-results copy
are unconfirmed; verify live.
**Steps:**
1. Type a query guaranteed to match none of the 3 seeded events into the search box, e.g. "zzz-no-
   match-zzz".
**Expected result:** Listing narrows to zero results. A "No events found" (or similar) empty state is
shown in place of the event cards.

---

## Boundary (one test case per edge-case-table row in the clarifications doc)

### TC-app-wide-017 — Registration with duplicate (already-registered) email is rejected
**Priority:** P1
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Attempting this would
require submitting the registration form with the fixture account's own email
(`admin-user@example.com`) or another already-registered address, which this run's non-mutation
stance treats as out-of-scope account-creation testing (clarifications doc, item 3).
**Preconditions:** Tester is unauthenticated and on `/register`. `admin-user@example.com` is a
known already-registered address.
**Flagged:** Assumed — never exercised live.
**Steps:**
1. Fill Email with `admin-user@example.com` (already registered).
2. Fill Password and Confirm Password with a policy-compliant matching value.
3. Click "Create Account".
**Expected result (assumed, unverified):** Backend rejects the submission with a clear inline error
near the Email field (e.g. "Email already registered"). No duplicate account is created.

---

### TC-app-wide-018 — Registration password policy: each individual rule violation, tested in isolation
**Priority:** P1
**Preconditions:** Tester is unauthenticated and on `/register`.
**Flagged:** Assumed standard client-side validation; never exercised live. Safe to execute live —
each sub-case is expected to be blocked by validation before any account is created.
**Steps (four sub-cases, each run independently with a fresh valid, unused email and matching
Confirm Password):**
1a. Password missing the 8-character minimum, e.g. "Ab1!xyz" (7 chars).
1b. Password missing an uppercase letter, e.g. "abcdef1!".
1c. Password missing a number, e.g. "Abcdefg!".
1d. Password missing a special character, e.g. "Abcdefg1".
**Expected result:** For each sub-case, submission is blocked and a validation error specific to (or
generically covering) the violated rule is shown. No account is created in any of the four
sub-cases.

---

### TC-app-wide-019 — Registration Confirm Password mismatch by a single character
**Priority:** P2
**Preconditions:** Tester is unauthenticated and on `/register`.
**Flagged:** Assumed generic mismatch error; never exercised live. Safe to execute live.
**Steps:**
1. Fill Email with a valid, unused email address.
2. Fill Password with "TestPass1!".
3. Fill Confirm Password with "TestPass1?" (differs by one trailing character only).
4. Click "Create Account".
**Expected result:** Submission is blocked with the same "passwords do not match" (or similar) error
as a fully-different mismatch, confirming the comparison is exact-match, not fuzzy/lenient. No
account is created.

---

### TC-app-wide-020 — Successful registration submission — redirect target and auto-login state
**Priority:** P1
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Same reason as
TC-app-wide-002: this would create a real account, which this run's non-mutation stance forbids.
**Preconditions:** Tester is unauthenticated and on `/register`, with a valid, unused email prepared.
**Flagged:** Entirely assumed — never submitted live during exploration.
**Steps:**
1. Complete and submit the registration form with fully valid, matching, policy-compliant data.
2. Observe the resulting URL and nav-bar state.
**Expected result (assumed, unverified):** User lands on `/events` (or home) in an authenticated
state (nav bar shows Home / Events / My Bookings / API Docs / Logout, and Admin only if the new
account happens to be admin-capable, which is not expected for a freshly-registered account).

---

### TC-app-wide-021 — Empty-field submission on `/login` and `/register`, per-field isolation
**Priority:** P2
**Preconditions:** Tester is unauthenticated. Run once against `/login` and once against `/register`.
**Flagged:** Assumed standard client-side validation; never exercised live. Safe to execute live.
**Steps (per page, one field left empty at a time, others filled validly):**
1a. `/login`: leave Email empty, Password filled; click "Sign In".
1b. `/login`: leave Password empty, Email filled; click "Sign In".
1c. `/register`: leave Email empty, Password and Confirm Password filled validly and matching; click
    "Create Account".
1d. `/register`: leave Password empty (Confirm Password filled), Email filled; click "Create
    Account".
1e. `/register`: leave Confirm Password empty (Password filled), Email filled; click "Create
    Account".
**Expected result:** In every sub-case, submission is blocked and a required-field validation error
is shown for exactly the one empty field. No network call to the login/registration API is made and
no account is created in any sub-case.

---

### TC-app-wide-022 — Login with valid credentials as a fresh interactive submission
**Priority:** P1
**Preconditions:** Tester starts from a fully logged-out session (not merely an idle authenticated
tab) and navigates to `/login`.
**Flagged:** Assumed — this account's authenticated session was used throughout the crawl (implying
a successful prior login), but the login submission itself was never independently re-observed as a
fresh interactive action starting from a logged-out state. Verify live.
**Steps:**
1. Ensure the browser session is fully logged out (clear cookies/local storage if needed).
2. Load `/login`.
3. Fill Email with `admin-user@example.com` and the correct Password.
4. Click "Sign In".
**Expected result:** Authentication succeeds on the first attempt from a clean/logged-out state;
redirect into the authenticated app occurs exactly as in TC-app-wide-004.

---

### TC-app-wide-023 — Login with invalid credentials — directly-observed API-level fixture
**Priority:** P0
**Preconditions:** Tester is unauthenticated and on `/login`. Uses `known-bad-user@example.com`.
**Directly observed, not an assumption.** During exploration, `POST /api/auth/login` for this exact
account returned HTTP `400`, and the UI displayed the toast "Invalid email or password"
(`artifacts/eventhub/explore/login-attempt-failed/network-request.json`). This case additionally
asserts the underlying network response, not just the UI toast covered by TC-app-wide-011.
**Steps:**
1. Load `/login` with network-request inspection tooling enabled (dev tools / network capture).
2. Fill Email with `known-bad-user@example.com` and any password.
3. Click "Sign In".
4. Inspect the `POST /api/auth/login` network response.
**Expected result:** `POST /api/auth/login` returns HTTP `400`. UI shows toast "Invalid email or
password". No authenticated session is established; user remains on `/login`.

---

### TC-app-wide-024 — Free-text search on `/events` by title, venue, or city substring
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events`, all 3 seeded events visible unfiltered.
**Flagged:** Assumed case-insensitive match against title/venue/city, live/debounced filtering;
mechanism and exact behavior unconfirmed. Verify live.
**Steps:**
1. Type "diwali" (lowercase substring of "Dilli Diwali Mela") into the search box.
2. Observe the listing.
3. Clear the search box and type "Hyderabad" (a substring of World Tech Summit's venue/city).
4. Observe the listing.
**Expected result:** Step 2: listing narrows to "Dilli Diwali Mela" only, confirming case-insensitive
title matching. Step 4: listing narrows to "World Tech Summit" only, confirming venue/city matching.

---

### TC-app-wide-025 — Category filter alone: "Festival" narrows to Dilli Diwali Mela only (directly assertable against fixtures)
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events`.
**Steps:**
1. Select "Festival" from the "All Categories" dropdown.
**Expected result:** Exactly one event card is shown: "Dilli Diwali Mela" (id 285). No other seeded
event has category Festival, so this is directly assertable against known fixture data (not merely
assumed).

---

### TC-app-wide-026 — City filter alone: "Delhi" narrows to Dilli Diwali Mela only (directly assertable against fixtures)
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events`.
**Steps:**
1. Select "Delhi" from the "All Cities" dropdown.
**Expected result:** Exactly one event card is shown: "Dilli Diwali Mela" (id 285). No other seeded
event has city Delhi, so this is directly assertable against known fixture data.

---

### TC-app-wide-027 — Category + City filter combined use AND/intersection semantics
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events`.
**Flagged:** Assumed AND/intersection semantics (both filters narrow the result set together, not
OR/union); never interactively exercised during exploration. Verify live.
**Steps:**
1. Select "Concert" from the "All Categories" dropdown.
2. Additionally select "Delhi" from the "All Cities" dropdown (a city/category combination matching
   zero seeded events — "Hollywood Monsoon Night" is Concert but its city is Los Angeles, not Delhi).
**Expected result:** With both filters active, the listing shows zero results (an empty/no-results
state), confirming AND/intersection semantics — not OR/union (which would incorrectly still show
"Hollywood Monsoon Night" for Concert or "Dilli Diwali Mela" for Delhi).

---

### TC-app-wide-028 — City filter dropdown cannot select "Los Angeles" — likely data/UI bug
**Priority:** P1
**Preconditions:** Tester is logged in and on `/events`, all 3 seeded events visible unfiltered.
**Not expected/known behavior — treat as a likely bug, per the clarifications doc.** A real seeded
event ("Hollywood Monsoon Night — Los Angeles", id 284) has city = Los Angeles, but the City filter
dropdown's 6 fixed options (Mumbai, Bangalore, Delhi, Hyderabad, Chennai, Pune) do not include Los
Angeles.
**Steps:**
1. Open the "All Cities" dropdown and inspect the full option list.
2. Attempt to locate/select "Los Angeles" as an option.
**Expected result:** "Los Angeles" is not present as a selectable option in the City filter dropdown
(only Mumbai, Bangalore, Delhi, Hyderabad, Chennai, Pune, plus "All Cities" are available). This
means "Hollywood Monsoon Night — Los Angeles" can never be isolated via the City filter alone —
document this as a probable data/dropdown-mismatch defect (an event exists with a city value the
filter UI can never select), not as intended behavior, and flag for human/product-owner follow-up.

---

### TC-app-wide-029 — "Clear all bookings" empties the My Bookings list for that account only
**Priority:** P2
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Same non-execution
stance as "Confirm Booking" in the `event-booking` suite (clarifications doc, item 9). This is a
destructive bulk action; do not automate it as a live click.
**Preconditions:** Tester is logged in as an account with at least one existing booking (not
currently true for `admin-user@example.com`, which has zero bookings at doc time — this
precondition itself depends on the `event-booking` suite's own unexecuted "Confirm Booking" flow).
**Flagged:** Assumed effect; never exercised live.
**Steps:**
1. Navigate to `/bookings` with at least one existing booking visible.
2. Click "Clear all bookings".
3. Confirm any resulting confirmation dialog, if present.
**Expected result (assumed, unverified):** The My Bookings list for this account is emptied, showing
the "No bookings yet" empty state. Only this account's bookings are affected (not verified — assumed
scoped to the authenticated account).

---

### TC-app-wide-030 — My Bookings empty state exact copy verification
**Priority:** P2
**Preconditions:** Tester is logged in as `admin-user@example.com` (zero existing bookings).
**Directly observed, not an assumption.** Exact copy captured during exploration
(`pages/my-bookings/dom-snapshot.md`).
**Steps:**
1. Navigate to `/bookings`.
2. Read the empty-state text verbatim.
**Expected result:** Text reads exactly "No bookings yet — You haven't booked any events yet. Browse
upcoming events and grab your tickets!" with a "Browse Events" button below it, linking to `/events`.

---

### TC-app-wide-031 — Admin "+ New Event" form — Price field validation
**Priority:** P2
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Any submission of the
"+ New Event" form (positive or negative test data) is out of scope for live execution this run per
the clarifications doc's explicit statement that "no such live event creation is authorized in this
run either," even for narrow field-level validation checks (see clarifications doc "Open questions").
**Preconditions:** Tester is logged in as `admin-user@example.com` and on `/admin/events`, with
Title/Category/City/Venue/Event Date & Time/Total Seats filled validly.
**Flagged:** Assumed — requires a positive number (> 0); no confirmed error copy. Never exercised
live.
**Steps:**
1. Fill Price with "0" or a negative value, e.g. "-10".
2. Click "+ Add Event".
**Expected result (assumed, unverified):** Submission is blocked with a validation error on the Price
field (e.g. "Price must be greater than 0"). No event is created.

---

### TC-app-wide-032 — Admin "+ New Event" form — Total Seats field validation
**Priority:** P2
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Same reason as
TC-app-wide-031.
**Preconditions:** Tester is logged in as `admin-user@example.com` and on `/admin/events`, with all
other required fields filled validly.
**Flagged:** Assumed — requires a positive integer; no confirmed error copy. Never exercised live.
**Steps:**
1. Fill Total Seats with "0", a negative value, or a non-integer (e.g. "10.5").
2. Click "+ Add Event".
**Expected result (assumed, unverified):** Submission is blocked with a validation error on the Total
Seats field. No event is created.

---

### TC-app-wide-033 — Admin "+ New Event" form — Event Date & Time field, past-date input
**Priority:** P2
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Same reason as
TC-app-wide-031.
**Preconditions:** Tester is logged in as `admin-user@example.com` and on `/admin/events`, with all
other required fields filled validly.
**Flagged:** No past-date restriction confirmed; assumed none is enforced. Never exercised live.
**Steps:**
1. Fill Event Date & Time with a date in the past (e.g. one year ago).
2. Click "+ Add Event".
**Expected result (assumed, unverified):** No past-date restriction is enforced — submission is not
blocked on this basis alone (the field accepts a past date, consistent with no confirmed restriction
being observed in exploration).

---

### TC-app-wide-034 — Admin "+ New Event" form — Image URL field, optional/free-text behavior
**Priority:** P2
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Same reason as
TC-app-wide-031.
**Preconditions:** Tester is logged in as `admin-user@example.com` and on `/admin/events`, with all
required fields filled validly.
**Flagged:** Assumed optional free text with no confirmed URL-format enforcement. Never exercised
live.
**Steps:**
1. Leave Image URL empty and submit with all other required fields valid.
2. (Separately) fill Image URL with a non-URL string, e.g. "not-a-url", and submit.
**Expected result (assumed, unverified):** Both sub-cases are accepted at the Image URL field level
(field is optional, no confirmed format enforcement) — any blocking of the overall submission would
come only from other required fields, not from Image URL's own validation.

---

### TC-app-wide-035 — Admin "+ New Event" form — required-field validation blocks empty submission
**Priority:** P1
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** Same reason as
TC-app-wide-031.
**Preconditions:** Tester is logged in as `admin-user@example.com` and on `/admin/events`.
**Flagged:** Assumed standard client-side required-field validation; never exercised live.
**Steps:**
1. Leave Title, Category, City, Venue, Event Date & Time, Price, and Total Seats all empty
   (Description and Image URL are optional and may remain empty).
2. Click "+ Add Event".
**Expected result (assumed, unverified):** Submission is blocked. Required-field validation errors
are shown for each of Title, Category, City, Venue, Event Date & Time, Price, and Total Seats (the
fields marked `*` on the form). No event is created.

---

### TC-app-wide-036 — Admin account at exactly 6 events: adding a 6th event succeeds, no eviction (at-limit boundary)
**Priority:** P1
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only, per orchestrator
override.** The run-config for this run explicitly requested this flow be executed live (create
events up to and past the 6-event limit, then clean up). **The orchestrator did not authorize that
live execution** — per `docs/conventions.md`'s "Orchestrator & run-config contract" and
`playwright-automation-agent`'s own no-live-mutation default, which a run-config cannot override.
`playwright-automation-agent` must **not** create or delete real events for this flow regardless of
what any run-config requests. See the clarifications doc's "Orchestrator-level non-execution
override (item 10)" section, recorded verbatim.
**Preconditions:** Admin-capable account (`admin-user@example.com`) has exactly 6 events total (3
seeded + 3 test-created, in an environment/run where such setup is authorized — not this one).
**Confirmed business rule** (per the admin page's own banner text: "You can add up to 6 events. Once
the limit is reached, your oldest event is automatically replaced when you add a new one." —
`artifacts/eventhub/explore/pages/admin/dom-snapshot.md`), but written here as documented-only per
the override above.
**Steps:**
1. With exactly 6 events existing for the account, fill and submit the "+ New Event" form with valid
   data for a 6th... (already at 6; this step models arriving at exactly 6 via the 6th addition).
2. Observe the "All Events" table and event count after submission.
**Expected result (per confirmed banner text, not live-verified):** The 6th event is added normally;
no eviction occurs (eviction is described as triggering only once the limit is already reached and a
new event is added beyond it). "All Events" table shows 6 rows total.

---

### TC-app-wide-037 — Admin account at 6 events: adding a 7th event triggers FIFO eviction of the oldest (over-limit boundary)
**Priority:** P1
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only, per orchestrator
override.** Identical override rationale as TC-app-wide-036: the run-config explicitly requested this
7th-event/FIFO-eviction flow be executed live; the orchestrator refused to authorize it, per the
non-overridable no-live-mutation default. `playwright-automation-agent` must not create or delete
real events for this flow, regardless of run-config content. See the clarifications doc's
"Orchestrator-level non-execution override (item 10)" section, recorded verbatim.
**Preconditions:** Admin-capable account already has exactly 6 events (at the confirmed limit).
**Confirmed business rule** (admin banner text, as above), documented-only per the override.
**Steps:**
1. With exactly 6 events existing, fill and submit the "+ New Event" form with valid data for a 7th
   event.
2. Observe the "All Events" table and event count/composition after submission.
**Expected result (per confirmed banner text, not live-verified):** The oldest of the 6 existing
events is automatically evicted (FIFO, by creation order) to make room for the new 7th event. "All
Events" table still shows exactly 6 rows total (the new event present, the previously-oldest event
gone). The rule's exact tie-breaking behavior and whether the evicted event's existing bookings are
affected are unconfirmed and flagged for human follow-up per the clarifications doc's "Open
questions."

---

### TC-app-wide-038 — Seeded/Featured events show "Read-only" in Admin All Events table with no Edit/Delete controls
**Priority:** P1
**Preconditions:** Tester is logged in as `admin-user@example.com` and on `/admin/events`.
**Directly observed, not an assumption**, at the UI level (`pages/admin/dom-snapshot.md`). Backend
bypass testing (direct API calls attempting to edit/delete these events) is explicitly out of scope
for this suite and left as a candidate for a companion `api-testing-agent` effort — this test case
covers the UI-level check only.
**Steps:**
1. Load `/admin/events` and inspect the "Actions" column for all 3 rows in the "All Events" table
   (Dilli Diwali Mela, Hollywood Monsoon Night — Los Angeles, World Tech Summit).
**Expected result:** All 3 rows show "Read-only" in the Actions column. No Edit or Delete button
renders for any of the 3 seeded/Featured events.

---

### TC-app-wide-039 — Non-admin account attempting to reach `/admin/events` directly is redirected/blocked
**Priority:** P1
**Execution status: DO NOT EXECUTE LIVE — documented-but-not-executed only.** No non-admin account
was ever crawled, and none is registered or available for this run (per this run's non-mutation
stance, no new non-admin account is registered live either — clarifications doc, item 13). This case
is unexecutable this run for lack of a required fixture, distinct from (but held to the same
documented-only standard as) the mutation-avoidance cases above.
**Preconditions:** Would require a non-admin, authenticated EventHub account — not available in this
environment/run.
**Flagged/unconfirmed placeholder case**, per the clarifications doc.
**Steps:**
1. Authenticate as a non-admin account.
2. Navigate directly to `/admin/events` (via URL bar, not via UI nav, since a non-admin account would
   not see the Admin nav item at all).
**Expected result (unverified placeholder):** User is redirected to `/` (or shown a 403), and the
"+ New Event" form / "All Events" table are not rendered. **Do not treat as ground truth; flag for
human follow-up** — a non-admin test account would need to be provisioned out of band before this
case can move from documented-only to executed.

---

*(End of test cases — 39 total: 10 happy path, 6 negative, 23 boundary. 12 of the 39 cases are
flagged "DO NOT EXECUTE LIVE — documented-but-not-executed only": TC-app-wide-002, 017, 020, 029,
031, 032, 033, 034, 035, 036, 037, 039.)*
