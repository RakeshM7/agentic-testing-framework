import { test, expect } from '../fixtures/api-fixtures';

// GET /events -- search/filter combination & data-anomaly coverage for the app-wide feature
// (events search & filtering on /events). See artifacts/eventhub/api/api-test-plan.md section 17.
//
// This file deliberately does NOT re-test what events.spec.ts (from the event-booking run) already
// covers -- single-filter functional cases (category alone, city alone, search alone), basic
// pagination boundaries, and the no-token/valid-token/invalid-token auth-discrepancy checks all
// already live there. This file adds: AND/OR filter-combination semantics, a genuine zero-result
// search case, and the "Hollywood Monsoon Night -- Los Angeles" city/dropdown data-anomaly check
// flagged in the clarifications doc, tested here at the API level (GET-only, read-only throughout).

const FIXTURES = {
  283: { title: 'World Tech Summit', category: 'Conference', city: 'Hyderabad' },
  284: { title: 'Hollywood Monsoon Night', category: 'Concert', city: 'Los Angeles' },
  285: { title: 'Dilli Diwali Mela', category: 'Festival', city: 'Delhi' },
};

test.describe('GET /events -- filter combinations (AND/intersection semantics)', () => {
  test('Functional: category=Concert&city=Los Angeles combined matches event 284 only', async ({ request }) => {
    const response = await request.get('/events', {
      params: { category: 'Concert', city: 'Los Angeles' },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();

    for (const event of body.data) {
      expect(event.category).toBe('Concert');
      expect(event.city).toBe('Los Angeles');
    }
    const ids = body.data.map((e: any) => e.id);
    expect(ids).toContain(284);
  });

  test('Functional: category=Concert&city=Delhi combined matches zero events (AND, not OR)', async ({
    request,
  }) => {
    // Resolves TC-app-wide-027's open question at the API level: 284 is Concert (but city=Los
    // Angeles, not Delhi); 285 is city=Delhi (but category=Festival, not Concert). If the API used
    // OR/union semantics, one of them would incorrectly still be returned.
    const response = await request.get('/events', {
      params: { category: 'Concert', city: 'Delhi' },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
  });

  test('Functional: category=Festival&city=Delhi combined matches event 285 only', async ({ request }) => {
    const response = await request.get('/events', {
      params: { category: 'Festival', city: 'Delhi' },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const ids = body.data.map((e: any) => e.id);
    expect(ids).toContain(285);
    for (const event of body.data) {
      expect(event.category).toBe('Festival');
      expect(event.city).toBe('Delhi');
    }
  });
});

test.describe('GET /events -- search with no matches', () => {
  test('Negative/Boundary: search term matching no seeded event returns empty data, not an error', async ({
    request,
  }) => {
    const response = await request.get('/events', { params: { search: 'zzz-no-match-zzz' } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });
});

test.describe('GET /events -- "Hollywood Monsoon Night / Los Angeles" city-filter data anomaly', () => {
  test('Boundary (data anomaly): city=Los Angeles is accepted and returns event 284, despite not being a selectable frontend dropdown option', async ({
    request,
  }) => {
    // The clarifications doc flags this as a likely data/dropdown-mismatch bug: the frontend's City
    // filter dropdown only offers Mumbai/Bangalore/Delhi/Hyderabad/Chennai/Pune, so a human user can
    // never select "Los Angeles" through the UI -- yet event 284 genuinely has city="Los Angeles".
    // This test documents that the underlying API itself has no such restriction (`city` has no
    // `enum` constraint in the spec, unlike `category`): calling the API directly with
    // city=Los Angeles works correctly and returns the event. This confirms the gap is purely in
    // the frontend's fixed dropdown option list, not a defect in the API's filtering capability.
    const response = await request.get('/events', { params: { city: 'Los Angeles' } });
    expect(response.status()).toBe(200);
    const body = await response.json();

    const match = body.data.find((e: any) => e.id === 284);
    expect(match).toBeDefined();
    expect(match.city).toBe('Los Angeles');
    expect(match.title).toContain(FIXTURES[284].title);
  });

  test("Cross-check: event 284's city value is exactly what the frontend dropdown cannot represent", async ({
    request,
  }) => {
    const response = await request.get('/events/284');
    expect(response.status()).toBe(200);
    const body = await response.json();

    const KNOWN_DROPDOWN_CITIES = ['Mumbai', 'Bangalore', 'Delhi', 'Hyderabad', 'Chennai', 'Pune'];
    expect(body.data.city).toBe('Los Angeles');
    expect(KNOWN_DROPDOWN_CITIES).not.toContain(body.data.city);
  });
});
