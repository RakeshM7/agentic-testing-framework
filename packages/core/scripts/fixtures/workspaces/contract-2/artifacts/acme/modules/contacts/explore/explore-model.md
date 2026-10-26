# Exploration model -- contacts

Rendered by `scripts/explore.mjs build` from model.json and coverage.json; never edit it.

Run acme-run-1 (readonly) · States 5/150 · Pages 2/40 · Transitions 12
Frontier: 71 items · explored 12 · excluded 59 · deferred 0 · open 0
Knowledge open points: 4 · accounted 4 · open 0
Untried inputs: 6 · asked 2 · explained 4 · open 0

## Pages
| Id | Slug | Template | States |
|---|---|---|---|
| PG-contacts-1 | contacts | /contacts | ST-contacts-1, ST-contacts-2, ST-contacts-3, ST-contacts-5 |
| PG-contacts-2 | contacts-id | /contacts/{id} | ST-contacts-4 |

## States
| Id | Page | Title | How to reach it |
|---|---|---|---|
| ST-contacts-1 | PG-contacts-1 | Contacts - Acme CRM | open https://app.acme.test/contacts |
| ST-contacts-2 | PG-contacts-1 | Contacts - Acme CRM | open https://app.acme.test/contacts → button "New contact" |
| ST-contacts-3 | PG-contacts-1 | Contacts - Acme CRM | open https://app.acme.test/contacts → tab "Mine" |
| ST-contacts-4 | PG-contacts-2 | Jane Doe - Acme CRM | open https://app.acme.test/contacts → link "Jane Doe" |
| ST-contacts-5 | PG-contacts-1 | Contacts - Acme CRM | open https://app.acme.test/contacts → columnheader "Name" |

## Transitions
- ST-contacts-1 → ST-contacts-2: button "New contact"
- ST-contacts-2 → ST-contacts-1: button "Cancel"
- ST-contacts-1 → ST-contacts-3: tab "Mine"
- ST-contacts-3 → ST-contacts-1: tab "All"
- ST-contacts-1 → ST-contacts-1: tab "All"
- ST-contacts-1 → ST-contacts-4: link "Jane Doe"
- ST-contacts-4 → ST-contacts-1: link "Back to contacts"
- ST-contacts-4 → ST-contacts-4: link "Jane Doe"
- ST-contacts-1 → ST-contacts-5: columnheader "Name"
- ST-contacts-5 → ST-contacts-1: columnheader "Name ▲"
- ST-contacts-1 → ST-contacts-1: link "Acme CRM"
- ST-contacts-1 → ST-contacts-1: link "Contacts"

## Frontier: open
None.

## Frontier: deferred (over the budget)
None.

## Frontier: excluded
- disabled: 1
- logout: 5
- not-allowed-in-mode: 8
- out-of-module: 10
- external: 5
- duplicate-of: 28
- unreachable: 2

## Knowledge open points
- KQ-contacts-1 [mapped: asked] The import flow is not documented. -- contacts-1
- KQ-contacts-2 [mapped: observed] Whether deals reference records is not documented. -- observation:explore/captures/deals-link.md
- KQ-contacts-3 [excluded: dismissed] Whether there is a maximum number of records is not documented. -- observation:explore/captures/deals-note.md
- KQ-product-1 [mapped: observed] The seat limit per plan is not documented. -- observation:explore/captures/owner-note.md

## Untried inputs
- FR-contacts-5 combobox "Sort by" [excluded] -- its options are listed in interactions.json
- FR-contacts-12 searchbox "Search contacts" [excluded] -- search is covered by the list flow
- FR-contacts-20 checkbox "Subscribed" [excluded] -- a plain opt-in flag
- FR-contacts-21 combobox "Owner" [excluded] -- its options are listed in interactions.json; no rule to ask about
- FR-contacts-32 textbox "Email" [mapped] -- contacts-2
- FR-contacts-33 textbox "Name *" [mapped] -- contacts-1

## Questions
- contacts-1: Is "Name" required when creating a contact?
- contacts-2: What format does "Email" accept?

## Entities created by explore and still live
None.
