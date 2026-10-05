import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

// Modest read-only (GET) load on dashboard endpoints. Requires BASE_URL and K6_ALLOWED_HOSTS.
const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const COOKIE = loadSessionCookie(() => RAW);
const failed = new Rate('freshsales_dashboards_failed');

export const options = {
  scenarios: {
    dashboards: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: '20s', target: 5 }, { duration: '40s', target: 5 }, { duration: '10s', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    freshsales_dashboards_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const params = { headers: { Accept: 'application/json', Cookie: COOKIE } };
  for (const p of ['/crm/sales/analytics_dashboard', '/crm/sales/activities_dashboard/summary', '/crm/sales/activities_dashboard/available_user_widgets']) {
    const res = http.get(`${BASE_URL}${p}`, Object.assign({ tags: { name: `GET ${p}` } }, params));
    failed.add(!check(res, { 'status 200': (r) => r.status === 200 }));
    sleep(1);
  }
}
