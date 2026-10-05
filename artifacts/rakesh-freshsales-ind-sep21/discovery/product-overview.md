# Freshworks CRM (Freshsales) -- rakesh-freshsales-ind-sep21

Sales CRM on a trial plan (trial ends in 8 days at time of crawl). Authenticated as Rakesh M, ORGANIZATION ADMIN. Root URL is the Freshworks Admin Center; CRM is at /crm/sales.

## Module map (17 reachable, 2 unreachable; see modules.json)
Left nav: Dashboards, Contacts, Accounts, Deals, Conversations, Analytics, Admin Settings (plus Phone and the Freshworks switcher). Top bar: global "Search your CRM", quick-create (+), email, What's new, notifications, profile menu. Products, Sales Sequences, Quotes and tasks/meetings/calls have no left-nav link and are reached via the + menu, URLs or record pages.
Admin Settings groups: Leads/Contacts/Accounts; Deals & Pipelines; Teams & Territories; Data & Import; Channels; Apps & Integrations; Account Settings. Messaging/marketing sub-apps live at /crm/messaging and /crm/marketer on the same origin.

## Relationships
Contact -> belongs to Account; Deal -> linked to Contact and Account, sits in a Pipeline stage; Products/Quotes attach to Deals; Tasks/Meetings/Calls/Emails attach to Contact/Account/Deal; Sequences enroll Contacts; Dashboards/Analytics read all of these; settings modules define fields, stages, roles, territories used by the data modules.

## Main workflows
Lead capture (web form/import/add contact) -> qualify via lifecycle stage -> convert/associate with account -> create deal in pipeline -> log activities and email -> quote -> won/lost -> report in Analytics.

## Cautions
Existing records (AgentTest Lead..., 17 deals) are pre-existing; destructive actions only against entities created in the run. Trial/billing, user invites, Move Account, mailbox connection are out of scope.
