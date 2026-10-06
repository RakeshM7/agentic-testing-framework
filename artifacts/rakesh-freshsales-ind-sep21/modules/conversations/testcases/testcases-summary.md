# Test case summary: conversations

File: conversations-testcases.csv (52 cases; all fields quoted; 10 columns; multi-step cells use "1. ...; 2. ..." on one line). Note: the CSV was written directly and not machine-parsed (no execution tool was available to the generator); a parse check is recommended.

## Counts by category
| Category | Count |
|---|---|
| Happy | 32 (001-032) |
| Negative | 11 (033-043) |
| Boundary | 9 (044-052) |

## Counts by priority
| Priority | Count |
|---|---|
| P0 | 7 |
| P1 | 25 |
| P2 | 20 |

Flagged UNCONFIRMED ASSUMPTION: 14 (002, 008, 028-032, 034-036, 038, 042, 051, 052); TC-022 has a confirmed core with an unconfirmed toast assertion. SKIPPED placeholders: 038, 052 (SMS template creation).

## Traceability matrix
| Test ID | Flow slug | Clarification / edge-case item |
|---|---|---|
| 001 | open-conversations-module | Scope: navigation |
| 002 | browse-email-folders | Awaiting Response; Open question 6 |
| 003, 004 | browse-email-folders | Confirmed no counts; Edge: Inbox/Sent render only |
| 005-007 | browse-email-folders | Edge: Empty folders (Scheduled, Drafts, Trash) |
| 008 | open-email-thread | Open question 1; Edge: open thread when no emails |
| 009 | reply-to-email-draft-only | Scope: open-only composer |
| 010 | compose-new-email-draft-only | Scope: open-only composer |
| 011, 012 | view-email-tracking | Edge: Opens/Clicks render only |
| 013 | view-email-tracking | Edge: Empty folders (Bounces) |
| 014-016 | view-bulk-email | Edge: Empty folders (Bulk) |
| 017, 018 | view-phone-and-sms | Scope: Phone/Voicemail |
| 019, 020 | view-phone-and-sms | Scope: SMS, SMS templates |
| 021 | view-team-inbox-setup | Scope: Team Inbox open-only |
| 022, 023 | create-email-template | Confirmed: list refresh; Open question 2 (toast) |
| 024 | search-filter-email-templates | Flow filter |
| 025 | edit-email-template-view | Flow edit drawer |
| 026 | delete-email-template | Confirmed: delete only run-created ZZ |
| 027 | delete-email-template | Edge: Bulk delete only ZZ |
| 028, 029 | edit-email-template-view | Open question 4 (Clone, Edit-save) |
| 030 | search-filter-email-templates | Open question 4 (search box) |
| 031 | compose-new-email-draft-only | Open question 4 (Use template, Insert fields, Attach) |
| 032 | none (no flow) | Open question 7 (Conversation Groups) |
| 033 | create-email-template | Edge: Save with empty name/body |
| 034-036 | create-email-template | Open question 3 (validation rules) |
| 037 | delete-email-template | Edge: Edit/delete seeded Public template |
| 038 | create-sms-template | Edge: Create SMS template; Open question 5 |
| 039 | create-sms-template | Flow step 2 (empty-name validation) |
| 040, 041 | reply-to-email-draft-only | Scope: no send/connect |
| 042 | open-email-thread | Edge: open thread when folder empty |
| 043 | open-conversations-module | Non-functional: console noise |
| 044 | create-email-template | Edge: Duplicate name |
| 045 | create-email-template | Edge: Save with empty name/body |
| 046 | create-sms-template | Empty-field boundary |
| 047 | delete-email-template | Edge: seeded Public template |
| 048 | delete-email-template | Edge: Bulk delete only ZZ |
| 049 | browse-email-folders | Edge: Empty folders |
| 050 | browse-email-folders | Edge: Inbox/Sent/Opens/Clicks no counts |
| 051 | open-email-thread | Edge: open thread when no emails |
| 052 | create-sms-template | Edge: Create SMS template valid name/body (skipped) |

All 8 edge-case table rows are covered: duplicate name (044), empty save (033, 045), SMS create (038, 052), seeded edit/delete (037, 047), bulk delete (027, 048), empty folders (049), render-only lists (050), thread-open when empty (042, 051).
