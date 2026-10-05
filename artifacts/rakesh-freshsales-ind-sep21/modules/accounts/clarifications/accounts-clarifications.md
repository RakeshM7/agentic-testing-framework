# Accounts module clarifications (track: accounts)

Sources: explore/ flows + module-summary + crawl-log, and the verbatim human answers in `clarifications/answers-block.md`. Active mode: `authorizations.mode = full-run` (set explicitly by the user for their own trial tenant).

## Feature summary
Verify create / edit / clone / delete, search/filter and navigation of Accounts in Freshsales (tenant rakesh-freshsales-ind-sep21), covering all 13 flows in `explore/flows/index.json`: view-accounts-list, switch-account-view, filter-accounts, customize-account-table, bulk-select-accounts, account-row-menu, import-accounts, create-account, view-account-detail, edit-account, clone-account, add-account-tag, delete-account. Entity fields: Name (required), Website, Phone, Sales owner, Industry type, Business type, Number of employees, Tags, Annual revenue, Territory, Parent account, etc. No requirement documents exist; the explored UI plus the answers are the spec.

## In scope / Out of scope
In scope:
- All 13 explored flows.
- Import accounts executed live (small CSV of uniquely named test accounts, later deleted).
- Bulk actions (Update field, Add tags, Assign to, Add to sequence, Merge, Delete) executed live, only on accounts the run created.
- Recycle Bin restore and permanent delete, and row-menu Forget, on run-created accounts.
- Detail-page sub-actions not yet explored: Add parent account, Add note, Add contact/deal from account, Files upload, inline edit in Account details.
- List sorting (any header with a sort caret) and per-page sizes.
- Validation-only negative cases.

Out of scope / not authorized:
- Any modify/delete/forget/merge/bulk action on the 15 pre-existing tenant accounts (5 AgentTest Co, Explore Test Co, 9 samples). The run may only delete/forget/merge entities it created (tracked in `created-entities.json`).
- Related contacts/deals deleted via the cascade checkbox must also be run-created.

## Confirmed behaviors
- Output format and mode: CSV; full-run, deletes only for run-created entities (run-config).
- Phone: must reject non-numeric input such as `abc` (answer 1). Current app accepts it. If the app accepts, record a bug and have playwright-automation-agent add a Playwright test that fails intentionally (known-bug marker, not a test defect).
- Account Name must be unique; duplicate names are not allowed (answer 2). Applies to create and Clone-save.
- Tags: new tags can be created from the account Tags field (answer 3).
- Bulk actions selecting all rows on click when none are selected is intended (answer 4). Cancel, when the filter drawer is open, must close the filter drawer while retaining the current filter.
- Deleting an account with "Delete all the related contacts and deals" also soft-deletes those into their Recycle Bins and they can be restored together (yes).
- Import accounts is executed live (yes).
- Bulk-action tests are executed live only against run-created accounts (yes).
- Name has no rules beyond non-empty (no max length, trim, special-char rules) (answer: "No other rules").
- Website: only `www.<domain>.<com/net/any random text>` is accepted (see Edge cases and Open questions on interpretation). Observed: invalid value gives toast `Failed to create Account. The value for website is not in required format.`
- Recycle Bin restore, permanent delete and row-menu Forget are to be covered on run-created accounts (yes).
- Detail-page sub-actions listed above are in scope (yes).
- List per-page sizes: 10 / 25 / 50 / 100. Sorting is available on any column header showing the sort caret icon.
- Validation-only negative cases (empty Name, invalid Website, non-numeric Phone, duplicate Name) may run live in all modes (confirmed).

Observed baseline (from explore, not an answer): empty Name shows `can't be empty` under the field plus banner `Review 1 field for errors`; successful create lands on /crm/sales/accounts/<id> Overview; soft delete goes to Recycle Bin for 90 days; row kebab: Edit all fields, Add meeting, Add call log, View all related contacts, Clone, Delete, Forget; views: My accounts, All accounts, Recycle Bin, My territory accounts, Recently imported, Accounts with me in account team.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Create with empty Name | Blocked; `can't be empty` under Name and banner `Review 1 field for errors`. Runs live in all modes (non-mutating). |
| Website not matching `www.<domain>.<tld>` (e.g. `not a url`) | Blocked; toast `Failed to create Account. The value for website is not in required format.` Runs live in all modes. |
| Website `www.modexplore-acct.com` style | Accepted. |
| Phone `abc` | Expected: rejected. Actual (explore): accepted. Test asserts rejection; failure = known bug (intentionally failing test). |
| Create/Clone with a Name that already exists | Expected: rejected (no duplicate). Exact message not captured. If the app instead saves, it is a bug and the extra record is run-created and must be cleaned up. |
| Name with any length/whitespace/special chars | No extra rules; no negative tests to be generated. |
| Add tag with a new name | Expected: tag is created and applied. |
| Bulk actions clicked with no selection | All rows on the page are selected (e.g. `15 accounts selected.`); intended. Tests must first ensure only run-created rows are selectable (e.g. filter to run-created names) before any bulk action executes. |
| Cancel in bulk toolbar with Filters drawer open | Filter drawer closes; current filter remains applied. |
| Delete with "Delete all related contacts and deals" checked | Account, and related run-created contacts/deals, go to their Recycle Bins; restorable together. |
| Per-page selector | Options 10, 25, 50, 100. |
| Sort by header with caret | Sorting applies for any such header. |

## Non-functional constraints
- Auth: org admin (Rakesh M) via session state; no credentials in prompts.
- Safety: full-run; destructive actions (delete, Forget, Merge, permanent delete, bulk delete) only on run-created entities. Execution ruling for (a) submissions that could succeed and mutate data: executed live in full-run, scoped to run-created data. (b) Validation-blocked submissions (empty Name, invalid Website, non-numeric Phone, duplicate Name): executed live in all modes including readonly. Caveat: the Phone and duplicate-Name cases are only non-mutating if the app rejects them; if it accepts them they create records that must be tracked and cleaned up.
- No accessibility/performance constraints raised.

## Confirmed test-case output format
CSV

## Open questions
1. Non-answers / unresolved items carried from the answers (not spec):
   - Filter operators for Name and default sort order of the list were asked but not answered (answer only gave page sizes and sortable headers). Coverage gap from crawl-log remains.
   - Recycle Bin restore / permanent delete / Forget: answer was "Yes" to coverage but expected outcomes (restore destination, confirmation text, 90-day retention check) were not stated; tests use observed UI text only.
   - Column-header menus, Add new view / Save view as, Customize overview, Manage fields, Call/Task/Meeting activities and Apps in marketplace remain unexplored and unanswered.
2. Contradiction: Tags answer ("can be created newly") conflicts with explore observation (typing a new name + Enter did not create a tag; control seemed choose-existing only). Recorded per the answer; the mechanism for creating a new tag is unknown.
3. Contradiction/ambiguity: Duplicate names "not allowed" vs. Clone drawer opening prefilled with the same name and a `Check for duplicates` control. Whether Clone-save is blocked outright or requires renaming, and whether the check is case-insensitive, is unspecified. Name "No other rules" does not address case-sensitivity.
4. Ambiguity: Website rule "www.<domain>.<com/net/any random text>" is read as: must start with `www.`, followed by a domain and any TLD text. Whether `http(s)://` prefixed values, bare domains (`example.com`) and values with spaces are rejected is implied (rejected) but not explicitly stated; the Website is also optional (empty accepted) per explore, unconfirmed.
5. Ambiguity: Bulk Cancel answer is read as "Cancel closes the filter drawer and keeps the filter"; unclear whether Cancel also clears the row selection.
6. Phone: no definition of valid phone formats (digits only? `+` and spaces such as observed `+18557476767`?). Only `abc`-style non-numeric is known to be invalid.
7. Import: CSV column mapping, required columns, duplicate-name handling during import, and whether imported accounts appear in "Recently imported" are not specified. Imported accounts and any created via bulk/merge must be tracked and removed.
8. Merge: expected outcome (surviving record, field resolution) not specified.
9. Add to sequence / Assign to: a target sequence and a target owner are needed; none defined. Sequences enrollment may touch another module.
10. The "intentionally failing Playwright test" for Phone depends on playwright-automation-agent; the bug-report location/format is unspecified.

## Follow-up Questions
- [Behavior][Nice-to-have] What exact error message appears when saving an account whose Name already exists, and is the check case-insensitive and also enforced on Clone-save and import? Navigate: Accounts > Add account > enter an existing account name > Save (flow create-account), and Accounts > <account> > kebab > Clone > Save (flow clone-account).
- [Behavior][Nice-to-have] How are new tags created in the account Tags field (type and press Enter, a "Create" option, or only via another settings screen), given typing a new name plus Enter did not create one during exploration? Navigate: Accounts > <account> > Click to add tags (flow add-account-tag).
- [Edge Case][Nice-to-have] Which Phone values are valid (digits only, leading `+`, spaces, dashes, length limits)? Navigate: Accounts > Add account > Show all fields > Phone (flow create-account).
- [Behavior][Nice-to-have] Which Website variants must be rejected: values with `http(s)://`, bare domains without `www.`, values containing spaces; and may Website be left empty? Navigate: Accounts > Add account > Website (flow create-account).
- [Behavior][Nice-to-have] Which Name filter operators should be tested and what is the default list sort? Navigate: Accounts > All accounts > Filter by (flow filter-accounts).
- [Behavior][Nice-to-have] For live Import, Merge, Assign to and Add to sequence tests, which CSV columns, target owner and sequence should be used, and how should duplicates in the import file be handled? Navigate: Accounts > Import accounts (flow import-accounts); Accounts > Bulk actions > Merge / Assign to / Add to sequence (flow bulk-select-accounts).
- [Behavior][Nice-to-have] Does Cancel in the Bulk actions toolbar also clear the row selection, in addition to closing the Filters drawer while keeping the filter? Navigate: Accounts > Filter by (open drawer) > Bulk actions > Cancel (flow bulk-select-accounts).
