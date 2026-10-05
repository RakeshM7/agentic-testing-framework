import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

// Sales Sequences track. Read-only (GET) load on GET /crm/sales/sales_sequences (list). No writes, no entities
// created, nothing activated or enrolled. Requires BASE_URL + K6_ALLOWED_HOSTS (lib/guard.js) and a session hand-off file.
const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const COOKIE = loadSessionCookie(() => RAW);
const failed = new Rate('freshsales_sales_sequences_failed');

export const options = {
  scenarios: {
    sequences_reads: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: '20s', target: 3 }, { duration: '40s', target: 3 }, { duration: '10s', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    freshsales_sales_sequences_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const params = { headers: { Accept: 'application/json', Cookie: COOKIE }, tags: { name: 'GET /crm/sales/sales_sequences' } };
  const res = http.get(`${BASE_URL}/crm/sales/sales_sequences`, params);
  failed.add(!check(res, {
    'status 200': (r) => r.status === 200,
    'json envelope': (r) => { try { return Array.isArray(r.json('sales_sequences')); } catch (e) { return false; } },
  }));
  sleep(1);
}
