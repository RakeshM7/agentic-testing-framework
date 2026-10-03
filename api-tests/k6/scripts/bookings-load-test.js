import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { requireBaseUrl } from './lib/guard.js';

/**
 * Load profile for GET /bookings (paginated list, read-only).
 *
 * GENERATED BUT NOT EXECUTED LIVE. See api-tests/k6/README.md. Only `k6 inspect` (static
 * validation) may have been run against this script -- never `k6 run` against the live target.
 *
 * Rationale (see artifacts/eventhub/api/api-test-plan.md, Performance section): bookings is a
 * read-heavy, paginated resource with potentially large result sets as the environment
 * accumulates data over time.
 */

const BASE_URL = requireBaseUrl(__ENV.BASE_URL);

const failureRate = new Rate('bookings_list_failed');
const duration = new Trend('bookings_list_duration', true);

export const options = {
  scenarios: {
    bookings_list: {
      executor: 'ramping-vus',
      exec: 'listBookings',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 },
        { duration: '1m', target: 20 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    bookings_list_duration: ['p(95)<800'],
    bookings_list_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

export function listBookings() {
  const res = http.get(`${BASE_URL}/bookings?page=1&limit=10`, {
    tags: { name: 'GET /bookings' },
  });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body has data array': (r) => {
      try {
        return Array.isArray(r.json('data'));
      } catch {
        return false;
      }
    },
    'body has pagination meta': (r) => {
      try {
        return typeof r.json('pagination.total') === 'number';
      } catch {
        return false;
      }
    },
  });

  failureRate.add(!ok);
  duration.add(res.timings.duration);
  sleep(1);
}
