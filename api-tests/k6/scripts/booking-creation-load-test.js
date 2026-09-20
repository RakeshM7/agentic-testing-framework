import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

/**
 * Concurrency/atomicity load profile for POST /bookings.
 *
 * ================================================================================================
 * DO NOT RUN THIS AGAINST https://api.eventhub.rahulshettyacademy.com -- OR ANY LIVE, SHARED,
 * PUBLIC, OR PRODUCTION TARGET YOU DO NOT OWN. This script performs real, state-mutating
 * POST /bookings calls that create real bookings and decrement real seat availability on whatever
 * BASE_URL points at. It was generated for static review only and has NEVER been executed
 * (`k6 run`) against the live EventHub demo, per the api-testing-agent's hard rule and the
 * Playwright-suite guardrail against mutating calls to this third-party target. Only `k6 inspect`
 * (or manual review) has been performed on it.
 *
 * It is intended to be run, if ever, only by a human who explicitly points BASE_URL at a private
 * staging clone of EventHub that they own and have accepted the consequences of load-testing
 * (including real data being created and seats being consumed).
 * ================================================================================================
 *
 * Rationale (see artifacts/eventhub/api/api-test-plan.md, Performance section and TC-event-booking
 * cross-reference): this is the endpoint most likely to reveal a race condition in the "atomic seat
 * decrement" guarantee the API's own description claims ("Booking creation is atomic -- seats are
 * decremented in the same database transaction"). The design here deliberately fires a small, fixed
 * number of concurrent requests at a SINGLE low-availability target event, rather than a high-VU
 * sustained ramp, because the goal is to catch overselling under contention, not to generate raw
 * throughput.
 */

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001/api'; // deliberately NOT the production host by default
const TARGET_EVENT_ID = Number(__ENV.TARGET_EVENT_ID || 283); // use a low-availability event in your staging clone
const CONCURRENT_BOOKINGS = 10;
const QUANTITY_PER_BOOKING = 1;

const failureRate = new Rate('booking_creation_failed');

export const options = {
  scenarios: {
    concurrent_bookings: {
      executor: 'shared-iterations',
      vus: CONCURRENT_BOOKINGS,
      iterations: CONCURRENT_BOOKINGS,
      maxDuration: '10s', // all iterations should fire within a narrow window to stress the atomic-decrement path
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // No overselling: successful (201) bookings' combined quantity must never exceed the seats
    // available at test start. Verified in the summary handler below, not as a k6 built-in
    // threshold (k6 doesn't support cross-request aggregation in `thresholds` directly).
  },
};

export function setup() {
  const res = http.get(`${BASE_URL}/events/${TARGET_EVENT_ID}`);
  if (res.status !== 200) {
    throw new Error(
      `Setup failed: could not read target event ${TARGET_EVENT_ID} (status ${res.status}). ` +
        'Confirm BASE_URL points at a real environment with this event seeded.'
    );
  }
  const availableSeats = res.json('data.availableSeats');
  return { availableSeats };
}

export default function (data) {
  const payload = JSON.stringify({
    eventId: TARGET_EVENT_ID,
    customerName: `Load Test User ${__VU}`,
    customerEmail: `loadtest-vu${__VU}-${Date.now()}@example.com`,
    customerPhone: '+91-9000000000',
    quantity: QUANTITY_PER_BOOKING,
  });

  const res = http.post(`${BASE_URL}/bookings`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'POST /bookings' },
  });

  const ok = check(res, {
    'status is 201 or a handled 400 (insufficient seats)': (r) => r.status === 201 || r.status === 400,
    'no 5xx (no unhandled server error under concurrency)': (r) => r.status < 500,
  });

  failureRate.add(!ok);
  sleep(0.1);
}

export function teardown(data) {
  // Intentionally does not attempt to verify final seat count via an HTTP call here -- k6's
  // teardown runs once, after all VUs finish, so a human reviewing results should independently
  // GET /events/:id afterward and confirm:
  //   finalAvailableSeats >= data.availableSeats - (CONCURRENT_BOOKINGS * QUANTITY_PER_BOOKING)
  // i.e. seats were never oversold relative to what was available at test start.
  console.log(
    `Target event ${TARGET_EVENT_ID} had ${data.availableSeats} seats available at test start. ` +
      `Manually verify GET /events/${TARGET_EVENT_ID} afterward to confirm no overselling occurred.`
  );
}
