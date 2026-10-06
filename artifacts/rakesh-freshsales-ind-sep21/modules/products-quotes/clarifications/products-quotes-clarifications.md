# Clarifications: Products and Quotes (track products-quotes)

Sources: `explore/flows/index.json`, `clarifications/pass1-questions.json`, `clarifications/answers-block.md`, `clarifications/answers-block-round2.md` (round 2 folded in). No requirement docs.

## Feature summary
Verify, create, edit, clone, delete and navigate Products (list, create, clone, edit, delete, toolbar menus), CPQ Settings, Document Templates (list, create-template validation) and Quotes (add from + menu, detail, delete, Quotes list) in the Freshsales trial tenant. Covers all 13 flows in `explore/flows/index.json`.

## In scope / Out of scope
In scope:
- All 13 explored flows: view-products-list, create-product, clone-product, edit-product, delete-product, product-list-toolbar-menus, view-cpq-settings, view-document-templates, create-template-validation, add-quote, view-quote-detail, delete-quote, view-quotes-list.
- Unexplored quote flows (answer "yes", round 1 and 2): Edit quote overlay, Clone quote, Preview, Save PDF, stage transitions, Add or edit products Save. Use only a run-created deal so no pre-existing deal is touched.
- Quotes list Filters, Edit columns, sorting, Manage Quote types, Customize fields, Products category filter and bulk actions (answer "yes").
- Subscription-type products and multi-currency prices (answer "yes", details unconfirmed, see Open questions).
- Recycle Bin verification and restore after product/quote delete (answer "yes").
- A product already used on a quote being edited, deactivated or deleted (answer "yes", expected quote behaviour unconfirmed).

Out of scope for live execution: Send to customer success path and Import products (generated as cases only, see Open questions 3).

## Active authorization mode
`authorizations.mode: full-run` (set explicitly by the user for their own trial tenant). Basis for every execution ruling below.
- (a) Submissions that could succeed and mutate data: executed live, except Send to customer success and Import products (see below). Deletes/cancels only for entities this run created (tracked in `created-entities.json`). Save of quote products only on a run-created deal.
- (b) Submissions expected to be blocked by validation before any mutation (blank Template name, blank Quote type, blank/duplicate product name, blank Unit price on clone, Send to customer with mandatory fields empty): not mutating, run live.

## Confirmed behaviors
- Send to customer: mandatory fields are highlighted on the page; fill them and retry the send. (Q: Send to customer rules.) The exact field list, stage transitions and email behaviour were not described.
- Adding products to a quote with "Add products to deals" on overrides the linked deal's amount. (Q: Add or edit products.) What "Sync quote with deal" changes was not answered.
- Duplicate product names are blocked on create and clone. (Q: duplicate names/codes.) Product code/SKU duplicate behaviour was not stated.
- Quotes have no left-nav entry and are reachable via URL or the + menu.
- Quote prerequisites: a run-created throwaway Deal and Primary contact (deleted at cleanup). Round-2 answer was a bare "yes" to an either/or, so this is the flagged default (Open questions 2).
- Quote creation requires Deal* and Primary contact*; Quote type* and Quote template* are also required (from the add-quote flow).
- Product Pricing type cannot be changed after creation (edit-product flow). Clone does not copy Unit price and requires it (clone-product flow).
- Deleting a product or quote moves it to the Recycle Bin for 90 days (flows delete-product, delete-quote).
- CPQ Settings Pricing radios appear disabled for this account; tests assert the read-only state and do not change settings.
- Round 2 (answers-004 follow-up): for test data requiring an email address, generate a faker email (human answer "Create a faker email"). This supplies data only; it does not designate a real mailbox, so live execution rules in Open questions 3 still apply.

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Create product with a name that already exists | Blocked (duplicate product names blocked on create) |
| Clone product keeping the pre-filled name | Blocked (duplicate names blocked on clone); Unit price empty is also required |
| Clone product without Unit price | Required-field error; exact message unconfirmed |
| Send quote with mandatory fields empty | Mandatory fields highlighted; send does not proceed; fill and retry succeeds (success path generated, not run live) |
| Add or edit products on a quote with "Add products to deals" on | Linked deal's amount is overridden (run-created deal only) |
| Delete product or quote | Disappears from list; appears in Recycle Bin; restorable (run-created entities only) |
| Edit/deactivate/delete a product already on a quote | Covered by tests; expected quote behaviour unconfirmed, record observed behaviour as unconfirmed |
| Create template with blank Template name or blank Quote type | Blocked; message text unconfirmed, capture observed text at execution and flag as unconfirmed |
| Edit existing product Pricing type | Radios disabled |
| Open CPQ Settings Pricing radios | Disabled; assert read-only only |
| Negative/non-numeric Unit price, max Name length, Product code/SKU uniqueness | Rules and messages unconfirmed; flag-as-unconfirmed cases, assert only that submission is rejected/accepted as observed |

## Non-functional constraints
None raised. Quotes list is URL/+ menu reachable only (no left-nav entry).

## Confirmed test-case output format
CSV

## Open questions
1. Non-answer: why Quotes have no left-nav entry (bare "yes", rounds 1 and 2). Reason unknown; reachability via URL/+ menu accepted.
2. Non-answer: run-created throwaway Deal/Contact vs. pre-existing deal (bare "yes" to either/or, rounds 1 and 2). Default assumption (flagged): run-created Deal and Primary contact are the prerequisites; no pre-existing deal is used or modified.
3. Partial answer: live Send to customer / Import products. Human said "Create a faker email" but named no real designated mailbox and no CSV for Import. Default assumption (flagged): Send to customer success and Import products are generated but NOT executed live; validation-blocked Send runs live. A faker email is used as test data in the generated cases. Human may later designate a real test mailbox and CSV to enable live execution.
4. Non-answer: blank Template name / blank Quote type messages. Round 2 answer "Explore and find out". Default assumption (flagged): messages unconfirmed; the executing agent records observed text, and cases assert only that save is blocked. Creating a real run-created template and deleting it is accepted (bare "yes").
5. Non-answer: Create product validation rules (required fields, negative/non-numeric price, max Name length, SKU uniqueness), bare "yes". Only duplicate-name blocking confirmed. Default: flag-as-unconfirmed cases.
6. Non-answer: Subscription pricing and multi-currency vs only One-time, bare "yes" to either/or. Default: include both; billing cycle/term fields and currency expectations unspecified (assume-standard-and-flag). Note CPQ Pricing radios are disabled, so Subscription may be unavailable on this account; cases skip with a recorded reason if so.
7. Non-answer: Recycle Bin verification and restore vs disappearance only, bare "yes". Default: include Recycle Bin check and restore of run-created entities; confirm.
8. Non-answer: expected quote behaviour when a used product is edited, deactivated or deleted, bare "yes". Default: flag-as-unconfirmed.
9. Unanswered detail: Send to customer field list ("2 fields to be filled"), Draft > Sent > Accepted/Declined transition rules, email behaviour.
10. Unanswered detail: what "Sync quote with deal" changes.
11. Unanswered detail: whether duplicate Product code/SKU is blocked.
12. Unanswered: why CPQ Pricing radios are disabled (plan/permission restriction); only the read-only assertion is agreed (bare "yes").
13. Coverage gaps from explore: Import products and Import history not opened; Edit quote, Clone quote, Preview, Save PDF, stage transitions and Add or edit products Save not reached live.
14. No contradictions found; the tension between full-run mode and unresolved live Send/Import is resolved conservatively in item 3.

## Follow-up Questions
- [Behavior] [Nice-to-have] Which real test mailbox and which CSV file (if any) may be used to run Send to customer and Import products live, given a faker email cannot receive mail? Navigate: Quote detail > Send to customer (flow view-quote-detail); Products > Add product dropdown arrow > Import products (flow product-list-toolbar-menus).
- [Behavior] [Nice-to-have] What happens to a quote's line items and totals when a product used on it is deactivated or deleted? Navigate: Quote detail > Add or edit products (flow view-quote-detail), then Products > product > kebab > Delete (flow delete-product).
