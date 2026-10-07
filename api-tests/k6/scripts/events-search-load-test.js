import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

/**
 * Load profile for GET /events search/filter variants (search=, category=, city=, and combined
 * filters) -- added by the app-wide run (events search & filtering feature).
 *
 * GENERATED BUT NOT EXECUTED LIVE. See api-tests/k6/README.md -- per the api-testing-agent's hard
 * rule, this script has never been run with `k6 run` against the live EventHub target. Only
 * `k6 inspect` (static validation) may have been run against it. A human must explicitly choose to
 * run this, and should not point BASE_URL at the shared public demo unless they own/accept
 * responsibility for that target's load.
 *
 * Rationale (see artifacts/eventhub/api/api-test-plan.md, Performance section): this deliberately
 * does NOT duplicate events-load-test.js's plain-listing scenario. A `search=` query is plausibly a
 * `LIKE`/full-text lookup with a different (likely less predictable) query plan than a plain
 * paginated SELECT, so it's modeled as its own scenario with a slightly looser p95 threshold. The
 * combined-filter requests also exercise the AND/intersection-semantics code path under load, not
 * just correctness (already covered functionally in events-search-filter.spec.ts).
 */

const BASE_URL = __ENV.BASE_URL || 'https://api.eventhub.rahulshettyacademy.com/api';

const SEARCH_TERMS = ['Tech', 'Diwali', 'Monsoon', 'Summit', 'zzz-no-match-zzz'];
const CATEGORIES = ['Conference', 'Concert', 'Festival', 'Sports', 'Workshop'];
const CITIES = ['Hyderabad', 'Delhi', 'Los Angeles', 'Mumbai', 'Bangalore'];

const failureRate = new Rate('events_search_failed');
const duration = new Trend('events_search_duration', true);

export const options = {
  scenarios: {
    events_search_filter: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: 25 },
        { duration: '90s', target: 25 },
        { duration: '20s', target: 0 },
      ],
    },
  },
  thresholds: {
    events_search_duration: ['p(95)<900'], // looser than plain listing (800ms) given search query-plan uncertainty
    events_search_failed: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

function randomOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function () {
  // Rotate through four request shapes each iteration: plain search, category filter, city filter,
  // and a combined category+city filter -- covering the same variety events-search-filter.spec.ts
  // asserts correctness for, now under concurrent load.
  const variant = Math.floor(Math.random() * 4);
  let url;
  let tagName;

  if (variant === 0) {
    url = `${BASE_URL}/events?search=${encodeURIComponent(randomOf(SEARCH_TERMS))}`;
    tagName = 'GET /events?search=';
  } else if (variant === 1) {
    url = `${BASE_URL}/events?category=${encodeURIComponent(randomOf(CATEGORIES))}`;
    tagName = 'GET /events?category=';
  } else if (variant === 2) {
    url = `${BASE_URL}/events?city=${encodeURIComponent(randomOf(CITIES))}`;
    tagName = 'GET /events?city=';
  } else {
    url = `${BASE_URL}/events?category=${encodeURIComponent(randomOf(CATEGORIES))}&city=${encodeURIComponent(
      randomOf(CITIES)
    )}`;
    tagName = 'GET /events?category=&city= (combined)';
  }

  const res = http.get(url, { tags: { name: tagName } });

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

  failureRate.add(!ok);
  duration.add(res.timings.duration);
  sleep(1);
}
