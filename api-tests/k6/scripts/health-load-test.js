import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Lightweight synthetic-monitoring-style load profile for GET /health.
 *
 * GENERATED BUT NOT EXECUTED LIVE. See api-tests/k6/README.md. Only `k6 inspect` (static
 * validation) may have been run against this script -- never `k6 run` against the live target.
 */

const BASE_URL = __ENV.BASE_URL || 'https://api.eventhub.rahulshettyacademy.com/api';

const failureRate = new Rate('health_failed');
const duration = new Trend('health_duration', true);

export const options = {
  vus: 5,
  duration: '1m',
  thresholds: {
    health_duration: ['p(95)<200'],
    health_failed: ['rate<0.001'],
    http_req_failed: ['rate<0.001'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/health`, {
    tags: { name: 'GET /health' },
  });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'status field is ok': (r) => {
      try {
        return r.json('status') === 'ok';
      } catch {
        return false;
      }
    },
  });

  failureRate.add(!ok);
  duration.add(res.timings.duration);
  sleep(1);
}
