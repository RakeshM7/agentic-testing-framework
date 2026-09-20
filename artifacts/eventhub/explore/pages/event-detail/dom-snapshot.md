# DOM / Accessibility Snapshot — Event Detail ("/events/285")

URL: https://eventhub.rahulshettyacademy.com/events/285
Authenticated as: akashmrakesh+1@gmail.com

Page title: EventHub — Discover & Book Events

## Key finding: id-to-title mapping
Event id **285** = **"Dilli Diwali Mela"** (NOT Hollywood Monsoon Night as the /events listing's
visual card order might have suggested — confirms the earlier note in events/dom-snapshot.md that
href-order and visual-order didn't match and needed verification via the detail page itself).

## Page text (get_page_text)
Breadcrumb: Events / Dilli Diwali Mela
Badges: Festival, Featured
Title: Dilli Diwali Mela
Banner: "This is a featured event — always available for practice"
DATE: Tuesday, 20 October
TIME: 10:30 pm
VENUE: Pragati Maidan Exhibition Grounds
CITY: Delhi
AVAILABLE: 8912 / 10000 seats
PRICE PER TICKET: $300
About this event: "Celebrate the Festival of Lights at the grandest Diwali Mela in North India.
Enjoy 200+ stalls of artisanal crafts, street food, folk performances, fireworks, and cultural
showcases spanning three vibrant evenings."

### Booking widget (right rail)
Book Tickets — $300 per ticket
Tickets: stepper, default 1, max 10 (− / + buttons)
Full Name* (text input, empty)
Email* (email input, empty)
Phone Number* (tel input, placeholder "+91 98765 43210")
Order summary: "$300 × 1 ticket = $300", Total $300
**Confirm Booking** button (type=submit) — **NOT CLICKED**. Per task instructions this is the
final-submit step of the booking flow; stopped short of it. Observed: booking requires Full Name,
Email, Phone Number (all marked required with *), ticket quantity 1-10, and clicking Confirm
Booking would presumably POST to create a booking (likely `api.eventhub.rahulshettyacademy.com/api/bookings`
or similar, per the Swagger docs at /api/docs — not confirmed since not submitted).

## Interactive elements (read_page, filter=interactive)
- link [ref_1] href="/" (logo)
- link "Home" [ref_2] href="/"
- link "Events" [ref_3] href="/events"
- link "My Bookings" [ref_4] href="/bookings"
- link "API Docs" [ref_5] href="https://api.eventhub.rahulshettyacademy.com/api/docs" (external, skipped)
- button "Admin" [ref_6]
- button "Logout" [ref_7] — SKIPPED
- link "Events" [ref_8] href="/events" (breadcrumb)
- button "−" [ref_9] (ticket qty decrement) — not interacted, read-only
- button "+" [ref_10] (ticket qty increment) — not interacted, read-only
- textbox "Your full name" [ref_11] — not filled
- textbox "you@email.com" [ref_12] type=email — not filled
- textbox "+91 98765 43210" [ref_13] type=tel — not filled
- button "Confirm Booking" [ref_14] type="submit" — **SKIPPED, mutating final-submit action per task mandate**

## Notable technical finding
No client-side XHR/fetch call to `api.eventhub.rahulshettyacademy.com` was observed loading this
event detail page — event data appears to be delivered via Next.js server-side rendering / RSC
payload (the `?_rsc=...` document requests seen in network logs), not a separate client-visible
REST call. This contrasts with the public `/api/config` call seen on first page load. Useful for
api-testing-agent: to discover a live REST endpoint for event details, check the Swagger docs at
`https://api.eventhub.rahulshettyacademy.com/api/docs` directly rather than relying on browser
network capture of this Next.js frontend, since much of the data-fetching happens server-side.
