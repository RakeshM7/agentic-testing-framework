# Crawl log (role: discover)
- mode: full-run (nothing created; created-entities.json is [])
- Authenticated crawl via sessionStateFile playwright-tests/freshsales/.auth/freshsales-handoff.json; session was valid. Role: ORGANIZATION ADMIN (Rakesh M).
- No login wall hit. No passwords typed.
- Visited: / (Admin Center), /crm/sales/{my_dashboards,contacts,accounts,deals,conversations/awaiting_response,analytics,settings}; opened all 7 Admin Settings groups; opened + menu and profile menu (no items activated); probed ~21 URLs for existence (title/redirect only).
- Captures: pages/<slug>/{screenshot.png,dom-snapshot.md} for the 7 landing pages. network-requests.json, console-log.txt and interactions.json were NOT captured (discover role, landing-level only; console showed 3 errors on each CRM page, not investigated). The Admin Center page has no screenshot (capture mistake, removed).
- Skipped: "Connect your mailbox" (third-party OAuth), Plans & Billing, Move Account, Request demo.
- Note: group links were enumerated via DOM scripts and URL probing rather than clicking each link; edges in navigation-graph.json are only the clicks/navigations to landing pages.

## Feature-mapping caveats
- Workflows (documented) is not reachable: Page Not Found. Marketing Lists: 403. Tasks/Appointments: no standalone page. Quotas and Forecasting: direct navigation errored.

## Coverage gaps
Sub-pages of every settings group, record detail pages, contacts "14 more" views, Phone, global search, What's new and notifications panels were not opened.
