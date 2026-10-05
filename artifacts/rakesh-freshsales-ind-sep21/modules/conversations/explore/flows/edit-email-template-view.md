---
slug: edit-email-template-view
title: Open the Edit template drawer
module: conversations
nav_path: Conversations > Email Templates > row menu > Edit
kind: update
mutating: false
requires_mode: readonly
---
## Goal
Open the Edit template drawer.
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | email-templates | click row kebab > 'Edit' | drawer 'Edit template: <name lowercased>' with name, subject, body | email-template-edit |
| 2 | email-template-edit | click 'Cancel' | drawer closes | email-templates |
## Outcome
See steps.
## Variations and errors
Save edit not exercised.
## Cleanup
n/a
## Related flows
open-conversations-module
