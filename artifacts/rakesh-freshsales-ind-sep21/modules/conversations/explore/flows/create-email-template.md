---
slug: create-email-template
title: Create an email template
module: conversations
nav_path: Conversations > Email Templates > Create EMAIL template
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create an email template.
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | email-templates | click button 'Create EMAIL template' | drawer 'Create template' | email-template-create |
| 2 | email-template-create | click 'Save' with empty name | error toast 'Give a name for your email template.' | email-template-create |
| 3 | email-template-create | type 'Name your template' (slow typing), 'Write a subject line'; click 'Save' | toast 'You created an email template.'; drawer closes; template Private, appears only under filter 'Created by me' | email-templates |
## Outcome
See steps.
## Variations and errors
Subject and body optional (a name-only save succeeded). Duplicate name auto-suffixed '[YYYY-MM-DD HH:MM:SS]'. Template list does not refresh in place; reload.
## Cleanup
Created templates deleted via the delete-email-template flow (see created-entities.json).
## Related flows
open-conversations-module
