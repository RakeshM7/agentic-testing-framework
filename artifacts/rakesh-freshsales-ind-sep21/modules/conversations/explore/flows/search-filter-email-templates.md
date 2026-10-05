---
slug: search-filter-email-templates
title: Filter email templates
module: conversations
nav_path: Conversations > Email Templates > filter
kind: search-filter
mutating: false
requires_mode: readonly
---
## Goal
Filter email templates.
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | email-templates | click button 'Shared with me' | menu: Created by me, Shared with me, Most recent | email-templates |
| 2 | email-templates | click 'Created by me' | URL ?filterParam=-301; only own templates | email-templates |
## Outcome
See steps.
## Variations and errors
Search textbox 'Search by tags and templates' not exercised.
## Cleanup
n/a
## Related flows
open-conversations-module
