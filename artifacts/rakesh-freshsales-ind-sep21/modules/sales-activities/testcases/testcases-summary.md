# Test case summary: sales-activities

Source: `clarifications/sales-activities-clarifications.md`; flows in `explore/flows/`. Format: CSV (confirmed). File: `sales-activities-testcases.csv`. 48 cases.

## Counts
| Category | Count |
|---|---|
| Happy | 24 (001-024) |
| Negative | 6 (025-030) |
| Boundary | 18 (031-048) |

| Priority | Count |
|---|---|
| P0 | 18 |
| P1 | 16 |
| P2 | 14 |

| Status | Count |
|---|---|
| Confirmed | 28 |
| Unverified (flow not executed in explore) | 9 (006, 007, 014, 016, 018, 019, 020, 022, 023) |
| Unconfirmed assumption (follow-ups answered with bare "Yes") | 11 (030, 039-048) |

All 17 flows in `flows/index.json` are covered.

## Traceability
| Test case | Flow | Clarification item |
|---|---|---|
| 001 | open-activities-dashboard | Scope: Activities Dashboard |
| 002 | filter-activities-by-due-date | Scope: due-date filter |
| 003 | add-activity-goal | Scope: goals entry |
| 004 | add-task | Scope: add task; due date defaults to tomorrow |
| 005 | complete-task | Scope: complete task |
| 006 | complete-task | Scope extras: Add outcome |
| 007 | complete-task | Scope extras: Snooze |
| 008 | delete-task | Scope: delete task |
| 009 | open-sales-activity-types | Scope: Sales Activities settings |
| 010 | create-custom-sales-activity-type | Scope: create custom type |
| 011 | edit-custom-sales-activity-type | Scope: rename custom type |
| 012 | delete-custom-sales-activity-type | Scope: delete custom type |
| 013 | view-custom-activity-fields | Scope: Customize fields |
| 014 | view-custom-activity-fields | Scope extras: custom field Add |
| 015 | view-activity-field-dependencies | Scope: Manage field dependencies |
| 016 | view-activity-field-dependencies | Scope extras: field dependency create |
| 017 | open-add-meeting-form | Scope: add meeting form |
| 018 | open-add-meeting-form | Full-run saves with throwaway ZZ record |
| 019 | open-add-call-log-form | Full-run saves; Outcome and Related to mandatory |
| 020 | add-custom-activity-from-quick-create | Related-to rule (custom activities) |
| 021 | add-activity-goal | Scope: add goal |
| 022 | add-activity-goal | Scope extras: Edit goal |
| 023 | add-activity-goal | Scope extras: Clone goal |
| 024 | delete-activity-goal | Scope: delete goal |
| 025 | add-task | Edge row 1 (negative view) |
| 026 | create-custom-sales-activity-type | Observed validation: empty type name |
| 027 | open-add-meeting-form | Observed validation: empty meeting title |
| 028 | add-activity-goal | Observed validation: goal with no user |
| 029 | add-custom-activity-from-quick-create | Related-to rule; empty custom activity form |
| 030 | open-sales-activity-types | Non-admin rights; Open question 4 |
| 031 | delete-custom-sales-activity-type | Edge row 6 |
| 032 | add-task | Edge row 1 |
| 033 | add-task | Edge row 2 |
| 034 | open-add-call-log-form | Edge row 3 |
| 035 | open-add-call-log-form | Edge row 4 (call log) |
| 036 | add-custom-activity-from-quick-create | Edge row 4 (custom activity) |
| 037 | open-add-meeting-form | Edge row 5 |
| 038 | open-send-sms | Edge row 7; Open question 7 |
| 039-041 | create-custom-sales-activity-type | Edge row 8: duplicate name, name length, max type count; Open question 1 |
| 042-043 | add-task | Edge row 8: past-due task, title length; Open question 2 |
| 044-047 | add-activity-goal | Edge row 8: target zero, negative, non-numeric, duplicate goal; Open question 3 |
| 048 | open-add-meeting-form | Open question 5 (Related to for meetings) |

## Notes
- Cases that need a Related to record start with a setup step creating a throwaway ZZ contact (other modules' flow); delete it afterwards. Never touch pre-existing AgentTest records.
- Open questions 6 (Preview, Configure widgets, Quick Links, calendar integrations, goal Filters, task type save) remain uncovered because nothing in scope confirms them.
- No live SMS send case exists by design.
- Edge-case table row 8 (UNRESOLVED) is expanded into 10 cases flagged "Unconfirmed assumption" per config defaults.
