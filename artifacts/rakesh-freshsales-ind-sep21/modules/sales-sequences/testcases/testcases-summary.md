# Test case summary: sales-sequences

File: sales-sequences-testcases.csv (26 cases)

## Counts by category
| Category | Count |
|---|---|
| Happy | 15 (001-015) |
| Negative | 5 (016-020) |
| Boundary | 6 (021-026) |

## Counts by priority
| Priority | Count |
|---|---|
| P0 | 5 (001, 003, 005, 012, 016) |
| P1 | 8 (002, 004, 008, 009, 010, 011, 013, 021, 022) -> see note |
| P2 | remainder |

Exact: P0 = 5; P1 = 9 (002, 004, 008, 009, 010, 011, 013, 021, 022); P2 = 12 (006, 007, 014, 015, 017, 018, 019, 020, 023, 024, 025, 026).

## Status flags
Confirmed or observed: 001, 002, 003, 004, 005, 006, 008, 009, 013, 016, 021, 022. All others are flagged "Unconfirmed assumption" (or Not executable for 026) per config defaults.

## Traceability matrix
| Test case | Clarification / edge-case item | Flow |
|---|---|---|
| 001 | Canonical entry point | view-sequences-list |
| 002 | View list empty state | view-sequences-list |
| 003 | List columns, Showing All sequences | view-sequences-list |
| 004 | Search | view-sequences-list |
| 005 | Create with task step, Inactive result | create-sales-sequence |
| 006 | Page sections / entry-exit options | create-sales-sequence |
| 007 | Entry/exit filter options; Open Q7 | create-sales-sequence |
| 008 | Row actions menu | clone-and-share-sequence |
| 009 | Share save; Open Q4 | clone-and-share-sequence |
| 010 | Clone-save; Open Q3 | clone-and-share-sequence |
| 011 | Edit in scope; Open Q5, Q8 | create-sales-sequence |
| 012 | Delete run-created; Open Q5; Follow-up 2 | clone-and-share-sequence |
| 013 | Leftover 402000016478 delete | create-sales-sequence (cleanup) |
| 014 | Other step types; Open Q6; Follow-up 4 | create-sales-sequence |
| 015 | Accounts-type; Open Q8 | n/a (unexplored) |
| 016 | Edge: Save with no steps | create-sales-sequence |
| 017 | Edge: Empty name; Follow-up 1 | create-sales-sequence |
| 018 | Add task required Title | create-sales-sequence |
| 019 | Provider dependence; Open Q6 | n/a |
| 020 | Quick-create; Open Q9 | n/a |
| 021 | Edge: Clone then Cancel | clone-and-share-sequence |
| 022 | Edge: Share Cancel | clone-and-share-sequence |
| 023 | Edge: Duplicate name | create-sales-sequence |
| 024 | Edge: Max name length | create-sales-sequence |
| 025 | Edge: Activate task-only; Follow-up 3 | create-sales-sequence |
| 026 | Edge: Enrolment (not testable) | n/a |

All 8 edge-case table rows are covered (016, 017, 023, 024, 021, 022, 025, 026).

Cleanup note: every created sequence and clone copy must be deleted and logged in created-entities.json. No `.env` cross-check was needed (no named identity beyond Owner/admin Rakesh M).
