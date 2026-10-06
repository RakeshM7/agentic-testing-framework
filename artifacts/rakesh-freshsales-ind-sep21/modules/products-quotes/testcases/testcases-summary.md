# Test case summary: products-quotes

File: `products-quotes-testcases.csv` (CSV, 58 cases, 11 columns, every field quoted; Steps use " | " separators).

## Counts by category
| Category | Count |
|---|---|
| happy | 35 |
| negative | 5 |
| boundary (edge-case table rows and used-product cases) | 18 |

## Counts by priority
| Priority | Count |
|---|---|
| P0 | 7 |
| P1 | 24 |
| P2 | 27 |

## Execution mode
| Mode | Count |
|---|---|
| LIVE | 41 |
| LIVE (flow unverified in explore, flagged) | 14 |
| NOT EXECUTED LIVE (Send success 024, Import products 034, Import history 035) | 3 |

Send with mandatory fields empty (053) runs live. Cases with unconfirmed rules carry text in the Flags column (UNCONFIRMED / UNVERIFIED). Safety: only ZZ-prefixed and run-created entities (product, deal, contact, quote, template) are mutated or deleted; the 3 sample products, sample templates and pre-existing deals/quotes are never touched; no Request demo case. Faker emails are test data only.

## Edge-case table coverage
| Edge row | Test cases |
|---|---|
| Create product with a name that already exists | 037 |
| Clone product keeping the pre-filled name | 038 |
| Clone product without Unit price | 039 |
| Send quote with mandatory fields empty | 053 (success path 024, not run live) |
| Add or edit products with Add products to deals on | 017 |
| Delete product or quote | 005, 006, 025, 026 |
| Edit/deactivate/delete a product already on a quote | 054, 055, 056 |
| Blank Template name / blank Quote type | 049, 050, 051 |
| Edit existing product Pricing type | 041 |
| CPQ Settings Pricing radios | 042 |
| Negative Unit price | 043 |
| Non-numeric Unit price | 044 |
| Max Name length | 045 |
| Product code/SKU uniqueness | 046 |

## Traceability matrix
| Test case | Flow slug | Clarification / edge-case item |
|---|---|---|
| TC-products-quotes-001 | view-products-list | Scope: view-products-list |
| 002 | create-product | Scope: create-product |
| 003 | clone-product | Confirmed: Clone no Unit price copy |
| 004 | edit-product | Scope: edit-product |
| 005 | delete-product | Edge: Delete product or quote; 90-day Recycle Bin |
| 006 | delete-product | Edge: Delete (restorable); Open Q7 |
| 007 | product-list-toolbar-menus | Scope: toolbar menus |
| 008 | product-list-toolbar-menus | Scope: Filters panel |
| 009 | product-list-toolbar-menus | Scope: Products category filter |
| 010 | view-cpq-settings | Scope: view-cpq-settings |
| 011 | view-document-templates | Scope: view-document-templates |
| 012 | create-template-validation | Open Q4 (real template create) |
| 013 | add-quote | Scope: add-quote; Open Q2 |
| 014 | add-quote | Scope: add-quote (Show all fields) |
| 015 | view-quote-detail | Scope: view-quote-detail |
| 016 | view-quote-detail | Scope: View activity |
| 017 | view-quote-detail | Edge: Add or edit products with Add products to deals on |
| 018 | view-quote-detail | Open Q10 |
| 019 | view-quote-detail | Scope: Edit quote overlay |
| 020 | view-quote-detail | Scope: Clone quote |
| 021 | view-quote-detail | Scope: Preview |
| 022 | view-quote-detail | Scope: Save PDF |
| 023 | view-quote-detail | Scope: stage transitions; Open Q9 |
| 024 | view-quote-detail | Confirmed: Send to customer; Open Q3, Q9 (not run live) |
| 025 | delete-quote | Edge: Delete product or quote |
| 026 | delete-quote | Edge: Delete (restorable); Open Q7 |
| 027 | view-quotes-list | Scope: view-quotes-list |
| 028 | view-quotes-list | Confirmed: no left-nav entry; Open Q1 |
| 029 | view-quotes-list | Scope: Quotes list Filters/Edit columns/sorting |
| 030 | view-quotes-list | Scope: Manage Quote types, Customize fields |
| 031 | view-quotes-list | Scope: bulk actions |
| 032 | create-product | Scope: Subscription; Open Q6, Q12 |
| 033 | create-product | Scope: multi-currency; Open Q6 |
| 034 | product-list-toolbar-menus | Open Q3, Q13 (not run live) |
| 035 | product-list-toolbar-menus | Open Q13 (not run live) |
| 036 | create-product | Open Q5 |
| 037 | create-product | Edge: duplicate name on create |
| 038 | clone-product | Edge: clone keeping name |
| 039 | clone-product | Edge: clone without Unit price |
| 040 | edit-product | Scope: edit-product validation |
| 041 | edit-product | Edge: Pricing type |
| 042 | view-cpq-settings | Edge: CPQ radios; Open Q12 |
| 043 | create-product | Edge: negative price; Open Q5 |
| 044 | create-product | Edge: non-numeric price; Open Q5 |
| 045 | create-product | Edge: max Name length; Open Q5 |
| 046 | create-product | Edge: Product code/SKU; Open Q11 |
| 047 | delete-product | Scope: delete-product (No) |
| 048 | add-quote | Confirmed: required quote fields |
| 049 | create-template-validation | Edge: blank Template name / Quote type; Open Q4 |
| 050 | create-template-validation | Edge: blank Template name |
| 051 | create-template-validation | Edge: blank Quote type |
| 052 | create-template-validation | Scope: Cancel drawer |
| 053 | view-quote-detail | Edge: Send with mandatory fields empty |
| 054 | edit-product | Edge: used product edited; Open Q8 |
| 055 | edit-product | Edge: used product deactivated; Open Q8 |
| 056 | delete-product | Edge: used product deleted; Open Q8 |
| 057 | view-quotes-list | Explore note: stale count after delete |
| 058 | clone-product | Explore note: list refresh after clone |
