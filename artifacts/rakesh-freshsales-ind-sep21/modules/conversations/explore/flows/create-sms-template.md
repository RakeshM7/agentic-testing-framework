---
slug: create-sms-template
title: Create an SMS template
module: conversations
nav_path: Conversations > SMS Templates > Create SMS template
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create an SMS template.
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | sms-templates | click 'Create SMS template' | drawer 'Create sms template:' | sms-template-create |
| 2 | sms-template-create | click 'Save' empty | toast 'Give a name for your sms template.' | sms-template-create |
| 3 | sms-template-create | name only, Save | toast 'Template creation failed' | sms-template-create |
| 4 | sms-template-create | name + body, Save | toast 'Template creation failed' (likely SMS not set up; cause unconfirmed) | sms-template-create |
## Outcome
See steps.
## Variations and errors
Could not create a valid SMS template; nothing created. Cleanup n/a.
## Cleanup
Created templates deleted via the delete-email-template flow (see created-entities.json).
## Related flows
open-conversations-module
