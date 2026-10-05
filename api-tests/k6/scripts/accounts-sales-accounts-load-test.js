import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

// Accounts track. Read-only (GET) load on the Accounts list/views/detail calls. No writes, no entities created.
// Requires BASE_URL + K6_ALLOWED_HOSTS (see lib/guard.js) and a session via the hand-off file.
const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const COOKIE = loadSessionCookie(() => RAW);
const failed = new Rate('freshsales_accounts_failed');

export const options = {
  scenarios: {
    accounts_reads: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: '20s', target: 5 }, { duration: '40s', target: 5 }, { duration: '10s', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    freshsales_accounts_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const PATHS = [
  '/crm/sales/sales_accounts/filters',
  '/crm/sales/sales_accounts/view/402015942758?page=1&per_page=25',
  '/crm/sales/sales_accounts/view/402015942759?page=1&per_page=25&sort=name&sort_type=asc',
  '/crm/sales/sales_accounts/402012383128',
];

export default function () {
  const params = { headers: { Accept: 'application/json', Cookie: COOKIE } };
  for (const p of PATHS) {
    const res = http.get(`${BASE_URL}${p}`, Object.assign({ tags: { name: `GET ${p.split('?')[0].replace(/\d{6,}/g, ':id')}` } }, params));
    failed.add(!check(res, { 'status 200': (r) => r.status === 200, 'json body': (r) => (r.headers['Content-Type'] || '').indexOf('json') !== -1 }));
    sleep(1);
  }
}
