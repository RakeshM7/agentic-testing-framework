# Crawl log: products-quotes
- Mode: full-run. Authenticated crawl via sessionStateFile; account Rakesh M (admin-level: sees Admin Settings, CPQ settings).
- Pages visited: products list, product drawer (view/edit/clone), CPQ Settings, Document Templates, Create template drawer, + menu, Add quote drawer, quote detail, Add or edit products dialog, Recent activity, quotes list (11 captures).
- Cleanup: previous-run product ZZ Explore Product A deleted; this run's clone (ZZ Explore Product B) and quote ZZ Explore Quote 1 deleted. See created-entities.json (3 entities, all deleted). Products list back to 3 sample products.
- Not executed (safety): Import products/history, Send to customer, Forget, Save PDF/Download, Sync quote with deal toggle, Add or edit products Save (would change a pre-existing deal's value), CPQ settings changes, template creation, Customize fields links, Request demo.
- Console showed 3 errors/5-13 warnings on every page (third-party/analytics, not investigated).
- Network capture: browser_network_requests not run for new pages this run; network-requests.json exists only for products-list from the earlier attempt.

## Feature-mapping caveats
- Quotes DO have a list page (/crm/sales/cpq_documents/view/402015942782) not mentioned in discovery; reachable after quote delete and via the Quotes list gear. Discovery said quotes are created only via + > Add Quote; confirmed (quotes also require an existing Deal and Primary contact, so a Deal is a hard prerequisite).

## Coverage gaps
- Quote Edit overlay, Clone quote, Preview, Save PDF, Send to customer, quote stage transitions, products on quote (Save).
- Quotes list: Filters, Edit columns, sort, row kebab, Manage Quote types, Customize Quote fields, Document template editor (open sample template), Create template with valid data, template row actions.
- Products: category filter, Edit columns, sorting, bulk select actions, Add or edit prices dialog (seen earlier only), subscription pricing creation, multi-currency price, Customize Product fields.
- Per-page console/network captures for most new pages.
