# Crawl log: contacts module (role: module, mode: full-run)
Authenticated crawl using storage state playwright-tests/freshsales/.auth/freshsales-handoff.json; account appeared to be the owner/admin "Rakesh M" (Admin Settings visible).

## Tooling deviation
The playwright-isolated MCP browser turned out to be shared with other concurrently running explorers (tabs for Accounts/Deals/Dashboards appeared in the tab list and the active tab kept switching), so MCP-driven exploration was unreliable. All exploration was instead done with isolated headless Chromium scripts (Playwright from playwright-tests/freshsales/node_modules) loading the same storage state. Captures: screenshot, aria snapshot as dom-snapshot.md, XHR/fetch list (network-requests.json), console errors/warnings. Network-requests.json and console-log.txt are mostly empty/partial (static filtering in script).

## Pages visited
Contacts list (default view), Recycle Bin view, contact detail (Overview + 7 tabs), Add/Edit/Clone drawers, Duplicates panel, delete confirm, plus overlays (views menu, customize table, filter, bulk toolbar, row menu, sort menu, import caret, global search, email/task/meeting/call-log forms). About 45 captured states; 3 distinct URLs patterns.

## Mutations (full-run)
Created 1 contact (ExploreContact1791143638407, id 402221019096), edited job title, deleted it. See created-entities.json. Pre-existing AgentTest contacts untouched. No imports, invites, deals created.

## Feature-mapping caveats
Discovery said "2 contacts exist"; confirmed. Discovery listed Import contacts and Bulk actions as keyActions; they were only inspected, not executed. Contact "status" in the list is the Status (Qualified) while "Lifecycle stage" (Lead) is a separate field (hidden column by default).

## Coverage gaps
- Filter application, column sort application, other saved views (My contacts etc.) content, Add new view, Customize table Apply, Table/Status/Group by view toggle options (menu text captured only as Table | Status | Group by).
- Bulk action execution, Import wizard, Export, Unsubscribe, Forget, Add to sequence, Lifecycle save, note save, task/meeting/call/email submission, tags, Contact details "Manage fields" and "View field edit history".
- Duplicate-email creation behaviour; max field length validations; mobile format validation.
- Row inline edit ("+ Click to add" cells).
