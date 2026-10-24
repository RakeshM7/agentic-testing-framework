import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

// settings-data-model track. Read-only (GET) load on the admin-config reads the Settings UI fires:
// field definitions, forms, lifecycle stages, tags, pipelines. No writes; no tenant config is touched.
const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const COOKIE = loadSessionCookie(() => RAW);
const failed = new Rate('freshsales_settings_failed');

export const options = {
  scenarios: {
    settings_reads: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: '20s', target: 3 }, { duration: '40s', target: 3 }, { duration: '10s', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    freshsales_settings_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const PATHS = [
  '/crm/sales/settings/contacts/fields',
  '/crm/sales/settings/sales_accounts/fields',
  '/crm/sales/settings/contacts/forms',
  '/crm/sales/settings/lifecycle_stages',
  '/crm/sales/settings/tags',
  '/crm/sales/settings/deal_pipelines',
];

export default function () {
  const params = { headers: { Accept: 'application/json', Cookie: COOKIE } };
  for (const p of PATHS) {
    const res = http.get(`${BASE_URL}${p}`, Object.assign({ tags: { name: `GET ${p}` } }, params));
    failed.add(!check(res, { 'status 200': (r) => r.status === 200, 'json body': (r) => (r.headers['Content-Type'] || '').indexOf('json') !== -1 }));
    sleep(1);
  }
}
