---
slug: browse-deal-detail-tabs
title: Browse deal detail tabs
module: deals
nav_path: Deals > <deal>
kind: read
mutating: false
requires_mode: readonly
---
## Goal
Browse deal detail tabs.
## Preconditions
Authenticated as Rakesh M (org admin). Deals module reachable. 
## Steps
| # | On page (slug) | Action | Result | Evidence |
|---|---|---|---|---|
| 1 | Deal detail | Click each of Deal details, Activities, Deal team, Contacts, Conversations, Products, Quotes, Files, Freddy AI insights | Activities: Notes/Tasks/Meetings + 'Create custom sales activity'; Deal team: 'Manage team members'/'Add team members'; Contacts: 'Add contact'; Conversations: Sales Emails & Activities, Call Logs; Quotes: 'Add quote'; Files: 'Add file'; Freddy: 'doesn't have any insights for now' | browse-deal-detail-tabs |
## Outcome
Empty states for a new deal.
## Variations and errors
See Outcome notes.
## Cleanup
n/a
## Related flows
open-deals-pipeline-view
