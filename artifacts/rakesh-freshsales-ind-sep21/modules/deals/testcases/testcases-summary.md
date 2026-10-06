# Deals test cases summary

File: `deals-testcases.csv` (44 cases, 9 columns, every field double-quoted; no embedded double quotes).

## Counts by category
| Category | Count | IDs (TC-deals-NNN) |
|---|---|---|
| Happy | 29 | 001-004, 006-030 |
| Negative | 7 | 031, 032, 033, 035, 036, 037, 038 |
| Boundary | 8 | 005, 034, 039, 040, 041, 042, 043, 044 |

## Counts by priority
| Priority | Count | IDs |
|---|---|---|
| P0 | 6 | 001, 007, 015, 022, 031, 032 |
| P1 | 18 | 004, 008, 009, 010, 011, 012, 013, 016, 017, 021, 023, 024, 027, 028, 033, 036, 037, 044 |
| P2 | 20 | all others |

## Flags
- Unconfirmed assumptions (flagged defaults): 011, 014, 021, 024, 025, 029, 030, 037, 039, 040, 041, 042, 043.
- Unverified in explore (never executed): 027, 028.
- Config-dependent: 012, 033, 034 (read Deal forms setting first, O9).
- Defect candidate: 031 (explore accepted -5, spec says reject).
- Not executable without approval or extra credentials: 034 (admin setting change), 038 (non-admin account).

## Traceability matrix
| Test case | Covers |
|---|---|
| 001 | Flow open-deals-pipeline-view |
| 002 | Flow switch-deals-view-type |
| 003 | Flow select-saved-deal-view; O6 |
| 004, 005 | Flow filter-deals |
| 006 | Flow change-table-density-and-page-size |
| 007 | Flow create-deal-from-add-deal-button |
| 008 | Flow create-deal-in-stage-column |
| 009 | Flow move-deal-between-stages-by-drag |
| 010 | Flow change-deal-stage-on-detail |
| 011 | Flow mark-deal-lost (Won); O2 |
| 012 | Flow mark-deal-lost; B2; O9 |
| 013 | Flow commit-deal |
| 014 | Flow commit-deal (Remove commit); O3 |
| 015 | Flow edit-deal-all-fields |
| 016 | Flow add-product-to-deal; B4 |
| 017 | Flow add-task-to-deal |
| 018 | Flow open-deal-activity-forms |
| 019 | Flow browse-deal-detail-tabs; O6 |
| 020, 021 | Flow clone-deal-form |
| 022 | Flow delete-deal; edge row "Delete deal"; B6 |
| 023 | Flows view-deals-recycle-bin, delete-deal |
| 024, 025 | Recycle Bin Restore/Forget; O5; B6 |
| 026 | Flow deals-settings-menu |
| 027, 028 | Flow bulk-actions-deals; B3; edge row "Bulk action selection" |
| 029 | O1 (Forecast totals) |
| 030 | O6 (Group by) |
| 031 | Edge row "negative value"; B1; C1; O8 |
| 032 | Edge row "empty Deal name" |
| 033 | Edge row "Lost empty reason, dependency on"; B2; C2; O9 |
| 034 | Edge row "Lost empty reason, admin made optional"; B2 |
| 035 | Flow add-task-to-deal (validation) |
| 036 | Edge row "Edit Deal value after product added"; B4 |
| 037 | Edge row "Commit with no Expected close date"; O3 |
| 038 | Edge row "Bulk action selection" (role dependent); B3 |
| 039, 040 | O4 (duplicate names) |
| 041, 042, 043 | Edge row "Field limits"; O7 |
| 044 | Edge row "Bulk action selection"; safety rules |

All 9 edge-case table rows are covered. Not covered: Quotas and Forecasting page, Add note/quote/file submits, Discussions, Add new saved view, Import deals (out of scope).
