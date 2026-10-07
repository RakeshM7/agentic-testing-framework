# Contact detail — Explore AgentTestLead (created this run)

URL: https://rakesh-freshsales-ind-sep21.myfreshworks.com/crm/sales/contacts/402219350782
Title: Contact : Explore AgentTestLead (explore.agent.testlead@example.com) : Freshsales

## Page text content (after qualifying)

Lifecycle stage: Sales Qualified Lead
Status pipeline: New -> Contacted -> Interested -> Qualified (current) -> Won / Churned
Account: Explore Test Co
Email: explore.agent.testlead@example.com
Sales owner: Rakesh M
Created at: a minute ago
No open deals associated with Explore. [Add deal]
No upcoming meetings. [Add meeting]
Not contacted yet. [Send email] [Add call log]
Not part of any sales sequence. [Add to a sequence]
[Add a note...] box in the right rail.

Top action bar: Email | Call log | Task | Meeting | Sales activities (dropdown) | Add deal | ... (kebab menu)

## Feature-under-test mapping note

This Freshsales tenant/user role has **no separate Leads module** (confirmed: `GET /crm/sales/leads` returns
a 403 "You are not authorised to perform this operation" page, and the global quick-create ("+") menu offers
only Add contact / Add account / Add deal / Add product / Add Quote — no "Add Lead"). Instead, the
"create and qualify a lead" step of the target feature maps onto this tenant's **Contact lifecycle model**:
- New contact defaults to Lifecycle stage = "Lead", Status = "New".
- Advancing the Status pill to "Qualified" auto-promotes Lifecycle stage to "Sales Qualified Lead".
This is the closest in-app equivalent to lead creation + qualification, and is what this crawl exercised.

## Entities created on this page
- Account "Explore Test Co" (auto-created via the Contact form's "Add new" affordance)
- Contact "Explore AgentTestLead" (explore.agent.testlead@example.com), id 402219350782

## Key API endpoints observed (useful for api-testing-agent)
- GET /crm/sales/selector/lifecycle_stages
- GET /crm/sales/selector/contact_statuses
- GET /crm/sales/search/auto_suggest/sales_accounts_full_details.json?q=<partial>&qf=name (account typeahead)
- POST /crm/sales/sales_accounts  (create account inline)
- POST /crm/sales/contacts?include=owner,sales_accounts,creater,source,updater,campaign,contact_status,lead_score_information,territory,emails,lookup_information,lists,lifecycle_stage,lost_reason,tags,social_handler  (create contact)
- GET /crm/sales/contacts/<id>?include=... (fetch contact detail)
- PUT /crm/sales/contacts/<id>?include=...  (update contact — used here to set status=Qualified / lifecycle_stage=Sales Qualified Lead)
- POST /crm/sales/contacts/<id>/duplicates
- POST /crm/sales/contacts/<id>/connections
- GET /crm/sales/contacts/<id>/notes
- GET /crm/sales/freddy/out_of_office/suggestions?context_type=contact&context_id=<id>
- Realtime updates via RTS websocket/long-poll: channel `contact_<id>`, event `model_change`
