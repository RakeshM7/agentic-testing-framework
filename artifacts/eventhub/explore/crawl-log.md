# Crawl Log — eventhub.rahulshettyacademy.com

Target: https://eventhub.rahulshettyacademy.com
maxPages: 15, maxDepth: 2
Artifact root: /Users/rakeshmanoharan/Github/agentic-testing-framework/artifacts/eventhub/explore/

## Pages visited (fully snapshotted)
1. `/` (home) — 200, client-side redirects to `/login`. Screenshot, DOM/text snapshot, network requests, console log captured. This IS the app's login wall — the root route renders no public content of its own beyond the auth form and a static marketing preview image (app-preview.png) showing what the logged-in nav looks like (Home / Events / My Bookings / API Docs / Admin — this is a flat image asset, not live DOM, so it was not "clicked into").
2. `/login` — 200. Sign-in form (email, password, Sign In button). Screenshot, DOM/text snapshot, network requests, console log captured. Sign In button was NOT clicked (would be a state-mutating auth action / requires credentials we don't have and are not permitted to guess).
3. `/register` — 200. Signup form (email, password w/ policy hints, confirm password, Create Account button). Screenshot, DOM/text snapshot, network requests, console log captured. Create Account button was NOT clicked (mutating account-creation action).

## Pages discovered but skipped
- `/events` (event listing) — reason: **login wall**. Route resolves (200 doc + JS chunk load) but the app's client-side auth guard immediately redirects to `/login`. No event-listing content is reachable unauthenticated.
- `/dashboard` — reason: **login wall / not found**. Underlying request returns 404; app falls back to `/login`.
- `/bookings` — reason: **login wall**. Underlying request returns 200 (route exists) but client-side auth guard redirects to `/login`.
- `/admin` — reason: **login wall / not found**. Underlying request returns 404; app falls back to `/login`.
- Event detail pages — reason: **unreachable**. No event listing was ever rendered (blocked by login wall above), so no event-detail links could be discovered to crawl.
- `Sign In` button (on /login) — reason: **skipped, mutating/auth action**. Not clicked per read-only mandate; no credentials guessed or injected.
- `Create Account` button (on /register) — reason: **skipped, mutating action**. Not clicked/submitted per read-only mandate.
- `API Documentation (Swagger)` link → `https://api.eventhub.rahulshettyacademy.com/api/docs` — reason: **cross-origin, not same-origin**. Different subdomain (api.eventhub… vs eventhub…), so not followed per same-origin rule. Noted as the app's backend API host for downstream api-testing-agent.
- `https://rahulshettyacademy.com` (logo/footer link) — reason: **external domain**, skipped.
- `https://techsmarthire.com` (register-page marketing link) — reason: **external domain**, skipped.

## Errors encountered
None. All same-origin document requests returned 200 or a handled 404 (for `/dashboard`, `/admin`) that the SPA gracefully redirected to `/login`. No console errors or warnings were observed on any visited page (checked with read_console_messages, pattern ".*", on each page).

## Login wall
**Hit immediately at the root route.** EventHub is entirely gated behind authentication: the only content reachable without signing in is the marketing/login page (`/`, `/login`) and the signup page (`/register`). Every application route that would contain real product content — event listing, event details, bookings/cart, dashboard, admin — redirects unauthenticated visitors back to `/login`. Per the read-only/no-guessed-credentials rule, the crawl stopped here and did not attempt to authenticate.

## Summary
- Pages crawled (full snapshot): 3 (`/`, `/login`, `/register`)
- Pages discovered but skipped: 5 distinct same-origin routes (`/events`, `/dashboard`, `/bookings`, `/admin`, plus the two mutating form-submit buttons) + 3 external/cross-origin links skipped
- Max depth reached: 1 (all discoverable same-origin links are one hop from home; deeper app routes exist but are behind the login wall and were not entered)
- Login walls hit: 1 (app-wide, at root)
- Errors: none
- Useful signal for api-testing-agent: backend API host is `https://api.eventhub.rahulshettyacademy.com` (Swagger docs at `/api/docs`); a public, unauthenticated `GET /api/config` call was observed firing on every page load.

## Authenticated crawl extension (2026-09-20)

**Context:** explore-agent's default persona is READ-ONLY and never logs in with guessed or supplied credentials. For this specific run, the human user of the session **explicitly provided real credentials for this exact public training/demo site and explicitly authorized, as a deliberate one-off exception, using them to log in** — EventHub is a known QA-practice application published by Rahul Shetty Academy, not a real production service, and the authorization was scoped to this site only. No credentials were guessed, generated, or reused from any other source.

**Attempt:** Navigated to `/login`, entered the supplied email (`akashmrakesh@gmail.com`) and password, and clicked **Sign In** exactly once.

**Result: LOGIN FAILED.**
- UI showed a toast error: **"Invalid email or password"**.
- Underlying network call: `POST https://api.eventhub.rahulshettyacademy.com/api/auth/login` → **HTTP 400**.
- Per the task's explicit stop condition, the crawl **halted immediately** on this failure. No registration was attempted, no credential variations were guessed, and no further authenticated pages were crawled.

**Evidence captured:**
- `login-attempt-failed/screenshot.jpg` — screenshot showing the "Invalid email or password" toast on `/login`.
- `login-attempt-failed/network-request.json` — the failing `POST /api/auth/login` (400) request record.

**Pages added to sitemap.json:** none — no authenticated page was ever reached, so there is nothing new to add beyond the unauthenticated `/`, `/login`, `/register` pages already on record.

**Mutating actions skipped:** N/A this run beyond the single authorized Sign In attempt itself — no booking/purchase, payment, delete/cancel, or account-settings actions were attempted (none were reachable, since authentication did not succeed).

**Errors encountered:** 1 — authentication failure (`400 Invalid email or password`) on the one authorized login attempt. This may mean the account does not exist on this instance of the practice app, the password shown to the agent doesn't match what's registered, or the demo backend resets/rotates seeded accounts periodically. Recommend the user verify the credentials directly (e.g. by logging in manually in a browser, or via the `/register` flow if a fresh account is intended) before re-running this extension.

## Authenticated crawl — retry with alternate email (2026-09-20)

**Context:** Same one-off, site-scoped exception as the prior authenticated extension above. The
human user supplied a **different** email this time (`akashmrakesh+1@gmail.com`, same password) to
retry after the earlier `akashmrakesh@gmail.com` attempt failed with `400 Invalid email or
password`. No credentials were guessed — both emails were explicitly supplied by the human user.

**Attempt:** Navigated to `/login`, entered `akashmrakesh+1@gmail.com` + the supplied password,
clicked **Sign In** once.

**Result: LOGIN SUCCEEDED.** Redirected to `/` with an authenticated session (email chip
`akashmrakesh+1@...` and a **Logout** button visible in the nav). No `400`/error response this
time.

**Key discovery — this account has admin privileges.** The authenticated nav is
Home / Events / My Bookings / API Docs / **Admin** (dropdown) / Logout — not just a plain consumer
menu. `/admin/events` (Manage Events) is reachable and renders a "+ New Event" creation form plus
an "All Events" management table for this account. This is a materially different, more powerful
role than a typical booking-only user and is useful context for role-based-access-control testing.

### Pages crawled (full snapshot) this run
1. **`/` (home, authenticated)** → `pages/home-authenticated/` — Featured Events section with 3
   real events; nav confirms admin role.
2. **`/events`** → `pages/events/` — Upcoming Events listing. 3 seeded events: Dilli Diwali Mela
   (id 285), Hollywood Monsoon Night — Los Angeles (id 284), World Tech Summit (id 283). Search +
   Category + City filters. "Add New Event" admin affordance visible.
3. **`/events/285`** → `pages/event-detail/` — Event detail for "Dilli Diwali Mela" ($300, Delhi,
   Festival, 8912/10000 seats). Full booking widget observed (ticket stepper, Full Name/Email/Phone
   fields, order total, Confirm Booking button) — **Confirm Booking was NOT clicked** (final-submit
   step, excluded per task mandate).
4. **`/bookings` ("My Bookings")** → `pages/my-bookings/` — Empty state, "No bookings yet" (this
   account has made zero bookings). A "Clear all bookings" destructive convenience link is present
   — **NOT clicked** (destructive/mutating, excluded per task mandate).
5. **`/admin/events` ("Manage Events")** → `pages/admin/` — Admin-only event creation form (Title,
   Description, Category, City, Venue, Date/Time, Price, Total Seats, Image URL) with a stated
   business rule: **max 6 events; adding a 7th auto-evicts the oldest**. "All Events" table lists
   the same 3 seeded events, each marked **Read-only** in Actions (cannot be edited/deleted via
   this UI — protected fixtures). **"+ Add Event" was NOT clicked/submitted** (mutating, excluded
   per task mandate).

### Pages checked but not added (no new content)
- **`/dashboard`** — returns a real **404** ("This page could not be found") even when
  authenticated as this admin-capable account. No separate dashboard route exists in this app;
  not added to sitemap.json.

### Mutating actions explicitly skipped (per task's read-only mandate)
- "Confirm Booking" on `/events/285` — would create a real booking.
- "Clear all bookings" on `/bookings` — destructive, wipes booking data.
- "+ Add Event" on `/admin/events` — would create a new event record.
- "Logout" — not clicked anywhere, to keep the session alive for the full crawl.
- The "Admin" nav dropdown was clicked into only insofar as it exposed the `/admin/events` link
  (navigated there directly); no other admin actions were explored beyond that one page.

### Errors / anomalies encountered
- **Intermittent 503s on `/events/:id` RSC prefetches.** From the home-authenticated page, prefetch
  of `/events/284` returned 503 while `/events/283` and `/events/285` returned 200. From the
  `/events` listing page itself, prefetches of **all three** ids (285, 284, 283) returned 503,
  while a *direct* navigation to `/events/285` (used for the event-detail capture) succeeded with
  200. This looks like flaky/rate-limited server-side rendering on the event-detail route rather
  than a hard failure — flagged for api-testing-agent as a reliability/negative-test candidate.
- No console errors/warnings observed on any of the 5 newly captured pages (checked via
  `read_console_messages`, pattern `.*`, on each page).

### Useful signal for api-testing-agent
- Confirmed real event IDs: **283** (World Tech Summit), **284** (Hollywood Monsoon Night — Los
  Angeles), **285** (Dilli Diwali Mela). All three are seeded/"Featured" and explicitly
  non-deletable ("Read-only" in the admin table; "always available for practice" banner on the
  detail page) — safe, stable fixtures to script tests against.
- This app's frontend does almost all data-fetching via Next.js **server-side rendering / RSC**
  (`?_rsc=...` document requests), not client-visible `fetch`/XHR calls to
  `api.eventhub.rahulshettyacademy.com`. Only the earlier-discovered `GET /api/config` was ever
  seen as a direct client-side call to that API host. To find the actual REST surface (booking
  creation, event CRUD, "clear all bookings", auth), consult the Swagger docs directly at
  `https://api.eventhub.rahulshettyacademy.com/api/docs` rather than relying on browser network
  capture of this frontend.
- Business rules worth turning into test cases: (a) admin "add event" 6-event cap with FIFO
  eviction of the oldest event; (b) seeded/featured events are protected from edit/delete; (c) a
  "Clear all bookings" bulk-delete exists for the authenticated user's own bookings.
- Role signal: `akashmrakesh+1@gmail.com` is an **admin-capable** account (sees Admin nav item,
  can reach `/admin/events`). Worth testing whether a non-admin registered account can access
  `/admin/events` directly (expect a redirect/403) as a follow-up authz check.

### Summary (this run)
- Pages crawled (full snapshot): 5 new (`home-authenticated`, `events`, `event-detail` [id 285],
  `my-bookings`, `admin`)
- Pages checked, no new content: 1 (`/dashboard` — 404, not added to sitemap)
- Mutating actions skipped: 3 explicit skips (Confirm Booking, Clear all bookings, Add Event) +
  Logout avoided throughout
- Login walls hit: 0 (this run — login itself succeeded on the first attempt with the new email)
- Errors: 0 hard errors; 1 anomaly flagged (intermittent 503 on event-detail RSC prefetches)
