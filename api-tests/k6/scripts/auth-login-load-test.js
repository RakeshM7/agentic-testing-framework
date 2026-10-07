import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Load profile for POST /auth/login -- added by the app-wide run (login feature).
 *
 * ================================================================================================
 * GENERATED BUT NOT EXECUTED LIVE. See api-tests/k6/README.md -- per the api-testing-agent's hard
 * rule, this script has never been run with `k6 run` against any target. Only `k6 inspect` (static
 * validation) may have been run against it.
 *
 * EXTRA CAUTION, similar in spirit to booking-creation-load-test.js: this script performs real
 * POST /auth/login calls. Unlike booking creation, login itself does not create/mutate business
 * data (it only authenticates an existing account) -- but firing many concurrent login attempts at
 * a *shared public demo account* on a target you don't own risks looking like credential-stuffing
 * or brute-force traffic to any rate-limiting/security monitoring sitting in front of the API, and
 * could trigger an account lockout that breaks other testers' sessions. For that reason BASE_URL
 * defaults to a local/staging host, NOT the production/demo host, the same defensive default
 * booking-creation-load-test.js uses. Do not override BASE_URL to point at
 * api.eventhub.rahulshettyacademy.com unless you own that environment or have explicit
 * authorization, and even then, keep VU counts low (this script defaults to 10) and monitor for
 * 429 responses.
 * ================================================================================================
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001/api'; // deliberately NOT the production host by default
const LOGIN_EMAIL = __ENV.LOGIN_EMAIL || 'dogfood-account@example.com'; // point at a dedicated load-test account, not a real user's account
const LOGIN_PASSWORD = __ENV.LOGIN_PASSWORD || 'change-me';

const failureRate = new Rate('login_failed');
const rateLimitedRate = new Rate('login_rate_limited');
const duration = new Trend('login_duration', true);

export const options = {
  scenarios: {
    concurrent_logins: {
      executor: 'shared-iterations',
      vus: 10,
      iterations: 10,
      maxDuration: '5s',
    },
  },
  thresholds: {
    login_duration: ['p(95)<600'],
    login_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const payload = JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD });

  const res = http.post(`${BASE_URL}/auth/login`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /auth/login' },
  });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body has a token': (r) => {
      try {
        return typeof r.json('token') === 'string' && r.json('token').length > 0;
      } catch {
        return false;
      }
    },
  });

  failureRate.add(!ok);
  rateLimitedRate.add(res.status === 429);
  duration.add(res.timings.duration);
  sleep(0.5);
}

export function teardown() {
  console.log(
    'Manually check the run summary for any 429 (rate-limited) responses before drawing ' +
      'conclusions from this script -- a real rate limiter kicking in would show up as failed ' +
      'checks/high login_failed rate, not necessarily a meaningful performance finding.'
  );
}
