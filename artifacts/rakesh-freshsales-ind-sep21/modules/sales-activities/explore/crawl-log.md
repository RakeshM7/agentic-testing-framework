# Crawl log: sales-activities (role: module)
- mode: full-run; authenticated crawl via sessionStateFile (Rakesh M, ORGANIZATION ADMIN)
- pages/overlays captured: 13 (see sitemap.json); maxPages 40 / maxDepth 4 not reached.
- Created and deleted (all in created-entities.json): custom activity type "ZZ Explore Activity" (renamed, then deleted), task "ZZ Explore Task", activity goal.
- Not touched: pre-existing "AgentTest Task ..." and its deal.
- Capture limitation: no network-requests.json / console-log.txt per page (browser_network_requests and console capture were not saved per page; console showed 3 errors and Appcues expiry warnings on every page). dom-snapshot.md exists for most pages; refs are session-scoped.

## Feature-mapping caveats
- Discovery listed no subPages; module actually spans: settings/sales-activity-type, settings/sales_activities/forms (custom fields), field-dependency-configurations, Activities Dashboard tab (the only task/meeting list), and /crm/sales/activity-goals (goals, not in discovery).
- No standalone Tasks/Meetings/Calls list page exists. Call logs and SMS lists are not browsable here; Send SMS has no provider ("No provider connected").
- Task due-date default is tomorrow.

## Coverage gaps
- Meeting, call log, custom activity saves not executed (no owned related record; meeting invites). Only validation observed.
- Task/meeting/call detail from record pages (contact/account/deal Activity tabs) not explored (other modules).
- Add field save, field dependency create, Preview, Configure widgets, Quick Links, calendar integrations (Google/Office 365/Zoom/Teams), Edit goal/Clone goal, Filters on goals, Add outcome/Snooze for tasks, edit Task activity-type save not exercised.
