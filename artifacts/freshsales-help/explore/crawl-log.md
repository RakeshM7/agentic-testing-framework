# Crawl Log

- Target: https://support.freshsales.io/support/home
- Mode: readonly
- Pages visited: 5 (maximum 5)
- Maximum depth: 1
- Maximum depth reached: 1
- Forms submitted: none
- Login walls: none encountered
- Errors: each captured page reported 2 browser console errors and 0 warnings; details are in the per-page `console-log.txt` files.

## Pages visited

- `https://support.freshsales.io/support/home` (depth 0)
- `https://support.freshsales.io/support/solutions/160486` (depth 1, Getting Started)
- `https://support.freshsales.io/support/solutions/160485` (depth 1, Leads, Contacts, Accounts, Products, and Custom modules)
- `https://support.freshsales.io/support/solutions/160694` (depth 1, Deals)
- `https://support.freshsales.io/support/solutions/160489` (depth 1, Admin Settings)

## Discovered but skipped

- Other depth-one links from the homepage were not visited because the five-page cap was reached. These include the homepage's other video articles and knowledge-base categories (Email, Phone, User Settings, Email, Phone, Tasks & Appointments, Data Migration, Integrations, Reports, and Plans And Billing).
- The captured category pages link to folders under `/support/solutions/folders/` and back to `/support/solutions`. These were not visited because they are depth 2, beyond the configured depth limit.
- External Freshworks links were excluded to honor the same-origin rule.
- The homepage and category pages contain search textboxes and Search buttons. They were observed but not used; no forms were submitted or interactions performed.

## Summary

Read-only crawl completed with five pages captured at depths 0-1. No login wall was hit. Same-origin knowledge-base links were prioritized; remaining homepage destinations were skipped at the page cap, and folder links were skipped at the depth cap.
