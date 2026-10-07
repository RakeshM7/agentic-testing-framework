import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Load profile for GET /events (listing) and GET /events/:id (detail).
 *
 * GENERATED BUT NOT EXECUTED LIVE. See api-tests/k6/README.md -- per the api-testing-agent's hard
 * rule, this script has never been run with `k6 run` against the live EventHub target. Only
 * `k6 inspect` (static validation) may have been run against it. A human must explicitly choose to
 * run this, and should not point BASE_URL at the shared public demo unless they own/accept
 * responsibility for that target's load.
 *
 * Rationale (see artifacts/eventhub/api/api-test-plan.md, Performance section):
 *  - GET /events is the highest-traffic read path (event listing is the app's main landing surface).
 *  - GET /events/:id is the second-highest-traffic read, and also the route where the frontend's
 *    Next.js RSC prefetch layer showed intermittent 503s during exploration -- this script exists
 *    partly to help a human determine whether the underlying REST API is itself stable under load,
 *    independent of that frontend-layer flakiness.
 */

const BASE_URL = __ENV.BASE_URL || 'https://api.eventhub.rahulshettyacademy.com/api';
const KNOWN_EVENT_IDS = [283, 284, 285]; // seeded fixtures: World Tech Summit / Hollywood Monsoon Night / Dilli Diwali Mela

const listFailureRate = new Rate('events_list_failed');
const detailFailureRate = new Rate('events_detail_failed');
const listDuration = new Trend('events_list_duration', true);
const detailDuration = new Trend('events_detail_duration', true);

export const options = {
  scenarios: {
    events_list: {
      executor: 'ramping-vus',
      exec: 'listEvents',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 30 },
        { duration: '2m', target: 30 },
        { duration: '30s', target: 0 },
      ],
    },
    events_detail: {
      executor: 'ramping-vus',
      exec: 'getEventDetail',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 20 },
        { duration: '2m', target: 20 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    'events_list_duration': ['p(95)<800'],
    'events_detail_duration': ['p(95)<500'],
    'events_list_failed': ['rate<0.01'],
    'events_detail_failed': ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

export function listEvents() {
  const res = http.get(`${BASE_URL}/events?page=1&limit=10`, {
    tags: { name: 'GET /events' },
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
  });

  listFailureRate.add(!ok);
  listDuration.add(res.timings.duration);
  sleep(1);
}

export function getEventDetail() {
  const id = KNOWN_EVENT_IDS[Math.floor(Math.random() * KNOWN_EVENT_IDS.length)];
  const res = http.get(`${BASE_URL}/events/${id}`, {
    tags: { name: 'GET /events/:id' },
  });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'body has event id': (r) => {
      try {
        return r.json('data.id') === id;
      } catch {
        return false;
      }
    },
  });

  detailFailureRate.add(!ok);
  detailDuration.add(res.timings.duration);
  sleep(1);
}
