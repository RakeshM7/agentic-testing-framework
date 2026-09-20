# DOM / Accessibility Snapshot — Home ("/")

URL requested: https://eventhub.rahulshettyacademy.com/
Final rendered URL: https://eventhub.rahulshettyacademy.com/login
(The root route performs a client-side redirect to /login for unauthenticated visitors — this is the app's login wall. Rendered content is therefore identical to the /login page.)

Page title: EventHub — Discover & Book Events

## Page text (get_page_text)
RSA
RAHUL SHETTY ACADEMY
eventhub.app
⚡ Live REST APIs — test real endpoints, not mocks
🔒 Isolated sandbox — your data, your tests, no conflicts
🎫 Auth, CRUD, bookings — flows you'll face on the job
🤖 Built for Selenium, Playwright, RestAssured & more

50,000+
QA engineers trained worldwide

The #1 QA Practice Hub for Automation Engineers
EventHub is a production-grade practice app designed so you can sharpen your testing skills on real-world scenarios — before your next interview or project.

API Documentation (Swagger)

Sign in to EventHub
Enter your credentials to continue
Email
Password
Sign In
Don't have an account? Register

A practice environment by RahulShettyAcademy.com — used by QA engineers worldwide to master automation testing.

Note: the purple panel on the left contains a static marketing screenshot (app-preview.png) showing what the logged-in app looks like (nav: Home / Events / My Bookings / API Docs / Admin) — this is a static image asset, not live/navigable DOM.

## Interactive elements (read_page, filter=interactive)
- link "API Documentation (Swagger)" href="https://api.eventhub.rahulshettyacademy.com/api/docs" (EXTERNAL/cross-origin — not followed)
- textbox "you@email.com" type=email placeholder="you@email.com"
- textbox "••••••" type=password placeholder="••••••"
- button "Sign In" type=submit  -- SKIPPED (mutating/auth action, not clicked)
- link "Register" href="/register"
- link "RahulShettyAcademy.com" href="https://rahulshettyacademy.com" (EXTERNAL — not followed)

## Links discovered on this page
- /register (same-origin, crawled)
- /login (same-origin, self — the redirect target)
- https://api.eventhub.rahulshettyacademy.com/api/docs (cross-origin, skipped — different subdomain/origin)
- https://rahulshettyacademy.com (external, skipped)
