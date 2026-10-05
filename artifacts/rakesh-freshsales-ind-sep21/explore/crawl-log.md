# Crawl log - rakesh-freshsales-ind-sep21

- Mode: full-run
- Authenticated crawl: yes, via sessionStateFile playwright-tests/.auth/freshsales-handoff.json (loaded by the MCP server's --storage-state flag in .mcp.json). Landed on the Freshworks Admin Center (not /login); role: ORGANIZATION ADMIN (Rakesh M).
- Pages visited: 7 (contacts list, accounts list, deals kanban, contact detail, account detail, activities dashboard, conversations). maxDepth reached: 2. No login walls.
- Entities created: none (created-entities.json is []). Crawl was effectively read-only; the pre-existing "Explore Test Co" records from an earlier run were not touched.

## Skipped / not visited
- /crm/sales/analytics, /crm/sales/settings: out of scope for lead-to-deal feature; not crawled.
- Deal detail page: not captured (kanban cards open a summary panel; no direct deal URL discovered). Contact/account detail pages expose no deal links for the sampled records.
- Create/edit/delete actions, "Move Account", checkout/subscription links: skipped (mutating action).
- Admin Center pages (/users-groups, /security, /organization, /audit-logs): not crawled, out of feature scope.

## Notes
- /crm/sales/deals redirects to a view URL and renders the kanban board; /contacts and /accounts redirect to default list views.
- Each page shows 3 console errors (see console-log.txt per page; only warning+ saved).
- Network files hold non-static requests only.

## Errors
- None blocking.
