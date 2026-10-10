# Deals API test plan (track: deals, mode: full-run)
Spec: api-tests/playwright-api/tests/freshsales/deals/deals.spec.ts. Helper: api-tests/playwright-api/helpers/freshsales/deals-track.ts.
Mutations need Rails CSRF token (meta csrf-token) + AUTHORIZATIONS_MODE=full-run. Only "ZZ API Deal*" deals created by the suite are mutated/deleted; ids logged in created-entities.json; delete helper refuses any id not in the log.
Endpoints (all under /crm/sales): GET deals?segment_id (list), GET deals/:id, POST deals, PUT deals/:id, DELETE deals/:id (soft delete -> Recycle Bin), GET deals/filters, GET settings/deal_pipelines?include=deal_stages, GET settings/deals/fields, GET deals/:id/notes, GET deals/:id/tasks.

| Category | Scenarios |
|---|---|
| Functional | list+meta; detail include=deal_stage; create (defaults pipeline/New); get-after-create + in list; PUT name/amount; stage move to Qualification (probability 30); sort amount desc; notes/tasks sub-lists; DELETE then GET 404 |
| Negative | list without/with unknown segment_id -> 403; 404 id; non-numeric id; empty/blank name 400; non-numeric amount 400 (POST/PUT); unknown stage 400; PUT/DELETE nonexistent 404; double delete 404; POST no CSRF 422; text/plain 500 (quirk) |
| Boundary | per_page 0/1/1000, page beyond last; amount 0; amount > 2^53-1 400; 300-char name; invalid expected_close (silently nulled) |
| Auth | no session json 401 {login:failed} / html 302; bogus cookie; unauth POST/DELETE rejected |
| Schema | deal fields/types (amount decimal string); meta; filters; pipeline stages; field definitions |
| Security | HTML in name stays JSON |
| Known defect | negative amount accepted (-5.0) -> test.fail |
| Performance | k6 deals-deals-load-test.js: GET list/detail/filters/pipelines, ramp 0-3 VUs 20s, hold 40s, down 10s; p95<1500ms, failures<1% |
Not covered: bulk delete / forget (route not exposed: 404), clone, forecast, views, lookup (404 at probed paths); Recycle Bin forget is UI-only.
