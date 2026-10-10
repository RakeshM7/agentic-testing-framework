---
source_agent: api-testing-agent
date: 2026-10-06
target: rakesh-freshsales-ind-sep21
related_files:
  - api-tests/playwright-api/tests/freshsales/settings-data-model/settings-data-model.spec.ts
  - api-tests/playwright-api/helpers/freshsales/settings-data-model-track.ts
severity: medium
---

## Finding 1: Mutating specs need AUTHORIZATIONS_MODE=full-run in the Playwright process env
The shared mutationGuard reads only process env, so run-config `mode: full-run` alone leaves every POST/DELETE refused. Suggest the orchestrator export it for the Playwright run (as already needed for k6).

## Finding 2: Target defects / quirks
POST settings/tags with `{}` returns 500 (encoded as test.fail). PUT settings/tags/:id returned 200 without renaming in a probe. Tag `color_code` is absent on some seeded tags. POST settings/contacts/fields is 404: custom-field CRUD is not exposed as a standalone endpoint (form-payload edit only), so it was not automated (would touch the seeded Default form).

## Finding 3: Parallel + count assertions
`fullyParallel` makes tenant-wide counts (tags meta.total) racy across tests in one file; use serial mode per mutating describe and avoid exact equality in read tests.

## Finding 4: Live k6 blocked again
Guard hook blocked live k6 (mode readonly in shell env); not overridden. Same as 2026-10-04/05 feedback.
