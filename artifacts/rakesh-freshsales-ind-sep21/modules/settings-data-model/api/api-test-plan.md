# settings-data-model API test plan (mode: full-run, tenant-wide admin config)

Spec: api-tests/playwright-api/tests/freshsales/settings-data-model/settings-data-model.spec.ts
Helper: api-tests/playwright-api/helpers/freshsales/settings-data-model-track.ts (CSRF + track log)
Run: `AUTHORIZATIONS_MODE=full-run npx playwright test --project=freshsales-api tests/freshsales/settings-data-model`

| Category | Scenarios |
|---|---|
| Functional | GET fields (contacts/accounts/deals), field_groups, forms (+ by id), lifecycle stages/statuses/auto-update, tags list, pipelines, web_forms, territories, currencies; tag create -> list -> delete round trip; private tag |
| Negative | unknown/non-numeric ids -> 404, .xml -> 406, unknown route 404, blank tag name 400, empty body (KNOWN DEFECT 500, test.fail), missing CSRF 422, duplicate tag name |
| Boundary | tags per_page=1, page=99999 empty, meta.total +1/-1 on create/delete, 1-char/500-char names |
| Auth | 12 read endpoints x (401 json, 302 html, bogus cookie), unauthenticated POST tags |
| Schema/contract | field/tag/stage/form/pipeline shapes, unique internal names, lifecycle choices == stages, status<->stage links |
| Performance | read-only k6 api-tests/k6/scripts/settings-data-model-config-load-test.js: 0->3 VUs 20s, hold 40s, down 10s; p95<1500ms, errors<1% |

Out of scope / skipped (documented): custom field create/update/delete (no standalone field endpoint, POST -> 404; UI edits go through the form payload of the seeded Default form), lifecycle stage/status create+delete, web form create, custom modules (no delete), PUT tag rename (probe returned 200 without changing name; behavior unclear). Seeded config is never mutated. Every created tag is ZZ-API-prefixed, logged to created-entities.json, deleted in the test, with afterAll safety net and a final "no ZZ-API tags remain" assertion.
