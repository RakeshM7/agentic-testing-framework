# Deals module explore
mode: full-run. Authenticated crawl via sessionStateFile; account appeared to be Rakesh M (Organization admin).
Pages/surfaces visited: 6 (pipeline, table, forecast, add-deal slide-over, deal detail incl. 9 sub-tabs, recycle bin). Flows: 21.
Entities created: 3 (2 deals, 1 task); both deals soft-deleted into Recycle Bin (not permanently forgotten), see created-entities.json. No pre-existing deals, contacts or accounts touched.
Earlier aborted run (browser contention) overwritten; this run had no contention.

## Feature-mapping caveats
- Discovery said "17 deals visible"; the "All deals" view is filtered (1 filter: Pipeline=Default Pipeline) and count is 17 across Won/Lost too. Pipeline board shows only open stages 5/2/1/0 plus Negotiation, Won, Lost columns off-screen.
- Discovery listed "Drag deal between stages"; verified on an own deal.
- dom-snapshot.md for most pages is a stub; interactions.json + screenshots are the primary captures (snapshot tool output was saved only for deals-table and deal-detail).

## Coverage gaps
- Bulk actions (not clicked per safety rule), Import deals (out of scope), Add new view form (not opened), view contents of the 12 other saved views, Quotas and Forecasting page, Settings > Edit/Create pipeline (other module), Clone save, Remove commit, Won path, Restore/Forget from Recycle Bin, Add note, Add quote/file, Discussions, Group by results, product 'Add new product', Won/Lost and Negotiation columns of pipeline (scrolled off), network-requests.json not captured (empty arrays).
- Quirk: first-attempt clicks on setup-guide close accidentally dismissed the 'Connect your mailbox' banner (UI only).
