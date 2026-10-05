---
slug: open-add-call-log-form
title: Open the Add call log form
module: sales-activities
nav_path: + > Sales activities > Add call log
kind: create
mutating: true
requires_mode: readonly
---
## Goal
Open the Add call log form.
## Preconditions
Org admin session (Rakesh M). Full-run needed for saves.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | quick-create-menu | Click '+' then menuitem 'Add call log' | Dialog 'Call Log': Call type* (Incoming/Outgoing, default Outgoing), Outcome, Associate this phone call with?* (Existing Contact/Existing Account/Existing Deal), Name*, Notes (rich text), Cancel/Save | quick-create-menu |
| 2 | add-call-log-dialog | Click 'Save' empty | Inline "can't be empty" shown under Outcome (required) | add-call-log-dialog |
## Outcome
See last step result.
## Variations and errors
Save not executed: requires attaching to an existing record and none of ours existed.
## Cleanup
n/a
## Related flows
