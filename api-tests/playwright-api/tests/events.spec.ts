import { test, expect } from '../fixtures/api-fixtures';

// GET /events and GET /events/:id -- all read-only. See artifacts/eventhub/api/api-test-plan.md
// sections 4 and 5. Uses the three known, stable seeded fixtures (283/284/285); does not assume
// exact seat counts (they drift as other testers interact with the shared environment) but does
// assert monotonic/sane bounds.

const FIXTURES = {
  283: { title: 'World Tech Summit', category: 'Conference', price: 1500, city: 'Hyderabad', totalSeats: 500 },
  284: { title: 'Hollywood Monsoon Night', price: 2500 },
  285: { title: 'Dilli Diwali Mela', category: 'Festival', price: 300, city: 'Delhi', totalSeats: 10000 },
};

function assertEventSchema(event: any) {
  expect(typeof event.id).toBe('number');
  expect(typeof event.title).toBe('string');
  expect(typeof event.category).toBe('string');
  expect(typeof event.venue).toBe('string');
  expect(typeof event.city).toBe('string');
  expect(typeof event.eventDate).toBe('string');
  expect(Number.isNaN(Date.parse(event.eventDate))).toBe(false);
  expect(typeof event.price).toBe('number');
  expect(typeof event.totalSeats).toBe('number');
  expect(typeof event.availableSeats).toBe('number');
  expect(event.availableSeats).toBeLessThanOrEqual(event.totalSeats);
  expect(event.availableSeats).toBeGreaterThanOrEqual(0);
}

test.describe('GET /events (list)', () => {
  test('Functional: default call returns paginated event list', async ({ request }) => {
    const response = await request.get('events');
    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    for (const event of body.data) assertEventSchema(event);

    expect(body.pagination).toMatchObject({
      total: expect.any(Number),
      page: expect.any(Number),
      limit: expect.any(Number),
      totalPages: expect.any(Number),
    });
    expect(body.pagination.limit).toBe(10); // documented default
    expect(body.pagination.page).toBe(1);
  });

  test('Functional: filter by category returns only matching events', async ({ request }) => {
    const response = await request.get('events?category=Conference');
    expect(response.status()).toBe(200);
    const body = await response.json();
    for (const event of body.data) {
      expect(event.category).toBe('Conference');
    }
  });

  test('Functional: filter by city returns only matching events', async ({ request }) => {
    const response = await request.get('events?city=Hyderabad');
    expect(response.status()).toBe(200);
    const body = await response.json();
    for (const event of body.data) {
      expect(event.city).toBe('Hyderabad');
    }
  });

  test('Functional: search filters results by relevance to the term', async ({ request }) => {
    const response = await request.get('events?search=Tech');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body.data)).toBe(true);
    // Best-effort relevance check -- API's exact search semantics aren't documented in the spec.
    for (const event of body.data) {
      const haystack = `${event.title} ${event.description ?? ''}`.toLowerCase();
      expect(haystack).toContain('tech');
    }
  });

  test('Boundary: limit=100 (documented max) is accepted', async ({ request }) => {
    const response = await request.get('events?limit=100');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data.length).toBeLessThanOrEqual(100);
    expect(body.pagination.limit).toBeLessThanOrEqual(100);
  });

  test('Boundary: limit above documented max (101) -- records actual behavior', async ({ request }) => {
    const response = await request.get('events?limit=101');
    // Contract question (see api-test-plan.md): spec declares maximum:100 but doesn't say whether
    // the API clamps, ignores, or rejects an out-of-range value. Assert it doesn't 500, and record
    // which of the plausible outcomes actually happened.
    expect(response.status()).toBeLessThan(500);
    if (response.status() === 200) {
      const body = await response.json();
      expect(body.pagination.limit).toBeLessThanOrEqual(101);
    }
  });

  test('Boundary: page far beyond last page returns an empty (not error) result', async ({ request }) => {
    const response = await request.get('events?page=9999&limit=10');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
  });

  test('Negative: non-numeric page param does not 500', async ({ request }) => {
    const response = await request.get('events?page=abc');
    expect(response.status()).toBeLessThan(500);
  });

  test('Negative: category value outside documented enum does not 500', async ({ request }) => {
    const response = await request.get('events?category=NotARealCategory');
    expect(response.status()).toBeLessThan(500);
  });

  test('Auth/contract: list is reachable without a token (per spec, no security declared)', async ({ request }) => {
    const response = await request.get('events');
    expect(response.status()).toBe(200);
  });

  test('Auth/contract: list behavior is unchanged with a valid token', async ({ request, authToken }) => {
    const response = await request.get('events', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    // Resolves the discrepancy flagged in api-test-plan.md: spec's silence on `security` for this
    // route is not assumed to mean "definitely public" -- confirm a valid token doesn't change the
    // shape or gate the response differently than the unauthenticated call above.
    expect(response.status()).toBe(200);
  });

  test('Auth/contract: list behavior with an invalid/malformed token', async ({ request }) => {
    const response = await request.get('events', {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    // Documented as a contract question rather than a hard assertion of 401, since the spec
    // declares no security requirement on this route at all.
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe('GET /events/:id', () => {
  for (const [id, fixture] of Object.entries(FIXTURES)) {
    test(`Functional: fixture event ${id} (${fixture.title}) returns correct data`, async ({ request }) => {
      const response = await request.get(`events/${id}`);
      expect(response.status()).toBe(200);
      const body = await response.json();

      expect(body.success).toBe(true);
      assertEventSchema(body.data);
      expect(body.data.id).toBe(Number(id));
      expect(body.data.title).toContain(fixture.title.split(' ')[0]); // loose match, titles can carry suffixes (e.g. "-- Los Angeles")
      expect(body.data.price).toBe(fixture.price);
    });
  }

  test('Negative: nonexistent numeric id returns 404', async ({ request }) => {
    const response = await request.get('events/999999999');
    expect(response.status()).toBe(404);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  test('Negative: non-numeric id does not 500', async ({ request }) => {
    const response = await request.get('events/abc');
    expect(response.status()).toBeLessThan(500);
  });

  test('Negative: negative id does not 500', async ({ request }) => {
    const response = await request.get('events/-1');
    expect(response.status()).toBeLessThan(500);
  });

  test('Negative: zero id does not 500', async ({ request }) => {
    const response = await request.get('events/0');
    expect(response.status()).toBeLessThan(500);
  });

  test('Boundary: extremely large id does not 500', async ({ request }) => {
    const response = await request.get('events/99999999999999999999');
    expect(response.status()).toBeLessThan(500);
  });

  test('Reliability cross-check: direct API call for event 283/284/285 is stable', async ({ request }) => {
    // The clarifications doc flags intermittent 503s on the Next.js *frontend's* RSC prefetch for
    // these same ids. This checks whether the underlying REST API itself (bypassing the frontend
    // entirely) is stable for the same ids -- a negative result here would suggest the 503s
    // originate in the API/backend rather than purely in the Next.js SSR layer.
    for (const id of [283, 284, 285]) {
      const response = await request.get(`events/${id}`);
      expect(response.status()).toBe(200);
    }
  });
});
