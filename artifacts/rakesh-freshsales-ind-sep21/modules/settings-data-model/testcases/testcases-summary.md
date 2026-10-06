# Test case summary: settings-data-model

File: `settings-data-model-testcases.csv` (44 cases, 11 columns, all fields quoted; row/column shape checked by regex, no CSV parser was available).

## Counts
| Category | Count |
|---|---|
| Happy | 20 (001-020) |
| Negative | 8 (021-028) |
| Boundary | 16 (029-044) |

| Priority | Count |
|---|---|
| P0 | 8 |
| P1 | 17 |
| P2 | 19 |

Confidence column: "Verified" = flow observed in explore; "Unverified" = Save/delete step not executed in explore; "Unconfirmed assumption" = default per open question, message text unknown (assert block/reject, not text). Limit cases (034-037) are observe-and-record with no hard-coded numbers.

## Traceability
| Item | Test cases |
|---|---|
| Flow open-settings-data-model-pages | 001, 028 |
| Flow view-contact-fields-list | 002 |
| Flow view-account-fields-list | 003, 006 |
| Flow view-add-contact-field-options | 004, 005, 007, 021, 029-034 |
| Flow view-custom-modules-and-add-module-form | 008, 009, 023, 035 |
| Flow view-lifecycle-stages | 010, 011, 024, 036, 042, 043 |
| Flow view-contact-scoring | 012, 026 |
| Flow view-web-forms | 013, 014, 037 |
| Flow view-crm-code-library | 015 |
| Flow view-linkedin-lead-gen | 016, 017, 027, 044 |
| Flow view-tags | 018, 019, 020, 022, 025 |
| Edge row 1 (empty label/internal name/type) | 029 (021 related) |
| Edge row 2 (duplicate/invalid/system clash) | 030, 031, 032, 033 |
| Edge row 3 (limits) | 034, 035, 036, 037 |
| Edge row 4 (no Email/Mobile/External ID) | 038, 039, 040, 041 |
| Edge row 5 (disable/delete stage with contacts) | 042, 043 |
| Edge row 6 (empty module/stage/tag) | 022, 023, 024 |
| Edge row 7 (web form / LinkedIn) | 014, 017, 027, 044 |
| Confirmed: create/delete ZZ-Explore fields, tags, module, forms | 005, 006, 009, 011, 014, 017, 019 |
| Confirmed: mandatory identity / Open Q6 | 038-041 |
| Open Q1 limits | 034-037 |
| Open Q2 validation messages | 022-025, 029-033 |
| Open Q3 module deletion | 009, 035 |
| Open Q4 stages/rules (run-created only) | 010, 011, 042, 043 |
| Open Q5 scoring view-only | 012, 026 |
| Open Q7 coverage gaps | 020 |
| Non-functional: admin session | 028 |

Notes: Cases 038-041 have no explore flow (contact-save rule); the External ID field may not be on the contact form (041 may be BLOCKED). Every mutating case is limited to ZZ-Explore run-created entities and must log them to `created-entities.json`.
