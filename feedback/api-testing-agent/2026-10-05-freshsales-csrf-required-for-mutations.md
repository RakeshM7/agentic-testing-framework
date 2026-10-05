---
source_agent: api-testing-agent
date: 2026-10-05
target: rakesh-freshsales-ind-sep21
related_files:
  - api-tests/playwright-api/fixtures/freshsales-api-fixtures.ts
  - api-tests/playwright-api/fixtures/created-entities.ts
  - api-tests/playwright-api/helpers/freshsales/sales-activities-track.ts
  - api-tests/k6/README.md
severity: high
---

## Finding 1: Freshsales mutations need a CSRF token; shared fixture only sends a Cookie
With only the session cookie, every POST/PUT/DELETE under /crm/sales returns `422 {"error_code":422}`. Adding `X-CSRF-Token` (value of `<meta name="csrf-token">` from `GET /crm/sales/dashboard` with `Accept: text/html`, using the cookie jar that response rotates) makes mutations succeed. Earlier tracks' mutating specs (accounts/contacts/deals/activities) that use the bare Cookie header would likely 422. Suggest promoting the track-local helper into `fixtures/` as a shared Freshsales mutation context. Cookie-string-only auth (FRESHSALES_SESSION_COOKIE) cannot do this, so a storageState file is required for full-run.

## Finding 2: shared created-entities helper writes to a non-track path
`fixtures/created-entities.ts` writes to `artifacts/<target>/api/created-entities.json`, not `<trackRoot>/api/` as track mode requires. Also the `freshsales-api` testMatch (`tests/freshsales/`) treats any file under tests/ as a test, so helpers must live outside it (this track uses `helpers/`). `guardRequest` itself always refuses mutations; only `guardedTest` conditionally wraps it, which is easy to misuse in custom contexts.

## Finding 3: live k6 blocked in full-run despite explicit prompt
`.claude/hooks/guard-bash.mjs` reads the process env (and appears to pattern-match the text of the whole command, including heredoc bodies that merely mention a live k6 invocation), so a prompt-authorized run was blocked. See existing 2026-10-04 and 2026-10-05 feedback. Hook not overridden.

## Finding 4: target defects found
GET /tasks?page=0&per_page=0 returns 500; POST settings/sales_activity_types with blank name returns 500. Both encoded as expected-fail tests.
