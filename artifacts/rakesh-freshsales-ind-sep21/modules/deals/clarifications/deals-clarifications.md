# Deals module clarifications (track: deals)

Sources: explore artifacts in `modules/deals/explore/` (21 flows in `flows/index.json`), `clarifications/pass1-questions.json`, `clarifications/answers-block.md` (round 1, verbatim), `clarifications/answers-block-round2.md` (round 2, verbatim).

## Feature summary
Verify create / edit / delete, stage movement, Won/Lost, Commit, products, tasks, clone, bulk actions, Recycle Bin, and search/navigation of Deals in Freshsales across Pipeline (kanban), Table and Forecast views (plus Group by and saved views). Default Pipeline stages: New > Qualification > Discovery > Demo > Negotiation > Won / Lost. Observed account: Rakesh M, Organization admin.

## In scope / Out of scope
In scope: every flow in `explore/flows/index.json` (open pipeline, switch view type, saved views, filter, table density/page size, create via Add deal, create in stage column, drag between stages, change stage on detail, mark Won/Lost, Commit, edit, add product, add task, call/meeting forms, detail tabs, clone, delete, Recycle Bin view, Settings menu, bulk actions).
Out of scope / not confirmed: see Open questions. The scope question (Group by, Add new saved view, Import deals, 13 other saved views, note/quote/file/Discussions tabs) received a bare "Yes" that does not say which are in scope; treated as unresolved (O6) with a flagged default. Import deals was marked out of scope by explore.

## Authorization basis
`authorizations.mode` = full-run (set explicitly by the user for their own trial tenant).
- (a) Submissions that can succeed and mutate data: executed live, but only on deals/entities the run itself created. Deletes/Forget/bulk-delete only on run-created entities.
- (b) Submissions expected to be blocked by validation before mutation (empty Deal name, negative Deal value, Commit without Expected close date, Lost without Lost reason): permitted to run live in all modes.
- Bulk actions: run only with a selection consisting solely of run-created deals (explore observed the bulk action button selects all rows, so selection must be narrowed explicitly or via a filter before any destructive bulk action).

## Confirmed behaviors
- B1. Negative Deal value (e.g. -5) must NOT be accepted on create. (Round 1: negative deal value; answer "no".) Conflicts with explore observation, see Contradictions.
- B2. Lost reason is mandatory when marking a deal Lost, as defined by field dependencies in Admin Settings > Deal forms; an admin can make it optional. Tests must treat this as config-dependent and check the Deal forms setting first. (Round 1: Lost reason.)
- B3. Bulk actions offered = exactly the actions shown in the top bar when deals are selected; which roles may use them is governed by Admin Roles and Permissions. (Round 1: bulk actions.)
- B4. Once products are added to a deal, Deal value cannot be edited manually (it equals the product total). (Round 1: deal value with products.) Consistent with explore note that adding products overrides value.
- B5. Test-case output format: CSV (run-config `testcases.output_format`).
- B6. Mode is full-run with deletes scoped to run-created entities (run-config).
- Round 2 added no new confirmed behaviors: the only round-2 answer ("Explore and find out") is a non-answer, handled under Open questions O1, O2, O3, O7.
- Explore-observed behaviors (not human-contested; carry as observed, not spec-confirmed): Deal name required ("Can't be empty"); Deal value default 0; Currency USD disabled; Sales owner defaults to current user; new deal lands in stage New unless created from a column "+"; stage moves show toast "Deal updated."; Commit deal requires Expected close date and sets Forecast category Committed; Closed date auto-set to today on Won/Lost; Delete is soft with Recycle Bin retention of 90 days (Restore / Forget available); kanban Won and Lost are separate columns; unapplied filter panel close prompts Apply/Discard.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Create deal with negative value (-5) | Rejected (per human answer). Exact message not provided; do not assert text. |
| Create deal with empty Deal name | Blocked, "Can't be empty" (explore-observed). |
| Mark Lost with empty Lost reason, field dependency on | Blocked (mandatory per Deal forms). |
| Mark Lost with empty Lost reason, admin made it optional | Allowed. Only testable if the setting is changed, which is an admin change outside this module's created entities: do not alter without approval. |
| Edit Deal value after product added | Value field not editable. |
| Commit deal with no Expected close date | Blocked (explore-observed that date is needed); exact message not confirmed. |
| Bulk action selection | Actions match top-bar set; role-dependent. |
| Delete deal | Moves to Recycle Bin (soft). |
| Field limits (Name length, Value max, Probability range) | Unconfirmed (O7). Flagged default: probe boundaries at test time and record observed behavior; do not hard-assert limits. |

## Non-functional constraints
- Role/permission: all observations were as Organization admin; non-admin behavior untested and governed by Roles and Permissions.
- No performance or accessibility requirements were raised.

## Contradictions recorded (not silently resolved)
- C1. Explore observed a negative Deal value (-5) accepted and displayed "$-5"; human answer says it must not be accepted. Treat the human answer as the spec; the negative-value test is an expected-fail/defect candidate against current tenant behavior.
- C2. Explore observed Lost reason optional; human answer says mandatory per Deal forms field dependencies and configurable. Likely tenant configuration difference rather than a true contradiction; the Deal forms setting in this tenant has not been inspected. Tests should not hard-assert either until the setting is read.

## Confirmed test-case output format
CSV

## Open questions
Round-2 resolution note: the round-2 answer "Explore and find out" (to the Forecast / Won-Lost / Commit / field-limits question) is a non-answer, not a spec. Per config defaults (assume-standard-and-flag / flag-as-unconfirmed-case), O1, O2, O3 and O7 each carry an explicit flagged default assumption below. Testcases derived from these defaults must be marked "unconfirmed" and assert only what explore observed live; they must not be treated as spec.

Unresolved items:
- O1. Forecast view totals: how computed (open vs committed vs weighted by probability, grouped by Forecast category, Month vs Quarter). Answer round 1 "Yes", round 2 "Explore and find out". FLAGGED DEFAULT: assume standard Freshsales behavior, i.e. column totals sum Deal value of deals by Forecast category within the selected period; tests assert only that totals are consistent with the visible deals' values for run-created deals, flagged unconfirmed. No formula assertion beyond that.
- O2. Mark Won / drag into Won or Lost column: required fields, Closed date, stage/probability/forecast category changes, and whether kanban drag uses the same modal as the detail button. Round 1 "Yes", round 2 "Explore and find out". FLAGGED DEFAULT: assume standard behavior (stage becomes Won/Lost, Closed date set to today as explore observed, Lost prompts for Lost reason per B2); assert only explore-observed outcomes; probability and forecast category changes on Won/Lost flagged unconfirmed.
- O3. Commit deal: exact validation text when Expected close date is empty; existence and target value of Remove commit. Round 1 "Yes", round 2 "Explore and find out". FLAGGED DEFAULT: assert only that the commit is blocked (no exact text) and, if a Remove commit control exists at run time, that it reverts Forecast category from Committed; flagged unconfirmed.
- O4. Duplicate deal names on create and Clone save: allowed, blocked or warned? Round 1 "Yes" (ambiguous). FLAGGED DEFAULT: assume allowed (standard CRM behavior); flagged unconfirmed case.
- O5. Recycle Bin: does Restore return the original stage and fields; may tests Forget run-created deals? "Yes" ambiguous for the first part. Full-run rule already allows Forget on run-created deals only. FLAGGED DEFAULT: assume Restore returns the deal with original stage and fields; flagged unconfirmed.
- O6. Scope of Group by, Add new saved view, Import deals, the 13 other saved views, Add note/quote/file and Discussions tabs. FLAGGED DEFAULT: include Group by, saved views and tabs as read-only navigation checks; exclude Import deals.
- O7. Field limits: max Deal name length, max Deal value, Probability range (0-100?) and validation messages. Round 1 "Yes", round 2 "Explore and find out". FLAGGED DEFAULT: assume Probability 0-100 and no asserted Name/Value maxima; boundary tests marked unconfirmed, recording observed behavior.
- O8. Exact validation message for negative Deal value (B1 gives only rejection). Default: assert rejection only.
- O9. Whether this tenant's Deal forms has Lost reason mandatory (C2). Default: read the setting (read-only) before asserting either way.

Coverage gaps from explore (not re-asked): bulk actions never clicked, Add new view form, contents of 12 other saved views, Quotas and Forecasting page, Clone save, Remove commit, Won path, Restore/Forget, Add note/quote/file, Discussions, Group by results, product Add new product, Negotiation/Won/Lost columns off-screen on pipeline, network-requests.json empty (so API behavior not captured).

## Follow-up Questions
- [Behavior][Nice-to-have] Is the Lost reason field dependency in Admin Settings > Deal forms currently mandatory in this tenant, given explore saw it as optional? Navigate: Admin Settings > Deal forms > field dependencies; Deals > <deal> > Won/Lost > Lost (flow mark-deal-lost).
- [Edge Case][Nice-to-have] Are duplicate deal names allowed or blocked on create and Clone save (please answer "allowed" or "blocked")? Navigate: Deals > <deal> > kebab > Clone (flow clone-deal-form).
- [Behavior][Nice-to-have] Is the negative Deal value acceptance seen in explore a known product defect to be logged as an expected failure, and what message should be expected? Navigate: Deals > Add deal > Deal value (flow create-deal-from-add-deal-button).
