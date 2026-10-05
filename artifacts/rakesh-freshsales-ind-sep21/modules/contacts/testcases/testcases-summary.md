# Contacts test cases summary

File: contacts-testcases.csv (format: CSV, per run-config). Total: 47 cases.

## Counts
| Category | Count |
|---|---|
| Happy | 24 (TC-001..024) |
| Boundary (one per edge-case row; row 13 split into 2) | 15 (TC-025..039) |
| Negative | 8 (TC-040..047) |

| Priority | Count |
|---|---|
| P0 | 11 |
| P1 | 17 |
| P2 | 19 |

## Traceability matrix
| Test case | Flow slug | Clarification / edge-case item |
|---|---|---|
| 001 | open-contacts-list | In scope: default view |
| 002, 003 | switch-contact-view | B10; Open q 9 (003 unconfirmed) |
| 004, 046 | open-contacts-list | B11; Open q 5 (unconfirmed assumptions) |
| 005 | filter-contacts | B11, B7; Open q 5 (unconfirmed) |
| 006 | sort-contacts-column | B11; Open q 5 (unconfirmed) |
| 007 | customize-contacts-table | Open q 9 (Apply unverified, not covered) |
| 008, 010, 011, 041 | create-contact | B8, B3 |
| 009 | create-contact, change-lifecycle-stage | B7 |
| 012 | view-contact-detail | In scope: detail and tabs |
| 013, 014 | update-contact | B8, B13 |
| 015, 042 | clone-contact | B13; Open q 7 (empty vs pre-filled clone drawer discrepancy) |
| 016 | add-contact-note | B12; Open q 6 |
| 017, 018, 019, 020, 045 | contact-activity-actions | B12; Open q 6 (045 unconfirmed) |
| 021 | contact-row-actions | In scope: row actions |
| 022, 043 | contact-bulk-actions | B2, B8 |
| 023, 040 | delete-contact | B8, B10 |
| 024, 044 | import-contacts-entry | B4; Open q 9 (044 unconfirmed) |
| 025 | create-contact | Edge row 1; B5; Open q 2, 3 |
| 026 | create-contact | Edge row 2; B5 |
| 027 | create-contact | Edge row 3; B9 |
| 028 | create-contact | Edge row 4; B3; Open q 1 |
| 029 | clone-contact | Edge row 5; B6 |
| 030 | update-contact | Edge row 6; B6 |
| 031, 033 | change-lifecycle-stage | Edge row 7; B1 |
| 032 | change-lifecycle-stage | Edge row 8; B1 |
| 034 | contact-activity-actions | Edge row 9; B12 |
| 035 | delete-contact, switch-contact-view | Edge row 10; B10; Open q 8 |
| 036 | import-contacts-entry | Edge row 11; B4 |
| 037 | contact-bulk-actions | Edge row 12; B2 |
| 038, 039 | create-contact | Edge row 13; B9; Open q 4 (limits/format TBD) |
| 047 | n/a | Out of scope: pre-existing AgentTest contacts |

## Flags
- Flows verified live in explore as mutating (create, update, delete) are executed cases; flows marked readonly/not executed in explore (clone save, lifecycle save, activity submits, note save, bulk actions, import mapping, Recycle Bin restore) are unverified: cases 015, 016-020, 022, 029-036 expected results are inferred from clarifications.
- Unconfirmed assumptions (Nice-to-have follow-ups): 004, 005, 006, 046 (search/filter/sort), 025/028-030 (message wording), 038/039 (limits, mobile format), 045, 044.
- Discrepancy: flow clone-contact observed an empty Clone drawer; B13 says pre-filled (cases 015, 029).
