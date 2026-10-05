---
slug: view-email-tracking
title: View email tracking (Opens, Clicks, Bounces)
module: conversations
nav_path: Conversations > Email Tracking > <Opens|Clicks|Bounces>
kind: read
mutating: false
requires_mode: readonly
---
## Goal
View email tracking (Opens, Clicks, Bounces).
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | any | click link 'Opens' | /conversations/opened: list of opened sent emails | tracking-opens |
| 2 | any | click link 'Clicks' | /conversations/clicked | tracking-clicks |
| 3 | any | click link 'Bounces' | 'No conversations found.' | tracking-bounces |
## Outcome
See steps.
## Variations and errors
Opens/Clicks seeded from sample data.
## Cleanup
n/a
## Related flows
open-conversations-module
