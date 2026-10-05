---
slug: change-lifecycle-stage
title: Open Lifecycle stage/Status editor
module: contacts
nav_path: Contacts > <contact> > Overview > Lifecycle stage
kind: update
mutating: false
requires_mode: readonly
---
## Goal
Open Lifecycle stage/Status editor.
## Preconditions
Authenticated via storage state (Rakesh M). 
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | contact-detail | Click "Lead" under Lifecycle stage | Inline editor with Lifecycle stage and Status (New, Contacted, Interested / Unqualified, Qualified / Lost, Won / Churned) and Cancel/Save | contact-detail-lifecycle |
## Outcome
Save not executed.
## Variations and errors
None observed beyond steps.
## Cleanup
n/a
## Related flows
create-contact, view-contact-detail, delete-contact
