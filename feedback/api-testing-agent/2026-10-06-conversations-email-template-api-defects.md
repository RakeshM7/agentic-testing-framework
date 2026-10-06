---
source_agent: api-testing-agent
date: 2026-10-06
target: rakesh-freshsales-ind-sep21
related_files:
  - api-tests/playwright-api/tests/freshsales/conversations/email-templates.spec.ts
  - api-tests/playwright-api/helpers/freshsales/conversations-track.ts
  - artifacts/rakesh-freshsales-ind-sep21/modules/conversations/api/api-test-plan.md
severity: low
---

## Finding 1: Email template API quirks (product behaviour, annotated as deviations in the spec)
- POST/PUT /crm/sales/settings/email_templates without html_content (name-only, name+subject, empty JSON body, wrong content-type) returns 500 {"error_code":500} instead of 2xx/400, although the UI treats subject/body as optional. PUT is not partial.
- Create returns the singular key `email_template`; GET detail returns plural `email_templates` with an object.
- A 300-char name is echoed in full by POST but silently truncated on GET (no validation error).
- Segments such as all-sms/opens/clicks/bounces on /crm/sales/conversations return 403 "You have requested an invalid page"; those UI views use other endpoints not captured.

## Finding 2: Leaked test data from another suite
Three templates named ZZ-1791260794431-..., ZZ-1791261699814-..., ZZ-TC-dup-...[date] (ids 402001313891, 402001313900, 402001313897) remain on the tenant, created by the Playwright conversations suite (not this track). Left untouched. Suggest verifying that suite's cleanup (afterAll).

## Finding 3: Process
Per-page network-requests.json files were placeholders; the real API paths (/crm/sales/settings/email_templates/*) had to be captured live. explore-agent should record XHR for this module. Also, the live load run is blocked whenever the launching shell is not full-run even if the run-config says full-run; export AUTHORIZATIONS_MODE before launching.
