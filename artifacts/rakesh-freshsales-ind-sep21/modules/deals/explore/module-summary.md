# Deals module summary
Purpose: sales opportunities tracked through Default Pipeline stages New > Qualification > Discovery > Demo > Negotiation > Won/Lost; views: Pipeline (kanban), Table, Forecast (by month/quarter), Group by.
Entity Deal: Deal name* (required, "Can't be empty"), Deal value* (default 0; negative -5 accepted, shown "$-5"), Currency (USD, disabled), Related contact/account, Deal type, Deal stage, Sales owner (default current user), Expected close date, Forecast category, Probability, Lost reason, Closed date, Payment status, Pipeline, Tags, Products, Deal team, Territory.
Lifecycle: create (stage New unless created from a column +) -> stage moves (detail bar click or kanban drag; toast "Deal updated.") -> Commit deal (needs expected close date; sets Forecast category Committed) -> Won/Lost modal "Add more details" (Lost reason optional; Closed date auto today) -> Delete (soft; Recycle Bin 90 days; Restore / Forget).
Rules: adding products overrides deal value with product total; kanban Won/Lost are separate columns; unapplied filter panel close prompts Apply/Discard; bulk action button selects all rows.
Permissions seen: org admin; all actions visible (Forget, Delete). Others untested.
Links: Contacts, Accounts (related fields), Products, Quotes, Tasks/Meetings/Calls, Pipelines admin (Settings menu), Forecasting (Quotas and Forecasting).
Test data left: ExploreDeals Deal 1 Edited and ExploreDeals Deal 2 in Recycle Bin.
