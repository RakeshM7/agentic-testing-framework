# Accounts test cases summary (track: accounts)

File: `accounts-testcases.csv` (49 cases). Columns: ID, Title, Category, Priority, Flow, Preconditions, Steps, Expected Result, Flags. All run-created data uses the `ZZ` name prefix; destructive steps touch only those records. Flagged "Unconfirmed" cases are assumptions per the Pass 2 follow-up defaults (assume-standard-and-flag).

## Counts
| Category | Count |
|---|---|
| Happy | 30 |
| Negative | 13 |
| Boundary | 6 |
| Total | 49 |

| Priority | Count |
|---|---|
| P0 | 10 |
| P1 | 18 |
| P2 | 21 |

## Traceability matrix
| Test case | Flow | Clarification / edge-case item |
|---|---|---|
| 001 | view-accounts-list | In scope: flow 1; observed baseline columns |
| 002 | switch-account-view | Flow 2; views list |
| 003 | filter-accounts | Flow 3; open question 1 (operators) |
| 004 | customize-account-table | Flow 4 |
| 005 | bulk-select-accounts | Edge: bulk with no selection; answer 4; safety scoping |
| 006 | account-row-menu | Flow 6 |
| 007, 008 | create-account | Flow 8; Website `www.` accepted; Phone `+` format |
| 009 | view-account-detail | Flow 9; sub-tabs |
| 010 | edit-account | Flow 10 |
| 011 | clone-account | Flow 11 (unconfirmed save) |
| 012 | add-account-tag | Flow 12 |
| 013 | add-account-tag | Edge: add tag with new name; open question 2 |
| 014 | delete-account | Flow 13 |
| 015 | delete-account | Edge: delete with related contacts/deals checked |
| 016, 017 | delete-account | In scope: Recycle Bin restore / permanent delete; open question 1 |
| 018 | account-row-menu | In scope: row-menu Forget |
| 019 | import-accounts | In scope: Import live; open question 7 |
| 020-025 | bulk-select-accounts | In scope: bulk actions live (Update field, Add tags, Assign to, Add to sequence, Merge, Delete); open questions 8, 9 |
| 026-030 | view-account-detail | In scope: detail sub-actions (parent account, note, contact, deal, Files, inline edit) |
| 031 | view-accounts-list | Edge: sort by header with caret |
| 032 | view-accounts-list | Edge: per-page selector |
| 033 | bulk-select-accounts | Edge: Cancel with Filters drawer open; open question 5 |
| 034 | create-account | Edge: empty Name |
| 035 | create-account | Edge: invalid Website |
| 036 | create-account | Edge: Phone `abc` (known bug, answer 1) |
| 037 | create-account | Edge: duplicate Name (answer 2) |
| 038 | clone-account | Edge: duplicate Name on Clone-save; open question 3 |
| 039 | create-account | Follow-up Q1 (case-insensitivity) |
| 040-042 | create-account | Open question 4 / follow-up Q4 (Website variants) |
| 043, 044 | edit-account | Name required and unique rules extended to edit (assumption) |
| 045 | import-accounts | Open question 7 (duplicate in import) |
| 046 | filter-accounts | Observed 2-character minimum |
| 047 | create-account | Edge: Website `www.<domain>.<tld>` accepted |
| 048 | create-account | Open question 4 (empty Website) |
| 049 | create-account | Edge: Name any length/whitespace/special chars (acceptance only; no negative tests) |

Every edge-case table row is covered: empty Name (034), invalid Website (035), valid Website (047), Phone abc (036), duplicate Name (037, 038), Name any chars (049), new tag (013), bulk no selection (005), Cancel with drawer (033), cascade delete (015), per-page (032), sort (031).

## Notes
- Flows marked not executed in explore (import-accounts, bulk actions beyond opening, clone save, tag creation) and the not-yet-explored sub-actions yield cases flagged "Unconfirmed".
- TC-accounts-036 is a known-bug case expected to fail; TC-accounts-013 conflicts with explore observation.
- Executing any case that may save (036-042, 044, 045) requires cleanup of any record created, tracked in created-entities.json.
