# DOM / Accessibility Snapshot — Admin: Manage Events ("/admin/events")

URL: https://eventhub.rahulshettyacademy.com/admin/events
Authenticated as: akashmrakesh+1@gmail.com (confirmed admin/event-manager role)

Page title: EventHub — Discover & Book Events

## Page content

### "+ New Event" form (top of page)
Banner: "You can add up to **6 events**. Once the limit is reached, your oldest event is
automatically replaced when you add a new one." (useful for negative/boundary testing — a
built-in FIFO eviction policy at 6 events.)

Fields:
- Title* (text)
- Description (textarea, optional)
- Category* (select: Conference, Concert, Sports, Workshop, Festival)
- City* (text, placeholder "e.g. Bangalore")
- Venue* (text, placeholder "Venue name & address")
- Event Date & Time* (datetime-local input)
- Price ($)* (number, placeholder "0.00")
- Total Seats* (number, placeholder "e.g. 500")
- Image URL (optional, url input)
- **"+ Add Event"** button (type=submit) — **SKIPPED, mutating action (creates a new event); not
  clicked per read-only mandate.**

### "All Events" table (below the form)
3 total events, matching the public /events listing exactly:
| Title | Category | City | Date | Price | Seats | Actions |
|---|---|---|---|---|---|---|
| Dilli Diwali Mela (Featured) | Festival | Delhi | 20 Oct 2026 | $300 | 8912/10000 | Read-only |
| Hollywood Monsoon Night — Los Angeles (Featured) | Concert | Los Angeles | 12 Jul 2026 | $2,500 | 2959/3000 | Read-only |
| World Tech Summit (Featured) | Conference | Hyderabad | 18 Apr 2026 | $1,500 | 233/500 | Read-only |

**Actions column says "Read-only" for all 3 rows** — these 3 seeded/featured events cannot be
edited or deleted via this admin UI (no edit/delete buttons rendered for them), which explains why
the earlier "This is a featured event — always available for practice" banner appears on the
event-detail page: they are protected fixtures. Any *newly added* event (via "+ Add Event") would
presumably get real edit/delete actions and be subject to the 6-event FIFO eviction — not verified,
since no event was created.

## Event id-to-title mapping (cross-referenced with /events listing hrefs)
Given the table row order matches the /events page's href order (285, 284, 283):
- **id 285 = Dilli Diwali Mela** (confirmed directly via /events/285 page visit)
- **id 284 = Hollywood Monsoon Night — Los Angeles** (inferred by matching order; this is also the
  event whose RSC prefetch returned intermittent 503s in earlier captures)
- **id 283 = World Tech Summit** (inferred by matching order)

## Interactive elements (read_page, filter=interactive)
- link [ref_1] href="/" (logo)
- link "Home" [ref_2] href="/"
- link "Events" [ref_3] href="/events"
- link "My Bookings" [ref_4] href="/bookings"
- link "API Docs" [ref_5] href="https://api.eventhub.rahulshettyacademy.com/api/docs" (external)
- button "Admin" [ref_6] (nav dropdown)
- button "Logout" [ref_7] — SKIPPED
- (Title/Description/Category/City/Venue text fields also present but not separately ref'd in this
  interactive-only pass beyond the ones below — form is otherwise standard text inputs)
- textbox "Event Date & Time" [ref_8] type="datetime-local" — not filled
- textbox "0.00" [ref_9] type="number" (Price) — not filled
- textbox "e.g. 500" [ref_10] type="number" (Total Seats) — not filled
- textbox "https://…" [ref_11] type="url" (Image URL) — not filled
- button "+ Add Event" [ref_12] type="submit" — **SKIPPED, mutating**
- footer links (Selenium/Playwright/RestAssured/Cypress/Appium courses, techsmarthire.com,
  Browse Events, My Bookings, Manage Events (self), API Documentation, rahulshettyacademy.com) —
  all previously catalogued on other pages, external or already-visited same-origin links.

## Notable for api-testing-agent
- This confirms a real **admin role** exists in the app (`akashmrakesh+1@gmail.com`), distinct from
  a plain consumer account, with its own event-management surface at `/admin/events`.
- Likely backing REST endpoints (not directly observed, since "+ Add Event" was not submitted):
  something like `POST /api/events` (create), and probably `PUT`/`DELETE /api/events/:id` for
  non-featured events — worth probing via the Swagger docs at
  `https://api.eventhub.rahulshettyacademy.com/api/docs` and testing the "6 events, oldest evicted"
  business rule as a dedicated test case.
- The 3 seeded events are explicitly protected ("Read-only" in admin, "always available for
  practice" banner on detail page) — good baseline fixtures for repeatable tests; any 4th+ event an
  agent creates is expected to be deletable/editable and may evict the oldest once you exceed 6.
