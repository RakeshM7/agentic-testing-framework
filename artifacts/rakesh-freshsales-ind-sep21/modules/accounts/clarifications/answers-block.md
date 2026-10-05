# Answers block for module accounts (human answers, verbatim)

## From run-config
- Test-case output format: CSV (config testcases.output_format and answers entry "output format").
- authorizations.mode: full-run (set explicitly by the user for their own trial tenant); deletes only for entities the run created.

## Answers from open-questions.csv (explorer questions, answered by the human)
- Q: [Behavior][Nice-to-have] Should the Phone field reject non-numeric input such as 'abc'? It was accepted without an error in the Add account form.
  A: It should reject, if the application accepts, then create a bug and add a playwright test that fails intentionally during the playwright automation script agent
- Q: [Behavior][Nice-to-have] Are duplicate account names allowed, and what does 'Check for duplicates' / Clone do on save when the name already exists?
  A: Duplicate account name not allowed
- Q: [Behavior][Nice-to-have] Can new tags be created from the account Tags field, or only chosen from existing tags defined elsewhere?
  A: Can be created newly
- Q: [Behavior][Nice-to-have] Bulk actions immediately selects all rows when clicked with none selected; is this intended and what is the Cancel button behaviour when the filter drawer is open (clipped)?
  A: It is the intended behaviour, cancel behaviour must close the filter drawer while retaining the current filter

## Answers from the clarification answer sheets (Pass 1 questions)
- Q: [Behavior][Nice-to-have] Does deleting an account with the checkbox 'Delete all the related contacts and deals' also soft-delete those into their Recycle Bins, and can they be restored together?
  A: Yes
- Q: [Scope][Blocking] In full-run mode, may tests execute the Import accounts flow live (e.g. a small CSV of uniquely named ZZ test accounts, later deleted), or should import be generated but not executed, or excluded entirely?
  A: execute the Import accounts flow live
- Q: [Scope][Blocking] Should bulk-action tests (Update field, Add tags, Assign to, Add to sequence, Merge, Delete) be executed live only against accounts the run itself created (never the 15 pre-existing tenant accounts), given Bulk actions select-alls on open?
  A: executed live only against accounts the run itself created
- Q: [Edge Case][Nice-to-have] What are the Name field rules beyond non-empty: max length, leading/trailing whitespace trimming, special characters, and case-insensitivity of the duplicate check?
  A: No other rules
- Q: [Edge Case][Nice-to-have] Which Website formats must be accepted vs rejected (with/without http(s)://, www., bare domain, spaces), given only an invalid value produced the toast 'The value for website is not in required format'?
  A: Only www.<domain>.<com/net/any random text>
- Q: [Behavior][Nice-to-have] Should tests cover Recycle Bin restore and permanent delete, and the row-menu Forget action, on run-created accounts, and what are the expected outcomes (restore location, confirmation text, retention of 90 days)?
  A: Yes
- Q: [Scope][Nice-to-have] Should detail-page sub-actions not yet explored (Add parent account, Add note, Add contact/deal from account, Files upload, inline edit in Account details) be in scope for test cases beyond view-account-detail?
  A: Yes
- Q: [Behavior][Nice-to-have] What are the expected sort, per-page, and filter-operator behaviors for the Accounts list (e.g. default sort, page sizes, operators available for Name), since these were not explored?
  A: 10 / 25 / 50 / 100 per page. Sort can be any header having the sort caret icon
- Q: [Behavior][Nice-to-have] For validation-only negative cases (empty Name, invalid Website, non-numeric Phone, duplicate Name) that are blocked before any mutation, confirm they may run live in all modes, and that for the Phone case a failing assertion marks a known bug rather than a test defect?
  A: Confirm to run live in all modes
