---
slug: delete-email-template
title: Delete an email template (single and bulk)
module: conversations
nav_path: Conversations > Email Templates > row menu > Delete
kind: delete
mutating: true
requires_mode: full-run
---
## Goal
Delete an email template (single and bulk).
## Preconditions
Authenticated as Organization Admin; no mailbox connected.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | email-templates | click row kebab > 'Delete' | Confirm dialog 'Are you sure you want to delete this template?' No/Yes | email-templates |
| 2 | email-templates | click 'Yes' | template removed | email-templates |
| 3 | email-templates | tick row checkbox, click 'Delete', then 'Yes' on 'Are you sure you want to delete 1 template?' | removed; empty state 'No EMAIL templates found.' + Create EMAIL template | email-templates |
## Outcome
See steps.
## Variations and errors
Only templates created in this run were deleted.
## Cleanup
Created templates deleted via the delete-email-template flow (see created-entities.json).
## Related flows
open-conversations-module
