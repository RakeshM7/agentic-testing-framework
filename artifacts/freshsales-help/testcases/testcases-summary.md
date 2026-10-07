# Test Cases Summary: Knowledge Base Browsing and Search

Feature file: `knowledge-base-browsing-search-testcases.feature`

All cases use the public, unauthenticated support portal and are read-only. Search submission only retrieves results. The cases do not access My Tickets, subcategory folders, or individual articles. Behaviors whose details were not confirmed are tagged `@unconfirmed-*` and noted in the relevant scenario.

## Counts

| Category | Count | Test case IDs |
|---|---:|---|
| Happy path / positive | 6 | TC-knowledge-base-browsing-search-001 through -006 |
| Negative | 3 | TC-knowledge-base-browsing-search-007 through -009 |
| Boundary | 3 | TC-knowledge-base-browsing-search-007 through -009 |
| Priority P0 | 0 | None |
| Priority P1 | 9 | TC-knowledge-base-browsing-search-001 through -009 |
| Priority P2 | 0 | None |

Boundary cases are also negative cases, so the category counts overlap. Every edge-case row is represented by at least one scenario; the generic-query row is covered by two cases, one per confirmed query.

## Traceability Index

| Test case ID | Coverage / source |
|---|---|
| TC-knowledge-base-browsing-search-001 | Answer 1 and Answer 2; Getting Started landing page only |
| TC-knowledge-base-browsing-search-002 | Answer 1 and Answer 2; Leads/Contacts/Accounts landing page only |
| TC-knowledge-base-browsing-search-003 | Answer 1 and Answer 2; Deals landing page only |
| TC-knowledge-base-browsing-search-004 | Answer 1 and Answer 2; Admin Settings landing page only |
| TC-knowledge-base-browsing-search-005 | Answer 3; edge-case row “Generic query email or deals” (email) |
| TC-knowledge-base-browsing-search-006 | Answer 3; edge-case row “Generic query email or deals” (deals) |
| TC-knowledge-base-browsing-search-007 | Answer 4; edge-case row “Empty query” |
| TC-knowledge-base-browsing-search-008 | Answer 4; edge-case row “Whitespace-only query” |
| TC-knowledge-base-browsing-search-009 | Answer 4; edge-case row “Query with no matches” |

UI labels and category headings are grounded in `artifacts/freshsales-help/explore/pages/home/dom-snapshot.md` and the four category `dom-snapshot.md` files. The homepage textbox label is “Go ahead, ask us anything”; the category pages' search box is labeled “Find some solutions here...”.