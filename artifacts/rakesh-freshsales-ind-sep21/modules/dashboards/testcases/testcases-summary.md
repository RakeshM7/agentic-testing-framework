# Dashboards test cases summary

File: dashboards-testcases.csv (34 cases, CSV format as configured). Cases flagged "Unconfirmed assumption" or "Unverified" follow the config default policies (assume-standard-and-flag / flag-as-unconfirmed-case).

## Counts
Category: Happy 23, Negative 4, Boundary 7 (total 34).
- Boundary (7): 015, 018, 020, 021, 022, 025, 028
- Negative (4): 023, 026, 027, 034
- Happy (23): 001-014, 016, 017, 019, 024, 029-033

Priority: P0 = 10 (001, 002, 003, 004, 008, 009, 015, 018, 020, 021); P1 = 8 (005, 006, 007, 013, 014, 017, 024, 034); P2 = 16 (010, 011, 012, 016, 019, 022, 023, 025, 026, 027, 028, 029, 030, 031, 032, 033).

## Traceability
| TC | Covers | Flow |
|---|---|---|
| 001 | Default tabs (Q1), open module | open-dashboards |
| 002-004 | Default tabs (Q1), Q3 presence-only | switch-dashboard-tab |
| 005-007 | Export / Email Now / Download (A4) | export-dashboard |
| 008-009 | Add report tab, remove run-created tab (Q6) | add-report-tab |
| 010-011 | Open Q1 other popular reports | add-report-tab |
| 012 | Custom dashboard from Analytics (A3) | add-report-tab |
| 013-014, 016 | Configure widgets (Q5) | configure-activities-widgets |
| 015 | Edge: Configure Save then restore | configure-activities-widgets |
| 017, 019, 030 | Curated Edit; Q1 vs Sales Trends discrepancy; Open Q5 | edit-curated-dashboard |
| 018 | Edge: Edit then Discard | edit-curated-dashboard |
| 020 | Edge: Direct URL (A2) | open-dashboards |
| 021 | Edge: default tab removal (never performed) | add-report-tab |
| 022 | Edge: Add same report twice (Open Q2) | add-report-tab |
| 023 | Edge: Report search no match (Open Q2) | add-report-tab |
| 024-028 | Edge: activity filter/pills/empty state (Open Q4) | filter-activity-types |
| 029, 031 | Open Q5 | switch-dashboard-tab |
| 032-033 | Open Q6 | configure-activities-widgets (no dedicated flow) |
| 034 | Request demo exclusion (Q12, Q7) | open-dashboards |

All 7 edge-case rows are covered (020, 021, 022, 023, 024-028, 018, 015).

Unverified/flagged: 006, 007 (Export not executed in explore), 012 (no flow), 014-016 (Save not executed), 019, 031-033 (no flow), and all Unconfirmed-assumption cases.
