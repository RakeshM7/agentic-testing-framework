# Crawl log: dashboards module
- Role: module, mode: full-run, authenticated crawl via storage state (account appeared to be owner "Rakesh M", trial plan, 8 days left).
- Pages/states captured: 12 (see sitemap.json). Flows: 7.
## Incidents
- The Playwright browser appeared shared with other concurrent explorers: tabs were opened/closed externally and my tab was repeatedly navigated to Contacts/Deals/Accounts. Several early captures were retaken. Network/console captures are shared copies of one capture (pages/sales-essentials-dashboard) and contain some unrelated traffic.
- UNINTENDED SIDE EFFECT: a mis-targeted click (first button on page) hit "Request demo", opening a Freshchat conversation that auto-created Freshdesk ticket https://support.freshdesk.com/a/tickets/21095814. Cannot be removed by me; human may close it.
## Created entities
- Dashboard tab "Sales Trends" (tab 18846), created and removed in-run. See created-entities.json.
## Feature-mapping caveats
- Discovery described the landing as Activities Dashboard (tab 353503) with Export/Edit disabled. Actually tab 353503 is Sales Essentials Dashboard (Export/Edit enabled); Activities Dashboard is ?tab=activities and is a native widget page (no Export/Edit); Sales Dashboard is tab 81767. All three dashboard tabs render inside an iframe served from freshworkscrm-ind.freshreports.com. Page title is always "Activities Dashboard : Freshsales".
## Coverage gaps
- Not exercised: Sales Essentials pages Contacts, Sales activities, Revenue breakdown; Rename/Delete of pages; favourite star; Export Email Now/Download; Add task/Add meeting; Today due-date filter and All/Open/Overdue/Completed pills; Quick Links, Freddy AI insights, Today's summary details; other Popular reports; filter panel +filter/+date range; widget-level menus; Configure widgets Save.
- sales-dashboard screenshot/snapshot were retaken once; per-page network/console files are shared copies.
