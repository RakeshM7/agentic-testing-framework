---
slug: create-template-validation
title: Open Create template form and check validation
module: products-quotes
nav_path: Document Templates > Create template
kind: create
mutating: false
requires_mode: readonly
---
## Goal
Drawer fields Template name*, Specify Quote type*.
## Preconditions
Authenticated as Rakesh M (admin-like) via session state; trial tenant.
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | cpq-document-templates | Click 'Create template' | Create template drawer | cpq-document-templates |
| 2 | cpq-document-templates | Click 'Create' empty | 'Can't be empty' under Template name; 'can't be empty' under Quote type | cpq-document-templates |
| 3 | cpq-document-templates | Click 'Cancel' | Drawer closed, nothing created | cpq-document-templates |
## Outcome
As in steps.
## Variations and errors
Valid create NOT executed (not required); flow unverified beyond validation.
## Cleanup
n/a
## Related flows
See flows/index.json.
