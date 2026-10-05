---
slug: clone-and-share-sequence
title: Clone or open Share for a sequence
module: sales-sequences
nav_path: Conversations > Sales Sequences > row actions
kind: update
mutating: false
requires_mode: readonly
---
## Goal
Inspect row actions: Edit, Share, Clone, Delete.
## Steps
| # | On page | Action | Result | Evidence |
|1|sequences-list-with-data|Click row actions button|Menu: Edit, Share, Clone, Delete|sequences-list-with-data|
|2|list|Click "Share"|Dialog "Share Sequence": radios "Just me"(default), "Everyone" (can view), "Selected users, teams and territories"; Cancel/Save. Cancelled|-|
|3|list|Click "Clone"|Wizard prefilled "Explore Test Sequence - Copy" with Step 1; Cancel > Confirm "Are you sure want to discard?" > Yes returns to list; nothing saved|-|
## Outcome
Nothing mutated. ## Variations and errors
Edit and Delete not executed (Delete denied). ## Cleanup
n/a ## Related flows
create-sales-sequence
