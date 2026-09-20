# DOM / Accessibility Snapshot — My Bookings ("/bookings")

URL: https://eventhub.rahulshettyacademy.com/bookings
Authenticated as: akashmrakesh+1@gmail.com

Page title: EventHub — Discover & Book Events

## Page text (get_page_text)
"My Bookings — View and manage all your ticket bookings"
"Clear all bookings — Do this often for clean test data." (destructive utility link, provided by
the app itself as a "reset your test data" convenience — NOT CLICKED per read-only mandate)
Empty state: "No bookings yet — You haven't booked any events yet. Browse upcoming events and grab
your tickets!" — "Browse Events" button.

This account (akashmrakesh+1@gmail.com) has zero existing bookings.

Footer (site-wide, visible because page content is short): Rahul Shetty Academy blurb, "Popular
Courses" links (Selenium WebDriver with Java, Playwright with JavaScript, RestAssured API Testing,
Cypress End-to-End Testing, Appium Mobile Testing — all external, rahulshettyacademy.com), "QA Job
Hiring Platform" (techsmarthire.com, external), "EventHub Practice App" column with internal links:
Browse Events (/events), My Bookings (/bookings), **Manage Events (/admin/events)**, API
Documentation (external Swagger).

## Interactive elements (read_page, filter=interactive)
- link [ref_1] href="/" (logo)
- link "Home" [ref_2] href="/"
- link "Events" [ref_3] href="/events"
- link "My Bookings" [ref_4] href="/bookings" (current)
- link "API Docs" [ref_5] href="https://api.eventhub.rahulshettyacademy.com/api/docs" (external)
- button "Admin" [ref_6]
- button "Logout" [ref_7] — SKIPPED
- button "Clear all bookings" [ref_8] — **SKIPPED, destructive/mutating action explicitly excluded by task mandate**
- link [ref_9] href="/events"
- button "Browse Events" [ref_10] type="button"
- link "Selenium WebDriver with Java" [ref_11] href="https://rahulshettyacademy.com" (external)
- link "Playwright with JavaScript" [ref_12] href="https://rahulshettyacademy.com" (external)
- link "RestAssured API Testing" [ref_13] href="https://rahulshettyacademy.com" (external)
- link "Cypress End-to-End Testing" [ref_14] href="https://rahulshettyacademy.com" (external)
- link "Appium Mobile Testing" [ref_15] href="https://rahulshettyacademy.com" (external)
- link "techsmarthire.com →" [ref_16] href="https://techsmarthire.com" (external)
- link "Browse Events" [ref_17] href="/events" (footer)
- link "My Bookings" [ref_18] href="/bookings" (footer, self)
- link "Manage Events" [ref_19] href="/admin/events" (footer — same admin route discovered on /events page)
- link "API Documentation" [ref_20] href="https://api.eventhub.rahulshettyacademy.com/api/docs" (external, footer)

## Notable
No booking data exists for this account, so the bookings list UI (cards, cancel button, etc.)
could not be observed in its populated state. The "Clear all bookings" button confirms a
corresponding mutating DELETE-style API almost certainly exists (e.g.
`DELETE /api/bookings` or similar on api.eventhub.rahulshettyacademy.com) — useful lead for
api-testing-agent, but not exercised here per the read-only/no-mutation mandate.
