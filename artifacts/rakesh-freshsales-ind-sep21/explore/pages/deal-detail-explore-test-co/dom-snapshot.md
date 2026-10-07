# Deal detail — Explore Test Co - Pipeline Kanban Test Deal (created this run)

URL: https://rakesh-freshsales-ind-sep21.myfreshworks.com/crm/sales/deals/402012367593
Title: Deal : Explore Test Co - Pipeline Kanban Test Deal : Freshsales

## Summary of the full-run flow exercised on this deal

1. Created via Contact overview "Add deal" action, related to contact "Explore AgentTestLead" and
   account "Explore Test Co". Initial stage: **New**, value $2,500, pipeline "Default Pipeline".
2. Advanced through pipeline stages by clicking each stage pill in the deal-stage progress bar (top of
   deal detail page): **New -> Qualification -> Discovery -> Demo -> Negotiation**. Each transition
   triggered a `PUT /crm/sales/deals/<id>` and a "Deal updated" success toast.
3. Logged an activity against the deal: clicked "Task" in the deal's action bar, filled Title
   "Follow up with Explore Test Co on negotiation terms", left default due date/owner (Rakesh M),
   and saved. This created a Task record (`POST /crm/sales/tasks` -> 201) linked to the deal
   (visible under the deal's Activities > Tasks tab, count = 1).

This exercises the full target feature: create+qualify a lead-equivalent contact, create a deal from
it, move the deal across pipeline stages on the Kanban-backed pipeline, and log an activity (task)
against the deal.

## Final state at capture time
- Deal stage: Negotiation
- Deal value: $2,500
- Related account: Explore Test Co
- Related contact: Explore AgentTestLead
- Tasks (1): "Follow up with Explore Test Co on negotiation terms", due Sep 22 2026 16:15, owner Rakesh M, not completed

## Key API endpoints observed (useful for api-testing-agent)
- PUT /crm/sales/deals/<id>?include=owner,creater,updater,contacts,sales_account,deal_pipeline,deal_stage,deal_type,territory,currency,source,deal_reason,campaign,deal_product,deal_payment_status,lookup_information,tags  (used for every stage transition — body includes updated deal_stage_id)
- GET /crm/sales/deals/<id>?include=...
- GET /crm/sales/selector/deal_pipelines
- GET /crm/sales/selector/deal_reasons
- GET /crm/sales/settings/deal_pipelines?include=deal_stages
- GET /crm/sales/selector/sales_activity_entity_types
- GET /crm/sales/selector/sales_activity_types/<type_id>/sales_activity_outcomes
- POST /crm/sales/tasks  (201 — creates a Task/activity linked to the deal via `targetable`/`related_to`)
- GET /crm/sales/deals/<id>/sales_activities?deleted_activity_count=true
- GET /crm/sales/deals/<id>/activity_counts?types[]=appointments&types[]=tasks&types[]=notes
- GET /crm/sales/deals/<id>/tasks?include=creater,owner,updater,users,task_type,sales_activity_outcome,outcome&page=1&per_page=25&type=all&sort=due_date&sort_type=desc
