import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

// Sales-activities track. Read-only (GET) load on the Activities Dashboard's data calls:
// task list, meetings list, activity types, dashboard summary. No writes, no ZZ entities needed.
// Requires BASE_URL + K6_ALLOWED_HOSTS (see lib/guard.js) and a session via the hand-off file.
const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const COOKIE = loadSessionCookie(() => RAW);
const failed = new Rate('freshsales_sales_activities_failed');

export const options = {
  scenarios: {
    activities_dashboard: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: '20s', target: 5 }, { duration: '40s', target: 5 }, { duration: '10s', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    freshsales_sales_activities_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const PATHS = [
  '/crm/sales/tasks?filter=open&per_page=25',
  '/crm/sales/appointments?per_page=25',
  '/crm/sales/settings/sales_activity_types',
  '/crm/sales/activities_dashboard/summary',
];

export default function () {
  const params = { headers: { Accept: 'application/json', Cookie: COOKIE } };
  for (const p of PATHS) {
    const res = http.get(`${BASE_URL}${p}`, Object.assign({ tags: { name: `GET ${p.split('?')[0]}` } }, params));
    failed.add(!check(res, { 'status 200': (r) => r.status === 200, 'json body': (r) => (r.headers['Content-Type'] || '').indexOf('json') !== -1 }));
    sleep(1);
  }
}
