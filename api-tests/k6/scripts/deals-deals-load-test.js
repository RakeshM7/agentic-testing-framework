import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

// deals track. Read-only (GET) load: deals list (paged), sample deal detail, views, pipelines. No writes.
const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const COOKIE = loadSessionCookie(() => RAW);
const failed = new Rate('freshsales_deals_failed');
const SEGMENT = 402015942744;
const SAMPLE = 402011904108;

export const options = {
  scenarios: {
    deals_reads: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: '20s', target: 3 }, { duration: '40s', target: 3 }, { duration: '10s', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    freshsales_deals_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const PATHS = [
  `/crm/sales/deals?per_page=25&page=1&segment_id=${SEGMENT}`,
  `/crm/sales/deals?per_page=10&page=2&segment_id=${SEGMENT}&sort=amount&sort_type=desc`,
  `/crm/sales/deals/${SAMPLE}?include=deal_stage`,
  '/crm/sales/deals/filters',
  '/crm/sales/settings/deal_pipelines?include=deal_stages',
];

export default function () {
  const params = { headers: { Accept: 'application/json', Cookie: COOKIE } };
  for (const p of PATHS) {
    const res = http.get(`${BASE_URL}${p}`, Object.assign({ tags: { name: `GET ${p.split('?')[0].replace(/\d{6,}/, ':id')}` } }, params));
    failed.add(!check(res, { 'status 200': (r) => r.status === 200, 'json body': (r) => (r.headers['Content-Type'] || '').indexOf('json') !== -1 }));
    sleep(1);
  }
}
