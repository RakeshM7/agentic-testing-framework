# Analytics API test plan (track: analytics)

Analytics has no meaningful tenant-side API beyond read-only GETs. The public Freshworks CRM API documents no analytics endpoints; report builder, schedules, custom attributes/metrics, data exports and favorites/trash are served by the third-party freshreports.com app (out of scope). 3 endpoints discovered (1 shared with dashboards track). mode full-run, but no mutating tests are possible or generated; created-entities.json = [] (nothing created, nothing to delete). Curated reports, schedules and emails untouched.

| Endpoint | Functional | Negative | Boundary | Auth | Schema | Perf |
|---|---|---|---|---|---|---|
| GET analytic_reports | 8 curated reports incl. Sales Essentials Dashboard | unknown query param ignored | `?curated=true` same list | no cookie -> 401 | {id:number,name:string,curated:boolean} | k6 candidate |
| GET analytic_reports/:id | - | ids 1 / 999999999 -> 404 (no show route) | - | - | - | |
| GET analytics_dashboard | tabs present | - | - | 401 JSON / 302 HTML | covered in dashboards track (only auth + minimal shape here) | |

Perf: `api-tests/k6/scripts/analytics-reports-load-test.js`, GET analytic_reports only, ramp 0->5 VUs 20s, 5 VUs 40s, down 10s, p95<1500ms, failed<1%. Only `k6 inspect` run (see README).
