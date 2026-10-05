# Accounts module crawl (full-run, authenticated as Rakesh M, ORGANIZATION ADMIN, via session state file)
Pages/states visited: 12 page slugs (list views, filter, add form, detail + 7 tabs, recycle bin). Flows: 13. Mode full-run; only entity created: account ModExplore Acct 0510 (id 402012712600), renamed, then deleted to Recycle Bin. No pre-existing record was modified or deleted. No imports, demos, Move Account.
Notes: The Add/Edit account form and detail page render inside an iframe (snapshot refs prefixed f9). Bulk actions select-alls on click; page was reloaded to clear without running any action. Per-page network-requests.json and console-log.txt are placeholders (not captured per page; MCP console shows 3-4 errors per load).
## Feature-mapping caveats
modules.json lists key actions "Import accounts" (not executed, forbidden), "Filter", "Bulk actions" (toolbar opened only), "Open account detail". dependsOn contacts: Related contacts column and Contacts tab exist; contact creation from an account was not exercised. No sort or per-page overlay opened.
## Coverage gaps
- Sort control, column-header menus, per-page selector, view-type (Table) alternatives, Add new view / Save view as, filter operator list.
- Bulk action execution (Update field, Add tags, Add to sequence, Assign to, Merge, Delete); row menu actions Add meeting, Add call log, Forget, Clone-save.
- Account detail: Add parent account, Add a note, Call/Task/Meeting/Sales activities, Add deal/contact from account, Files upload, Account details inline edit, Manage fields, Apps in marketplace, Customize overview.
- Recycle Bin row actions (restore/permanent delete); import flow and import history.
- Duplicate-name / maxlength validation of Name; phone format validation.
