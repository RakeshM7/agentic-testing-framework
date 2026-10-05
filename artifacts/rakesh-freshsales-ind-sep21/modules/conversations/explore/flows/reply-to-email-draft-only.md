---
slug: reply-to-email-draft-only
title: Open the reply composer on an email (not sent)
module: conversations
nav_path: Conversations > Email > Inbox > <subject> > Reply
kind: workflow
mutating: false
requires_mode: readonly
---
## Goal
Open the reply composer on an email (not sent).
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | email-thread | click button 'Reply' | inline composer: To prefilled, subject 'Re: ...', 'Use template', 'Insert fields', 'Add follow-up task', 'Email linked to contacts, deals', banner 'You haven't connected <email> to the CRM' with 'Connect Gmail' / 'Connect a different email', rich-text toolbar, 'Attach', 'Track this email', 'Add unsubscribe link', 'Send' | email-thread |
| 2 | email-thread | click 'Send' | not executed (no real emails) | - |
## Outcome
See steps.
## Variations and errors
Send not exercised; later outcome unverified.
## Cleanup
n/a
## Related flows
open-conversations-module
