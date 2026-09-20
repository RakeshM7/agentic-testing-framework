import { test, expect } from '../fixtures/api-fixtures';

// Admin event management (/admin/events) -- API-level coverage. See
// artifacts/eventhub/api/api-test-plan.md section 18.
//
// GUARDRAIL: this file is entirely GET-only. It does NOT call POST /events, PUT /events/:id, or
// DELETE /events/:id under any payload (valid, invalid, or targeting a nonexistent id) -- per this
// run's explicit authorization, admin event-creation/deletion endpoints are not executed live, full
// stop, regardless of whether a given call could plausibly avoid mutating real data (e.g. deleting a
// nonexistent id). The 6-event-max / 7th-event-FIFO-eviction business rule and the "Clear all
// bookings" bulk action are documented only in api-test-plan.md section 18 -- no test below
// exercises either of them, since doing so would require calling POST /events or a bulk-delete
// primitive this suite never calls.
//
// What IS safely testable here: whether the documented `Event` schema itself exposes any
// server-side signal (an owner id, a `readOnly`/`featured` flag, etc.) that would explain why events
// 283/284/285 render as "Read-only" with no Edit/Delete controls in the admin UI table. This is a
// pure schema/contract inspection, entirely via GET.

const SEEDED_EVENT_IDS = [283, 284, 285];

test.describe('Admin "All Events" table -- backing data inspection (GET-only)', () => {
  test('Schema/contract: seeded events 283/284/285 expose no owner/role/readOnly field distinguishing them', async ({
    request,
  }) => {
    for (const id of SEEDED_EVENT_IDS) {
      const response = await request.get(`/events/${id}`);
      expect(response.status()).toBe(200);
      const body = await response.json();
      const event = body.data;

      // Documented Event schema fields only -- see artifacts/eventhub/api/discovered-endpoints.json.
      const documentedFields = new Set([
        'id',
        'title',
        'description',
        'category',
        'venue',
        'city',
        'eventDate',
        'price',
        'totalSeats',
        'availableSeats',
        'imageUrl',
        'createdAt',
        'updatedAt',
      ]);
      const actualFields = Object.keys(event);

      // Finding (see api-test-plan.md section 19): no undocumented field (ownerId, readOnly,
      // featured, role, etc.) is present. This suggests the admin UI's "Read-only" badge for these
      // 3 events is a frontend-only concept (e.g. a hardcoded id allowlist), not something the API
      // itself is aware of -- a notable RBAC-adjacent finding, not just a schema formality.
      for (const field of actualFields) {
        expect(documentedFields.has(field)).toBe(true);
      }
    }
  });

  test('Functional: GET /events (high limit, unfiltered) includes all 3 known seeded fixtures', async ({
    request,
  }) => {
    const response = await request.get('/events', { params: { limit: 100 } });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const ids = body.data.map((e: any) => e.id);

    for (const id of SEEDED_EVENT_IDS) {
      expect(ids).toContain(id);
    }
  });

  test('Auth/contract: seeded events are readable identically with and without a token (admin-capable account)', async ({
    request,
    authToken,
  }) => {
    for (const id of SEEDED_EVENT_IDS) {
      const withoutToken = await request.get(`/events/${id}`);
      const withToken = await request.get(`/events/${id}`, {
        headers: { Authorization: `Bearer ${authToken}` },
      });

      expect(withoutToken.status()).toBe(200);
      expect(withToken.status()).toBe(200);

      const bodyWithout = await withoutToken.json();
      const bodyWith = await withToken.json();
      // Same underlying data either way -- no admin-only fields revealed by a valid (even
      // admin-capable) token. Reinforces the "no role/owner field anywhere" finding above.
      expect(bodyWith.data.id).toBe(bodyWithout.data.id);
      expect(Object.keys(bodyWith.data).sort()).toEqual(Object.keys(bodyWithout.data).sort());
    }
  });
});

// NOTE: POST /events, PUT /events/:id, DELETE /events/:id -- including the 6-event-max /
// 7th-event-FIFO-eviction boundary, and any attempt to edit/delete the "Read-only" seeded events
// 283/284/285 -- are documented-but-not-executed. See api-test-plan.md section 18 and
// discovered-endpoints.json's `unbackedFrontendFeatures` for the full scenario matrix. No test in
// this file (or anywhere in this suite) calls any of those three routes.
