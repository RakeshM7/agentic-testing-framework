# DOM / Accessibility Snapshot — Login ("/login")

URL: https://eventhub.rahulshettyacademy.com/login
Page title: EventHub — Discover & Book Events

Content is identical to the home page ("/"), since "/" client-side-redirects to "/login" for unauthenticated visitors. See pages/home/dom-snapshot.md for the full page text and interactive-element listing.

This page was also confirmed to be the landing point for every other unauthenticated/unknown route probed during this crawl:
- /events -> redirects to /login
- /dashboard -> underlying request 404s, app falls back/redirects to /login
- /bookings -> underlying request 200s (route exists) but client-side auth guard redirects to /login
- /admin -> underlying request 404s, app falls back/redirects to /login

## Interactive elements
- textbox "you@email.com" type=email
- textbox "••••••" type=password
- button "Sign In" type=submit  -- SKIPPED (mutating/auth action, not clicked; no credentials were guessed or injected per read-only mandate)
- link "Register" href="/register"
- link "API Documentation (Swagger)" href="https://api.eventhub.rahulshettyacademy.com/api/docs" (cross-origin — not followed)
- link "RahulShettyAcademy.com" href="https://rahulshettyacademy.com" (external — not followed)

## Login wall
This is a hard login wall: no event listing, event detail, dashboard, bookings, or admin content is reachable without authenticating. Per crawl-agent rules, no login was attempted with guessed/injected credentials. Crawl of authenticated app areas stops here.
