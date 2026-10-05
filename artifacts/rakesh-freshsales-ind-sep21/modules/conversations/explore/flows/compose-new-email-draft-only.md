---
slug: compose-new-email-draft-only
title: Open the New mail composer (not sent)
module: conversations
nav_path: Top bar > Send email
kind: workflow
mutating: false
requires_mode: readonly
---
## Goal
Open the New mail composer (not sent).
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | any | click 'Send email' (top bar icon) | URL gains ?open_modal=email; drawer 'New mail' with 'Email usage : 0 / 100', To, From, Cc, Bcc, subject, Use template, Insert fields, Add follow-up task, Email linked to contacts, editor, Attach, 'Track this email', 'Add unsubscribe link', Send | compose-email |
| 2 | compose-email | click close X | drawer closes, no discard prompt | compose-email |
## Outcome
See steps.
## Variations and errors
Send not exercised.
## Cleanup
n/a
## Related flows
open-conversations-module
