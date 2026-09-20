# DOM / Accessibility Snapshot — Events Listing ("/events")

URL: https://eventhub.rahulshettyacademy.com/events
Authenticated as: akashmrakesh+1@gmail.com

Page title: EventHub — Discover & Book Events

## Page content
"Upcoming Events — Find your next unforgettable experience"
Search bar ("Search events, venues...") + "All Categories" filter + "All Cities" filter.

Three real events listed:
1. **Dilli Diwali Mela** (Festival, Featured) — id=?(not directly confirmed, likely 283 by list order but see below) — Tue, 20 Oct — Pragati Maidan Exhibition Grounds, Delhi — $300 — 8912 seats available
2. **Hollywood Monsoon Night — Los Angeles** (Concert, Featured) — id=285 — Sun, 12 Jul — Dome, NSCI SVP Stadium, Worli, Los Angeles — $2,500 — 2959 seats available
3. **World Tech Summit** (Conference, Featured) — id=284 — Sat, 18 Apr — Hyderabad, Hitech city, Hyderabad — $1,500 — 233 seats available

Card order in DOM: ref_11 (/events/285) = Dilli Diwali Mela position visually first but href is /events/285;
ref_13 (/events/284) = second card; ref_15 (/events/283) = third card.
NOTE: visual left-to-right order was Dilli Diwali Mela, Hollywood Monsoon Night, World Tech Summit,
but the href-to-card mapping from read_page listed hrefs in DOM order 285, 284, 283 — treat exact
id-to-title mapping as needing confirmation via the individual event detail page (see event-detail
capture) rather than assumed from visual order alone.

Below the listing: **"+ Add New Event"** button linking to `/admin/events` — confirms this account
(akashmrakesh+1@gmail.com) has **admin/event-management privileges**, not a plain consumer account.

## Interactive elements (read_page, filter=interactive)
- link [ref_1] href="/" (logo)
- link "Home" [ref_2] href="/"
- link "Events" [ref_3] href="/events" (current page)
- link "My Bookings" [ref_4] href="/bookings"
- link "API Docs" [ref_5] href="https://api.eventhub.rahulshettyacademy.com/api/docs" (external, skipped)
- button "Admin" [ref_6] (nav dropdown, not expanded)
- button "Logout" [ref_7] (SKIPPED)
- textbox "Search events, venues…" [ref_8]
- combobox "All Categories" [ref_9] — options: All Categories, Conference, Concert, Sports, Workshop, Festival
- combobox "All Cities" [ref_10] — options: All Cities, Mumbai, Bangalore, Delhi, Hyderabad, Chennai, Pune
- link [ref_11] href="/events/285" (event card, image/wrapper)
- link "Book Now" [ref_12] href="/events/285" — SKIPPED (leads toward booking flow; not clicked here, event detail visited separately read-only)
- link [ref_13] href="/events/284"
- link "Book Now" [ref_14] href="/events/284" — SKIPPED
- link [ref_15] href="/events/283"
- link "Book Now" [ref_16] href="/events/283" — SKIPPED
- link [ref_17] href="/admin/events"
- button "Add New Event" [ref_18] type="button" — SKIPPED (mutating: creates a new event; not clicked, but /admin/events itself was visited read-only, see admin page capture)

## Same-origin links discovered
- /events/285, /events/284, /events/283 (event detail pages — visited one, see event-detail/ capture)
- /admin/events (admin event management — visited, see admin/ capture)
- /bookings, / (already visited)

## Notable API/backend signal
Direct navigation-triggered RSC prefetches for /events/285, /events/284, /events/283 all returned
**HTTP 503** on this page's own network log (see network-requests.json) — worth flagging: server-side
rendering of individual event pages appears intermittently/consistently unstable from the /events
listing context, even though a direct navigation to /events/283 earlier succeeded with 200. This
inconsistency (200 vs 503 for the same route depending on prefetch timing) is useful signal for
api-testing-agent / reliability testing.
