---
slug: open-conversations
title: Open Conversations (email inbox)
module: conversations
nav_path: Conversations
kind: navigation
mutating: false
requires_mode: readonly
---
## Goal
Open Conversations (email inbox).
## Preconditions
Authenticated session (Org Admin, storageState handoff).
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | crm-home | Click link 'Conversations' (left nav listitem 'Conversations') | Lands on /crm/sales/conversations/awaiting_response, page title 'Conversations : Freshsales' | conversations |
## Outcome
The Conversations landing page is shown.
## Variations and errors
Observed only the happy path; no validation seen (navigation only).
## Cleanup
n/a
## Related flows
See flows/index.json.
