---
slug: view-bulk-email
title: View bulk email metrics, scheduled and drafts
module: conversations
nav_path: Conversations > Bulk Email
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View bulk email metrics, scheduled and drafts.
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | any | click 'Bulk email metrics' | /conversations/email-bulk-metrics: No conversations found. | bulk-email-metrics |
| 2 | any | click 'Bulk emails scheduled' | empty | bulk-emails-scheduled |
| 3 | any | click 'Bulk email drafts' | empty | bulk-email-drafts |
## Outcome
See steps.
## Variations and errors
All empty in this tenant.
## Cleanup
n/a
## Related flows
open-conversations-module
