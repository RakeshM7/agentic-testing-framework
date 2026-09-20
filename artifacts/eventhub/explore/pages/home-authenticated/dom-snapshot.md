# DOM / Accessibility Snapshot — Home, Authenticated ("/")

URL: https://eventhub.rahulshettyacademy.com/
Authenticated as: akashmrakesh+1@gmail.com

Page title: EventHub — Discover & Book Events

## Page text (get_page_text, excerpt — first featured event card)
Concert
Featured
Hollywood Monsoon Night — Los Angeles
Sun, 12 Jul
Dome, NSCI SVP Stadium, Worli, Los Angeles
$2,500
2959 seats available
Book Now

(Full page also shows: top nav — Home / Events / My Bookings / API Docs / Admin (dropdown) / user email chip (akashmrakesh+1@...) / Logout; hero "Discover & Book Amazing Events" with "Browse Events" and "My Bookings" CTA buttons; "Featured Events" section listing 3 featured event cards — Festival, Concert, Conference categories visible in the fold.)

## Interactive elements (read_page, filter=interactive)
- link [ref_1] href="/" (logo)
- link "Home" [ref_2] href="/"
- link "Events" [ref_3] href="/events"
- link "My Bookings" [ref_4] href="/bookings"
- link "API Docs" [ref_5] href="https://api.eventhub.rahulshettyacademy.com/api/docs" (EXTERNAL/cross-origin — not followed)
- button "Admin" [ref_6] (dropdown — account has an Admin nav item; not expanded/clicked to avoid triggering mutating admin actions, noted for follow-up read-only inspection)
- button "Logout" [ref_7] (SKIPPED — would end the authenticated session)
- link [ref_8] href="/events" (Browse Events CTA)
- link [ref_9] href="/bookings" (My Bookings CTA, secondary)
- button "My Bookings" [ref_10] type="button"
- link "View all →" [ref_11] href="/events"

## Key finding
The authenticated nav differs from the unauthenticated marketing preview image: real nav is
Home / Events / My Bookings / API Docs / Admin — confirming the account akashmrakesh+1@gmail.com
has an **Admin** role/link (not just a normal user). This is notable for api-testing-agent /
role-based-access-control testing.

## Links discovered on this page
- /events (same-origin, crawled)
- /bookings (same-origin, crawled — this is "My Bookings")
- Admin (button/dropdown, same-origin, not yet expanded)
- https://api.eventhub.rahulshettyacademy.com/api/docs (cross-origin, skipped)
