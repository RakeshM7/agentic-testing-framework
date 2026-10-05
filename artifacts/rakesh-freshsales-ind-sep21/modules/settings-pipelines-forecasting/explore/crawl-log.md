# Crawl log: settings-pipelines-forecasting
Mode: full-run (authorized), but explored view-only per run safety instruction; nothing created, edited or deleted. Authenticated crawl via sessionStateFile; role appeared to be tenant admin (Admin Settings fully accessible). Trial tenant ("trial ends in 8 days").
Pages visited (7): admin-settings-home, pipelines, deal-fields, field-dependencies, sales-forecast, sales-activity-types, activity-goals.
Overlays opened then cancelled: Create pipeline, Deal Add field, Deal form Preview, Create dependency, Add forecast category, Create sales activity.
## Errors
- Clicking "Add selected" in the Add field drawer was DENIED by the permission system (unrequested commit); not retried.
- Console showed ~3 errors/9 warnings on each page (not itemised). network-requests.json and console-log.txt were not captured per page (tool outputs saved to .playwright-mcp only).
## Feature-mapping caveats
- Discovery stated /settings/sales-forecast errored or was plan-gated; in this run it loaded normally as "Quotas and Forecasting" for the admin session.
- The group also contains Activity Goals (navigates outside settings shell to /crm/sales/activity-goals/...) and Product Catalog (not followed; belongs to products module).
- "Quotas" as an entity: no quota configuration UI found on the Quotas and Forecasting page.
## Coverage gaps
- Existing Default Pipeline edit/delete controls, Rename module, Add group, Edit field panels, field choices editor, Edit activity, forecast category edit, Add goal and Filters not opened.
- Custom field configuration forms (blocked by denial), validation messages (Save never clicked), form field dependency mapping UI.
- Product Catalog tile not followed.
