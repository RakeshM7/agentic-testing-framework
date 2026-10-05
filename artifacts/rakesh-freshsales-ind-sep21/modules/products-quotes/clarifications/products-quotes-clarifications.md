# Clarifications: Products and Quotes (track products-quotes)

Sources: `explore/flows/index.json`, `clarifications/pass1-questions.json`, `clarifications/answers-block.md`. No requirement docs.

## Feature summary
Verify, create, edit, clone, delete and navigate Products (list, create, clone, edit, delete, toolbar menus), CPQ Settings, Document Templates (list, create-template validation) and Quotes (add from + menu, detail, delete, Quotes list) in the Freshsales trial tenant. Covers all 13 flows in `explore/flows/index.json`.

## In scope / Out of scope
In scope:
- All 13 explored flows: view-products-list, create-product, clone-product, edit-product, delete-product, product-list-toolbar-menus, view-cpq-settings, view-document-templates, create-template-validation, add-quote, view-quote-detail, delete-quote, view-quotes-list.
- Unexplored quote flows (answer "yes"): Edit quote overlay, Clone quote, Preview, Save PDF, stage transitions, Add or edit products Save. Use only run-created deals so no pre-existing deal is touched.
- Quotes list Filters, Edit columns, sorting, Manage Quote types, Customize fields, Products category filter and bulk actions (answer "yes").
- Subscription-type products and multi-currency prices (answer "yes", details unconfirmed, see Open questions).
- Recycle Bin verification and restore after product/quote delete (answer "yes").
- A product already used on a quote being edited, deactivated or deleted (answer "yes", expected quote behaviour unconfirmed).

Out of scope: none declared. Execution of Send to customer and Import products is unresolved (see Open questions).

## Active authorization mode
`authorizations.mode: full-run` (set explicitly by the user for their own trial tenant). Basis for every execution ruling below.
- (a) Submissions that could succeed and mutate data: executed live. Deletes/cancels only for entities this run created (tracked in `created-entities.json`).
- (b) Submissions expected to be blocked by validation before any mutation (blank Template name, blank Quote type, blank/duplicate product name, blank Unit price on clone, Send to customer with mandatory fields empty): not mutating, run live.

## Confirmed behaviors
- Send to customer: mandatory fields are highlighted on the page; fill them and retry the send. (Q: Send to customer rules.) The exact field list, stage transitions and email behaviour were not described.
- Adding products to a quote with "Add products to deals" on overrides the linked deal's amount. (Q: Add or edit products.) What "Sync quote with deal" changes was not answered.
- Duplicate product names are blocked on create and clone. (Q: duplicate names/codes.) Product code/SKU duplicate behaviour was not stated.
- Quotes have no left-nav entry and are reachable via URL or the + menu (answer "yes" to the reachability part).
- Quote create/delete tests may use run-created throwaway Deal and Primary contact, deleted at cleanup (answer "yes"; see Open questions on ambiguity).
- Quote creation requires Deal* and Primary contact*; Quote type* and Quote template* are also required (from the add-quote flow).
- Product Pricing type cannot be changed after creation (edit-product flow). Clone does not copy Unit price and requires it (clone-product flow).
- Deleting a product or quote moves it to the Recycle Bin for 90 days (flows delete-product, delete-quote).
- CPQ Settings Pricing radios appear disabled for this account; tests assert the read-only state and do not change settings (answer "yes").

## Edge cases
| Scenario | Expected behavior |
|---|---|
| Create product with a name that already exists | Blocked (duplicate product names blocked on create) |
| Clone product keeping the pre-filled name | Blocked (duplicate names blocked on clone); Unit price empty is also required |
| Clone product without Unit price | Required-field error; exact message unconfirmed |
| Send quote with mandatory fields empty | Mandatory fields highlighted; send does not proceed; fill and retry succeeds |
| Add or edit products on a quote with "Add products to deals" on | Linked deal's amount is overridden (use run-created deal only) |
| Delete product or quote | Disappears from list; appears in Recycle Bin; restorable |
| Edit/deactivate/delete a product already on a quote | Covered by tests; expected quote behaviour unconfirmed |
| Create template with blank Template name or blank Quote type | Blocked; message text unconfirmed |
| Edit existing product Pricing type | Radios disabled |
| Open CPQ Settings Pricing radios | Disabled; assert read-only only |
| Negative/non-numeric Unit price, max Name length, Product code/SKU uniqueness | Rules and messages unconfirmed |

## Non-functional constraints
None raised. Quotes list is URL/+ menu reachable only (no left-nav entry).

## Confirmed test-case output format
CSV

## Open questions
1. Non-answer: Q "why do Quotes have no left-nav entry" got a bare "yes"; the reason is not known. Reachability via URL/+ menu is accepted.
2. Ambiguous: Q "may the run create its own throwaway Deal and Contact, or must a specific pre-existing deal be used" got a bare "yes" to an either/or question. Treated as run-created prerequisites (consistent with full-run mode and the next answer) but needs human confirmation.
3. Non-answer: Q "Send to customer and Import products: generated but excluded from live execution, or executed live with a designated email/CSV (name it)" got a bare "yes". No test email address or CSV file was named. Until named, Send to customer success and Import products must not be executed live (generate cases only); validation-blocked Send (case b) may run live.
4. Non-answer: Q "Create template: expected validation messages for blank Template name and blank Quote type" got "yes". Creating a real run-created template and deleting it is accepted; messages are not provided (record observed messages at execution).
5. Non-answer: Q "Create product validation rules and messages (required fields, negative/non-numeric price, max Name length, SKU uniqueness)" got "yes". Only duplicate-name blocking is confirmed elsewhere. No rules or messages are specified.
6. Non-answer: Q "Subscription pricing and multi-currency, or only One-time" got "yes" to an either/or. Treated as including both, but billing cycle/term fields and currency expectations are unspecified.
7. Non-answer: Q "Recycle Bin verification and restore, or disappearance sufficient" got "yes" to an either/or. Treated as including Recycle Bin check and restore (restore is a mutation on a run-created entity only); confirm.
8. Non-answer: Q "product already used on a quote edited, deactivated or deleted, expected behaviour for the quote" got "yes"; no expected behaviour supplied.
9. Unanswered detail: Send to customer field list ("2 fields to be filled"), Draft > Sent > Accepted/Declined transition rules, and email behaviour.
10. Unanswered detail: what "Sync quote with deal" changes.
11. Unanswered detail: whether duplicate Product code/SKU is blocked.
12. Unanswered: why CPQ Pricing radios are disabled (plan/permission restriction); only the read-only assertion is agreed.
13. Coverage gaps from explore: Import products and Import history not opened; Edit quote, Clone quote, Preview, Save PDF, stage transitions and Add or edit products Save not reached live.
14. No contradictions found among answers; the only tension is full-run mode versus the unresolved live-execution of Send to customer/Import (resolved conservatively in item 3).

## Follow-up Questions
- [Behavior] [Blocking] Which test email address (and which CSV file for Import products) may be used for live Send to customer and Import products, or should those two be generated but never executed live? Navigate: Quote detail > Send to customer (flow view-quote-detail); Products > Add product dropdown arrow > Import products (flow product-list-toolbar-menus).
- [Behavior] [Blocking] What are the exact messages for blank Template name and blank Quote type when saving Create template? Navigate: Admin Settings > Document Templates > Create template > Save with fields empty (flow create-template-validation).
- [Behavior] [Nice-to-have] What error is shown for a duplicate Product name on create and on clone, and are duplicate Product code/SKU values allowed? Navigate: Products > Clone (flow clone-product) and Products > Add product (flow create-product).
- [Behavior] [Nice-to-have] What happens to a quote's line items and totals when a product used on it is deactivated or deleted? Navigate: Quote detail > Add or edit products (flow view-quote-detail), then Products > product > kebab > Delete (flow delete-product).
