# Dashboards API test plan (track: dashboards)

Public surface: Freshworks CRM docs (developers.freshworks.com/crm/api) document no dashboard/analytics endpoints; the dashboards module's API is internal `/crm/sales/*` app API (7 endpoint entries on the tenant host, 1 POST observed but untested). Widgets are rendered by the third-party Freshreports app (out of scope). Coverage is deliberately small and read-only.

Mode full-run, but no mutating tests are generated: the only mutation (POST /crm/sales/analytics_dashboard, tab add/remove) alters the user's real dashboard config, its body was not captured, and it creates no deletable entity. created-entities.json = [].

| Endpoint | Functional | Negative | Boundary | Auth | Schema | Perf |
|---|---|---|---|---|---|---|
| GET analytics_dashboard | default tabs present | - | - | no cookie -> 401 JSON / 302 HTML | analytic_widgets shape | k6 candidate |
| GET analytics_dashboard/:id | - | unknown id 404 | - | - | errors shape | |
| GET analytic_reports | curated reports list | - | - | 401 | {id,name,curated} | |
| GET activities_dashboard | list + meta | invalid date 400 | per_page=-1/page=0 tolerated (200) | 401 | meta keys | k6 candidate |
| GET activities_dashboard/summary | 200 | | | | summary array | k6 candidate |
| GET activities_dashboard/available_user_widgets | 4 widgets | | | | fields | k6 candidate |

Perf: `api-tests/k6/scripts/dashboards-analytics-load-test.js`, GETs only, ramp 0->5 VUs 20s, 5 VUs 40s, down 10s, thresholds p95<1500ms, failed<1%.
Note: iframe_url contains a JWT; tests never log it.
