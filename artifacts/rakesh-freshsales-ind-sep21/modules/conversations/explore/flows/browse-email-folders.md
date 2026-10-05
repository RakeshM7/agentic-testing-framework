---
slug: browse-email-folders
title: Browse email folders (Inbox, Sent, Scheduled, Drafts, Trash)
module: conversations
nav_path: Conversations > Email > <folder>
kind: read
mutating: false
requires_mode: readonly
---
## Goal
Browse email folders (Inbox, Sent, Scheduled, Drafts, Trash).
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | awaiting-response | click link 'Inbox' | /conversations/inbox: 3 sample emails, 'Showing 1 - 3 of 3' | inbox |
| 2 | any | click link 'Sent' | /conversations/sent: sample sent emails with Opened/Clicked badges | sent |
| 3 | any | click link 'Scheduled' | 'No conversations found.' | scheduled |
| 4 | any | click link 'Drafts' | 'No conversations found.' | drafts |
| 5 | any | click link 'Trash' | 'Showing Other Trash' / 'No conversations found.' | trash |
## Outcome
See steps.
## Variations and errors
Awaiting Response also lists. Folder pages need ~5s to load (SPA).
## Cleanup
n/a
## Related flows
open-conversations-module
