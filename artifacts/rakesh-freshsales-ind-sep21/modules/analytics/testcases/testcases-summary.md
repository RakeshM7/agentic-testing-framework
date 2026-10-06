# Analytics test cases summary

File: `testcases/analytics-testcases.csv` (CSV, 10 columns, all fields quoted; 34 cases). Note: no shell was available to machine-parse the CSV; quoting was kept uniform (no embedded double quotes) so it should parse cleanly. Please validate on first use.

## Counts
| Category | Count |
|---|---|
| Happy | 19 |
| Negative | 5 |
| Boundary | 10 |

| Priority | Count |
|---|---|
| P0 | 7 |
| P1 | 12 |
| P2 | 15 |

## Traceability
| Test case | Flow | Clarification / edge-case item | Status |
|---|---|---|---|
| 001, 002 | open-analytics-reports-list | In scope: library | Confirmed |
| 003 | create-report-from-gallery-template | Confirmed: create from Gallery | Confirmed |
| 004 | view-report-details | In scope: Report Details | Confirmed |
| 005 | favorite-report | In scope: favorite | Confirmed (Favorites listing assumed) |
| 006, 007 | open-curated-report | In scope: curated reports | Confirmed |
| 008, 009, 011, 012 | browse-analytics-settings | Settings list/navigation; Data Export/Custom Metrics deferred | Confirmed |
| 010 | trash-report | Edge: trash run-created report | Confirmed |
| 013 | create-custom-attribute-form | In scope: New Attribute form | Confirmed |
| 014, 015 | schedule-report-validation (Export menu) | Email Now / Download safe live | Unverified |
| 016-018 | open-analytics-reports-list | Open question 4: filters, sort, paging | Unconfirmed |
| 019 | trash-report | Edge: retention 4w 2d; OQ 6 | Unconfirmed |
| 020 | schedule-report-validation | Edge: valid self schedule, non-Monthly | Unverified |
| 021 | schedule-report-validation | Edge: required fields empty | Confirmed |
| 022, 023 | schedule-report-validation | Edge: required fields empty (Subject, Send to) | Unverified |
| 024 | schedule-report-validation | Cancel saves nothing | Confirmed |
| 025 | schedule-report-validation | Edge: other recipient; OQ 1 | Unconfirmed, NOT executed live |
| 026 | schedule-report-validation | Edge: non-Lead/Contact/Agent recipient; OQ 7 | Unconfirmed, NOT executed live |
| 027 | create-report-from-gallery-template | Edge: empty name (round 2) | Confirmed |
| 028, 029, 030 | create-report-from-gallery-template | Edge: duplicate / over-long / default name; OQ 2 | Unconfirmed |
| 031 | trash-report | Trash dialog Cancel | Confirmed |
| 032 | open-curated-report | Edge: curated Edit/Clone/Trash/Favorite; OQ 3 | Unconfirmed |
| 033 | create-custom-attribute-form | OQ 8 (validation not captured) | Unverified |
| 034 | browse-analytics-settings | Edge: Data Export/Custom Metrics forms deferred | Deferred |

Edge-case table coverage: all 9 rows covered (rows 1-9 -> 021/022/023, 020, 025, 026, 027, 028-030, 010/019, 032, 034).
