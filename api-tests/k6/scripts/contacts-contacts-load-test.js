import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

// Contacts track. Read-only (GET) load on the Contacts module's data calls: saved views list,
// All Contacts view page (default + sorted), Recycle Bin view and field metadata. No writes, no entities created.
// Requires BASE_URL + K6_ALLOWED_HOSTS (see lib/guard.js) and a session via the hand-off file.
const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const COOKIE = loadSessionCookie(() => RAW);
const ALL_VIEW = __ENV.FRESHSALES_CONTACTS_SEGMENT_ID || '402015942732';
const BIN_VIEW = __ENV.FRESHSALES_CONTACTS_BIN_ID || '402015942739';
const failed = new Rate('freshsales_contacts_module_failed');

export const options = {
  scenarios: {
    contacts_reads: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: '20s', target: 5 }, { duration: '40s', target: 5 }, { duration: '10s', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    freshsales_contacts_module_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const PATHS = [
  '/crm/sales/contacts/filters',
  `/crm/sales/contacts/view/${ALL_VIEW}?page=1&per_page=25`,
  `/crm/sales/contacts/view/${ALL_VIEW}?page=1&per_page=25&sort=created_at&sort_type=desc`,
  `/crm/sales/contacts/view/${BIN_VIEW}?page=1&per_page=25`,
  '/crm/sales/settings/contacts/fields',
];

export default function () {
  const params = { headers: { Accept: 'application/json', Cookie: COOKIE } };
  for (const p of PATHS) {
    const res = http.get(`${BASE_URL}${p}`, Object.assign({ tags: { name: `GET ${p.split('?')[0].replace(/\/\d+/, '/:id')}` } }, params));
    failed.add(!check(res, { 'status 200': (r) => r.status === 200, 'json body': (r) => (r.headers['Content-Type'] || '').indexOf('json') !== -1 }));
    sleep(1);
  }
}
