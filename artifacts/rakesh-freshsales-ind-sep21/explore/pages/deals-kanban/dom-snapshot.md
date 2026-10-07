# Deals — Pipeline Kanban board

URL: https://rakesh-freshsales-ind-sep21.myfreshworks.com/crm/sales/deals/view/402015942744?per_page=25&sort=amount
Title: Deals : Freshsales

## Page text content

All deals: 12, total $7.14K | 13 more... | Settings | Import deals | Add deal
View toggle: Pipeline (Kanban) / (Table view also available)
Sort by Deal value | 1 filter applied | All deal owners | Quotas and Forecasting

Setup guide banner: Take an interactive tour / Personalize your CRM / Import contacts / Bring in website leads / Invite your team / Route leads to your team / Create sales sequence / Set up your sales pipeline

## Pipeline stages (Kanban columns, left to right)
1. New
2. Qualification
3. Discovery
4. Demo
5. Negotiation
6. Won
7. Lost

Each column header has a "+" quick-add-deal-to-stage control and a colored dot (stage indicator).

## API endpoints observed (useful for api-testing-agent)
- GET /crm/sales/deals/filters
- GET /crm/sales/deals?include=lookup_information&load_as_per_list_page_config=true&per_page=25&segment_id=<id>&sort=amount&sort_type=desc
- GET /crm/sales/settings/deal_pipelines?include=deal_stages
- GET /crm/sales/selector/owners, /selector/teams, /selector/business_types, /selector/industry_types, /selector/territories
- POST /crm/sales/deals/view_rollup_detail
- POST /crm/sales/deals/kanban_funnels
- POST /crm/sales/deals/kanban_headers
- GET /crm/sales/deals/view/<view_id>/aggregated_data?group_by_type=deal_stage_id&group_by_value[]=<stage_id>...&include=lookup_information&load_as_per_kanban_page_config=true&page=1&per_page=10&sort=updated_at&sort_type=desc
  - Deal stage IDs observed: 402001912038, 402001912039, 402001912040, 402001912041 (New/Qualification/Discovery/Demo, in order)
- POST /crm/sales/notes/entity_notes_count
- POST /crm/sales/quotas/freddy/filterize

## Links discovered (same-origin)
- Deal cards within each column link to /crm/sales/deals/<id> (not yet expanded/scrolled at capture time)
- "13 more..." tab list of saved deal views
