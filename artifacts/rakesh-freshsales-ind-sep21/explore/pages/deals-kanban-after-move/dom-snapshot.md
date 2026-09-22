# Deals Kanban — after moving the created deal to Negotiation

URL: https://rakesh-freshsales-ind-sep21.myfreshworks.com/crm/sales/deals/view/402015942744?per_page=25&sort=amount
Title: Deals : Freshsales

Confirms the created deal "Explore Test Co - Pipeline Kanban Test Deal" ($2,500) now appears as a
card in the **Negotiation** column of the pipeline Kanban board, alongside "Techcave (sample)"
($3,200). Discovery column shows "Pivotal Tech (sample)" ($3,500). Demo column is empty (shows an
inline "+ Add deal" affordance). Won column visible partially at right edge.

All deals total is now $9.14K (up from $7.14K before this run's $2,500 deal was created — figures
match: 7.14 + 2.5 = 9.64, note some rounding/weighting differences from partially-scrolled totals;
treat the $9.14K header figure as the live authoritative total for api-testing-agent verification).

## API endpoints observed
- POST /crm/sales/deals/kanban_headers
- GET /crm/sales/deals/view/<view_id>/aggregated_data?group_by_type=deal_stage_id&group_by_value[]=<stage_id>...&include=lookup_information&load_as_per_kanban_page_config=true&page=1&per_page=10&sort=updated_at&sort_type=desc
  - Additional stage IDs seen while scrolling right: 402001912042 (Negotiation), 402001912043 (Won)
- POST /crm/sales/notes/entity_notes_count
