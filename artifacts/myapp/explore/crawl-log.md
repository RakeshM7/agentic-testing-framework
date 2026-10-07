# Crawl Log

- Requested start URL: https://crmsupport.freshworks.com/support/login
- Final URL: https://crmsupport.freshworks.com/support/home
- Mode: readonly
- Authenticated crawl: yes; the configured Playwright MCP session loaded `playwright-tests/.auth/myapp-session.json`.
- Account label observed: `jagan`; account role could not be determined from the support portal.
- Pages visited: 1 (maximum 25)
- Maximum depth: 3
- Maximum depth reached: 0
- Login walls: none. The requested login URL redirected to the authenticated support homepage.
- Mutating actions: none performed.
- Errors: 5 browser console errors and 0 warnings on the visited page. Three errors were 404 responses for `/stylesheet.css`; the others were failed third-party Facebook/Twitter resources. See `pages/home/console-log.txt`.

## Pages Visited

- `https://crmsupport.freshworks.com/support/home` (depth 0; authenticated support homepage)

## Discovered but Skipped

- `https://crmsupport.freshworks.com/support/tickets/new` was exposed as “NEW SUPPORT TICKET” and skipped because it enters a create flow.
- External Freshworks links were not followed to honor the same-origin boundary.
- The account menu exposed no safe module/settings destination. My Tickets and logout were not accessed.

## Feature-Mapping Caveats

The supplied target is the Freshworks support portal, not an application workspace with CRM main-menu modules. Its homepage shows static product/category tiles without navigation links and exposes no same-origin module lists, detail pages, or settings destinations. No substitute mechanism was used.

## Summary

The authenticated crawl reached the support homepage but could not proceed to module, detail, or settings pages without leaving the support portal, opening a ticket-creation flow, submitting a search form, or accessing a prohibited account area. Those actions were not taken. The single visited page's screenshot, DOM snapshot, filtered network requests, and console log are in `pages/home/`.