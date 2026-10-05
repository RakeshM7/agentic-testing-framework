---
slug: view-contact-detail
title: View a contact detail page and its tabs
module: contacts
nav_path: Contacts > <contact name>
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View a contact detail page and its tabs.
## Preconditions
Authenticated via storage state (Rakesh M). Create flow must have produced a contact for detail flows.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contacts-list | Click contact name link | /crm/sales/contacts/<id>, tabs on left: Overview, Contact details, Conversations, Activities, Accounts, Deals, Freddy AI insights, Files, Apps in marketplace | contact-detail |
| 2 | contact-detail | Click each tab | ?tab=entity-card-detail (Basic information, Tags, View field edit history, Manage fields); ?tab=conversations (Sales Emails & Activities, Chats, Call Logs); ?tab=recent-activities (Notes, Tasks, Meetings, filters); ?tab=sales_accounts; ?tab=deals; ?tab=freddy (score factors, Possible duplicates, Possible connections); ?tab=files | contact-detail-contact-details |
## Outcome
Empty tabs show "No conversations found.", "No accounts found.", "No deals found.", "No files found.", "No data available".
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
