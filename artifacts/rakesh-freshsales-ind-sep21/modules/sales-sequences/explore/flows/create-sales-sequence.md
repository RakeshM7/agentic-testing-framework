---
slug: create-sales-sequence
title: Create a sales sequence with a task step
module: sales-sequences
nav_path: Conversations > Sales Sequences > Create sales sequence
kind: create
mutating: true
requires_mode: full-run
---
## Goal
Create an Outbound contact sequence.
## Preconditions
Role able to create sequences.
## Steps
| # | On page | Action | Result | Evidence |
|1|sequences-list|Click button "Create sales sequence"|/crm/sales/sales-sequences/contact/new; name defaults "New Sequence"; sections 1 Who can enter (Contacts/Accounts), 2 type (Outbound default 05:00 UTC / Classic / Smart, Exclude weekends), 3 steps, 4 exit (21 days, 4 checked boxes)|sequence-new|
|2|sequence-new|Click "Save" with no steps|Inline error "Add at least 1 step to this sequence"; stays on page|sequence-new|
|3|sequence-new|Type name "Explore Test Sequence"; click "Add task"|Dialog "Add task": Title* (default "Follow-up task"), Owner* (Rakesh M), Description, Due date (step execution date, 05:00), delay (disabled for step 1), Exit settings outcomes|sequence-new-add-task-dialog|
|4|dialog|Click "Save"|Step 1 "Follow-up task" added|sequence-new|
|5|sequence-new|Click "Save"|/sales-sequences/contact/402000016478, status "Inactive", metrics all 0|sequence-detail|
## Outcome
Inactive sequence created (not started; "Save and start" not used).
## Variations and errors
Empty-steps validation above. Other step types not opened. Detail page has "Clone sequence", "Edit sequence".
## Cleanup
Entity id 402000016478 NOT deleted: Delete click on row-actions menu was blocked by the permission classifier. Manual deletion needed (list > row actions > Delete).
## Related flows
clone-and-share-sequence
