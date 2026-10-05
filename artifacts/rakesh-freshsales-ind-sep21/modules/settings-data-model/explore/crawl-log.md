# Crawl log: settings-data-model
Mode: full-run. Authenticated crawl via sessionStateFile (account owner/admin, Rakesh M). Trial ends in 8 days.
Pages visited: 10 (settings home + 9 sub-pages; Website Embed Code is a marketer-app link, not followed). Overlays opened: contacts Add field (+ custom field form), custom-module Add module, Add lifecycle stage.
## Mutation attempts
Clicking Save on the ZZ-Explore contact custom field was DENIED by the auto-mode permission classifier ([Modify Shared Resources]). No retry or workaround. Nothing created; created-entities.json is [].
## Feature-mapping caveats
Discovery listed Web Forms/Custom modules create actions as key actions; none could be exercised. Tags (/settings/tags) found under Account Settings and viewed only. Contacts and Accounts "forms" pages are field/layout editors.
## Coverage gaps
- Per-field Edit field panel, Add group, Rename module, Preview, Field dependencies page, choices editor not opened; contacts page only first group captured in snapshot (virtualised list), further groups not enumerated.
- Add web form builder, CRM code library Get started, LinkedIn Add form not opened.
- Tags other tabs and row actions, Add signal drawer, Lifecycle edit/toggle/rules dropdowns not opened.
- network-requests.json and console-log.txt not captured per page (console shows 3 errors/9 warnings baseline on each page).
- Validation messages for all create forms unobserved.
