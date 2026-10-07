import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Load profile for the Deals Kanban board's 3-call load unit:
 *   POST /crm/sales/deals/kanban_headers
 *   POST /crm/sales/deals/kanban_funnels
 *   GET  /crm/sales/deals/view/:viewId/aggregated_data?group_by_type=deal_stage_id
 *
 * GENERATED BUT NOT EXECUTED LIVE THIS RUN. See api-tests/k6/README.md's Freshsales section.
 * `k6 inspect` (static validation, zero network traffic) was run against this script; `k6 run` was
 * not, for the identical reCAPTCHA-gated-session reason documented in
 * freshsales-contacts-list-load-test.js's header comment.
 *
 * Rationale (see artifacts/rakesh-freshsales-ind-sep21/api/api-test-plan.md, Performance section):
 * the Kanban board is the core "pipeline" UI for this feature, and all 3 endpoints fire together on
 * every board load/refresh per explore-agent's captured network traffic (deals-kanban and
 * deals-kanban-after-move pages) -- so the realistic unit to load-test is this 3-call group, not one
 * endpoint in isolation. Slightly heavier p95 threshold than the flat contacts list, reflecting the
 * extra aggregation work of grouping deals by stage across multiple columns.
 *
 * To actually run this against the live tenant:
 *   k6 run scripts/freshsales-deals-kanban-load-test.js \
 *     -e FRESHSALES_SESSION_COOKIE="<the cookie string>"
 */

const BASE_URL = __ENV.BASE_URL || 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';
const SESSION_COOKIE = __ENV.FRESHSALES_SESSION_COOKIE || '';
// Tenant-specific constants observed in explore-agent's captures (deals-kanban/network-requests.json)
const DEALS_VIEW_ID = __ENV.FRESHSALES_DEALS_VIEW_ID || '402015942744';

const failureRate = new Rate('freshsales_kanban_failed');
const duration = new Trend('freshsales_kanban_duration', true);

export const options = {
  scenarios: {
    kanban_board_load: {
      executor: 'ramping-vus',
      exec: 'loadKanbanBoard',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    freshsales_kanban_duration: ['p(95)<1200'],
    freshsales_kanban_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  if (!SESSION_COOKIE) {
    console.warn(
      'FRESHSALES_SESSION_COOKIE is not set -- every request in this run will receive a 401 rather ' +
        'than exercising real Kanban aggregation performance. See this script\'s header comment.'
    );
  }
}

const headers = () => ({ Accept: 'application/json', Cookie: SESSION_COOKIE });

export function loadKanbanBoard() {
  group('deals kanban board load', function () {
    const headersRes = http.post(
      `${BASE_URL}/crm/sales/deals/kanban_headers`,
      JSON.stringify({}),
      { headers: { ...headers(), 'Content-Type': 'application/json' }, tags: { name: 'POST /crm/sales/deals/kanban_headers' } }
    );
    const funnelsRes = http.post(
      `${BASE_URL}/crm/sales/deals/kanban_funnels`,
      JSON.stringify({}),
      { headers: { ...headers(), 'Content-Type': 'application/json' }, tags: { name: 'POST /crm/sales/deals/kanban_funnels' } }
    );
    const aggregatedRes = http.get(
      `${BASE_URL}/crm/sales/deals/view/${DEALS_VIEW_ID}/aggregated_data?group_by_type=deal_stage_id&include=lookup_information&load_as_per_kanban_page_config=true&page=1&per_page=10&sort=updated_at&sort_type=desc`,
      { headers: headers(), tags: { name: 'GET /crm/sales/deals/view/:id/aggregated_data' } }
    );

    const ok = check(
      { headersRes, funnelsRes, aggregatedRes },
      {
        'kanban_headers is 200': (r) => r.headersRes.status === 200,
        'kanban_funnels is 200': (r) => r.funnelsRes.status === 200,
        'aggregated_data is 200': (r) => r.aggregatedRes.status === 200,
        'none of the 3 calls is a 401 auth failure': (r) =>
          r.headersRes.status !== 401 && r.funnelsRes.status !== 401 && r.aggregatedRes.status !== 401,
      }
    );

    failureRate.add(!ok);
    duration.add(headersRes.timings.duration + funnelsRes.timings.duration + aggregatedRes.timings.duration);
  });

  sleep(1);
}

export function teardown() {
  console.log(
    'Reminder: verify none of the 3 calls in the group silently 401\'d (a mid-run session expiry ' +
      'would look like an artificially fast/successful run, not a failure) before trusting this ' +
      'result\'s latency numbers.'
  );
}
