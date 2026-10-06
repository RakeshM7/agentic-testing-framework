# Sales Sequences API test plan (track: sales-sequences)

Mode: full-run (user-authorized trial tenant). Sequences are only created Inactive (status 2); never activated, no enrolment, no email/SMS. Every created sequence is named "ZZ Seq API ...", logged in `created-entities.json` on creation and deleted in the same test; the end-of-run list must be empty. Endpoints: see `discovered-endpoints.json` (5 operations on 2 path templates).

Spec: `api-tests/playwright-api/tests/freshsales/sales-sequences/sales-sequences.spec.ts`; helper: `api-tests/playwright-api/helpers/freshsales/sales-sequences-track.ts`; k6: `api-tests/k6/scripts/sales-sequences-sales-sequences-load-test.js`.

| Category | Scenarios |
|---|---|
| Functional | list envelope; create Inactive w/ task step (schema); list includes created; detail (steps, schedule); PUT rename; clone ("- Copy" POST) independent; DELETE then GET/DELETE 404 |
| Negative | POST/PUT without CSRF -> 422; empty body, wrong root key, missing/string/unknown category -> 400; bad step action_type, task without title, exit_conditions missing flags -> 400; non-numeric/unknown id -> 404; category 1 -> 404 not authorised |
| Boundary | no steps (500, deviation), empty/missing/duplicate name accepted, name length 255/256/300 accepted, HTML/unicode names verbatim, out-of-range sequence_type unvalidated, partial PUT 500, PUT category change 404, extra query params tolerated |
| Auth | no session JSON -> 401 {login:"failed"}; HTML -> 302; bogus cookie rejected; mutation without session/CSRF rejected |
| Schema | asserted inside functional tests (envelope, step shape, status Inactive) |
| Performance | GET list only: ramp 0->3 VUs/20s, hold 40s, down 10s; p95<1500ms, failure rate <1% (read-only, low VU to protect trial tenant) |
