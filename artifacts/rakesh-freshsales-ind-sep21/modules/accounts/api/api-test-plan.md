# Accounts API test plan (track: accounts, mode: full-run)
Spec: api-tests/playwright-api/tests/freshsales/accounts/sales-accounts.spec.ts; helper helpers/freshsales/accounts-track.ts. Mutations need a CSRF token. Entities are ZZ-prefixed, logged in `created-entities.json`, deleted in-run.

| Category | Scenarios |
|---|---|
| Functional | views list; list via view (per_page); detail; sub-resources contacts/notes; POST name-only (TC-007); POST full fields (TC-008); PUT rename (TC-010); PUT numeric fields; partial PUT; DELETE own then GET/DELETE 404 (TC-014) |
| Negative | POST empty/missing name, empty body (400); invalid website (400, TC-035); phone "abc" (KNOWN DEFECT, expected-fail, TC-036); duplicate name (400, TC-037); PUT collision (TC-038); PUT empty name/invalid website; unknown/non-numeric id (404); bare list w/o segment_id (403); text/plain body (KNOWN DEFECT 500, expected-fail) |
| Boundary | page=9999 -> empty; per_page honored; sort params; name length 255 ok / 256 -> 400 (contradicts "no max length" clarification); unicode/special chars |
| Auth | no session json 401 {login:failed} / html 302; bogus cookie; mutation without CSRF -> 422; POST with no session |
| Schema | {sales_accounts[]}, {sales_account}, error {errors:{code,message[]}} |
| Performance | GET-only ramp 0->5 VUs 20s, 5 VUs 40s, ramp down 10s; p95<1500ms, error rate <1% (accounts-sales-accounts-load-test.js) |
| Not covered by API | bulk actions, merge, forget, restore/purge, import, files, tag-creation (endpoints not identified; UI track covers them). Case-insensitive duplicate (TC-039) not probed. |
