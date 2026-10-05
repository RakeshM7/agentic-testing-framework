import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';
import { loadSessionCookie } from './lib/freshsales-session.js';

/**
 * Load profile for GET /crm/sales/contacts (paginated list, read-only).
 *
 * GENERATED BUT NOT EXECUTED LIVE THIS RUN. See api-tests/k6/README.md's Freshsales section.
 * `k6 inspect` (static validation, zero network traffic) was run against this script; `k6 run` was
 * not, because this script requires an authenticated Freshsales session cookie
 * (FRESHSALES_SESSION_COOKIE) that this run could not obtain -- scripted UI login for this tenant
 * reliably triggers a Google reCAPTCHA challenge (see
 * feedback/playwright-automation-agent/2026-09-21-freshsales-recaptcha-blocks-scripted-login.md).
 *
 * Rationale (see artifacts/rakesh-freshsales-ind-sep21/api/api-test-plan.md, Performance section):
 * the Contacts list is the highest-traffic authenticated read observed in explore-agent's crawl --
 * loaded on every Contacts-module page view -- and models a sales rep repeatedly
 * refreshing/filtering their list.
 *
 * To actually run this against the live tenant:
 *   1. Have a human complete the Freshsales login once interactively (solving the CAPTCHA
 *      themselves) and copy the resulting session cookie value.
 *   2. k6 run scripts/freshsales-contacts-list-load-test.js \
 *        -e FRESHSALES_SESSION_COOKIE="<the cookie string>"
 */

const BASE_URL = requireBaseUrl(__ENV.BASE_URL);
const RAW = __ENV.FRESHSALES_SESSION_COOKIE ? '' : open(__ENV.FRESHSALES_SESSION_STATE_FILE || '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
const SESSION_COOKIE = loadSessionCookie(() => RAW);

const failureRate = new Rate('freshsales_contacts_list_failed');
const duration = new Trend('freshsales_contacts_list_duration', true);

export const options = {
  scenarios: {
    contacts_list: {
      executor: 'ramping-vus',
      exec: 'listContacts',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 15 },
        { duration: '1m', target: 15 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    freshsales_contacts_list_duration: ['p(95)<800'],
    freshsales_contacts_list_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

export function setup() {
  if (!SESSION_COOKIE) {
    console.warn(
      'FRESHSALES_SESSION_COOKIE is not set -- every request in this run will receive a 401 ' +
        '({"login":"failed"}) rather than exercising real list-query performance. This is expected ' +
        'when running `k6 inspect` (no network calls made at all) but will also happen under ' +
        '`k6 run` without a valid cookie. See this script\'s header comment for how to supply one.'
    );
  }
}

export function listContacts() {
  const res = http.get(
    `${BASE_URL}/crm/sales/contacts?include=lookup_information&load_as_per_list_page_config=true&page=1&per_page=25&segment_id=${__ENV.FRESHSALES_CONTACTS_SEGMENT_ID || '402015942732'}&sort=updated_at&sort_type=desc`,
    {
      headers: {
        Accept: 'application/json',
        Cookie: SESSION_COOKIE,
      },
      tags: { name: 'GET /crm/sales/contacts' },
    }
  );

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'not a 401 auth failure': (r) => r.status !== 401,
  });

  failureRate.add(!ok);
  duration.add(res.timings.duration);
  sleep(1);
}

export function teardown() {
  console.log(
    'Reminder: a human should confirm no 401s ({"login":"failed"}) appear in the results before ' +
      'drawing any latency conclusion from this run -- a session that expires mid-run would silently ' +
      'turn every subsequent request into a fast-failing 401, which would look like *better* p95 ' +
      'latency, not worse.'
  );
}
