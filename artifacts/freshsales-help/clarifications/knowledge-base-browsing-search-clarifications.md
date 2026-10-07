# Knowledge Base Browsing and Search Clarifications

## Feature summary

Browse the four captured Freshsales Classic support knowledge-base category landing pages and search the public help center for articles. The starting point is https://support.freshsales.io/support/home.

## In scope / Out of scope

**In scope**
- Public, unauthenticated access; no login.
- Browse the landing pages for Getting Started, Leads/Contacts/Accounts, Deals, and Admin Settings, as linked from the homepage and captured in `artifacts/freshsales-help/explore/sitemap.json`.
- Search using generic queries such as `email` and `deals`; check that relevant results appear without asserting result order or exact titles.
- Empty, whitespace-only, and no-match search cases.
- Read-only interactions. Submitting a search query to retrieve results is permitted; no state-changing actions are in scope.

**Out of scope**
- Other homepage categories and video articles.
- Subcategory folders and individual help articles; category landing pages are the browsing depth limit for this run.
- Login, authenticated pages, My Tickets, and any data-changing action.

## Confirmed behaviors

- [Answer 1] Limit category coverage to the four categories captured in the crawl; other homepage categories are out of scope.
- [Answer 2] Verify category landing pages only; do not open subcategory folders or individual articles.
- [Answer 3] Search with generic queries such as `email` and `deals`; check for relevant results and do not assert exact titles or result order.
- [Answer 4] Include empty, whitespace-only, and no-match queries; verify the UI handles them without errors.
- [Answer 5] Write test cases in Gherkin `.feature` style.
- [Additional scope instruction] Use public pages only, do not log in, do not visit My Tickets, and remain read-only. Search submissions are limited to retrieving results.

## Edge cases

| Scenario | Expected behavior |
|---|---|
| Empty query | The UI handles the query without an application error. Exact validation or empty-state behavior is unconfirmed; assume standard behavior and do not assert specific copy. |
| Whitespace-only query | The UI handles the query without an application error. Whether whitespace is trimmed, rejected, or treated as empty is unconfirmed; assume standard behavior and do not assert specific copy. |
| Query with no matches | The UI handles the query without an application error and presents an appropriate no-results state. Exact wording and presentation are unconfirmed. |
| Generic query `email` or `deals` | Relevant results appear. The exact expected titles and relevance oracle are unconfirmed; do not assert exact titles or result ordering. |

## Non-functional constraints

- Public pages only; no login or authenticated access.
- Read-only. Search requests may retrieve results, but must not change data.
- Do not access My Tickets.

## Confirmed test-case output format

Gherkin (.feature style)

## Open questions

- The exact relevant article titles for `email` and `deals` are not specified. Treat relevance expectations as unconfirmed and avoid exact-title assertions.
- The exact UI behavior and copy for empty, whitespace-only, and no-match searches are not specified. Use the standard-behavior assumptions above and flag them as unconfirmed; assert only that the UI handles each case without errors.
