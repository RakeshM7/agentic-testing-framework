import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

// Conversations track. Read-only (GET) load: email-template list (Public filter), inbox list, sent list.
// No writes, no email sent/scheduled, no entities created. Requires BASE_URL + K6_ALLOWED_HOSTS (lib/guard.js) and a session hand-off file.
const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const COOKIE = loadSessionCookie(() => RAW);
const failed = new Rate('freshsales_conversations_failed');

export const options = {
  scenarios: {
    conversations_reads: {
      executor: 'ramping-vus', startVUs: 0,
      stages: [{ duration: '20s', target: 3 }, { duration: '40s', target: 3 }, { duration: '10s', target: 0 }],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<1500'],
    freshsales_conversations_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

const EP = [
  ['GET /crm/sales/settings/email_templates/user', '/crm/sales/settings/email_templates/user?page=1&per_page=10&filterParam=-302', 'email_templates'],
  ['GET /crm/sales/conversations (inbox)', '/crm/sales/conversations?page=1&per_page=25&segment_id=inbox&phone_id=-2&user_id=-1', 'email_conversations'],
  ['GET /crm/sales/conversations (sent)', '/crm/sales/conversations?page=1&per_page=25&segment_id=sent&phone_id=-2&user_id=-1', 'email_conversations'],
];

export default function () {
  for (const [name, path, key] of EP) {
    const res = http.get(`${BASE_URL}${path}`, { headers: { Accept: 'application/json', Cookie: COOKIE }, tags: { name } });
    failed.add(!check(res, {
      [`${name} status 200`]: (r) => r.status === 200,
      [`${name} json envelope`]: (r) => { try { return Array.isArray(r.json(key)); } catch (e) { return false; } },
    }));
    sleep(1);
  }
}
