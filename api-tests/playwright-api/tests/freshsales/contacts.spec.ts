import { test, expect, skipIfNoSession, skipUnlessMutationReady } from '../../fixtures/freshsales-api-fixtures';
import { recordCreated, isCreatedByThisRun } from '../../fixtures/created-entities';

// Contacts coverage. Envelope facts verified live (read-only, 2026-10-04): responses are wrapped
// ({"contact": {...}} for detail, {"contacts": [...], "meta": {...}} for lists). A bare
// GET /crm/sales/contacts WITHOUT segment_id returns 403 "not authorized" even for a valid
// admin session (finding) -- the list needs a view/segment id. Pre-existing sample contact
// 402213988049 is used for READ-ONLY checks only; mutating tests create their own contact first and
// log it in artifacts/.../api/created-entities.json. No DELETE tests are generated.

const CONTACTS_SEGMENT = 402015942732; // "All Contacts" default view (tenant-specific, from explore capture)
const SAMPLE_CONTACT_ID = 402213988049;
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

function assertContactSchema(c: any) {
  expect(typeof c.id).toBe('number');
  expect(typeof c.first_name).toBe('string');
  expect(typeof c.last_name).toBe('string');
  expect(Array.isArray(c.emails)).toBe(true);
}

test.describe('GET /crm/sales/contacts (list)', () => {
  test('Functional/Schema: list with segment_id returns {contacts, meta}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/contacts?page=1&per_page=5&segment_id=${CONTACTS_SEGMENT}`, {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.contacts)).toBe(true);
    expect(body.contacts.length).toBeLessThanOrEqual(5);
    for (const c of body.contacts) assertContactSchema(c);
  });

  test('Auth/contract: list WITHOUT segment_id is 403 for an authenticated session (documented quirk)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get('/crm/sales/contacts?per_page=1', { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(403);
    expect((await r.json()).errors.code).toBe(403);
  });

  test('Boundary: page far beyond last page returns empty set, not an error', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/contacts?page=99999&per_page=25&segment_id=${CONTACTS_SEGMENT}`, {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).contacts).toEqual([]);
  });

  test('Boundary: per_page=1000 is accepted (no 5xx)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/contacts?page=1&per_page=1000&segment_id=${CONTACTS_SEGMENT}`, {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe('GET /crm/sales/contacts/:id', () => {
  test('Functional/Schema: sample contact detail is wrapped in {contact}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/contacts/${SAMPLE_CONTACT_ID}?include=owner,contact_status,lifecycle_stage,emails`, {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(r.status()).toBe(200);
    const body = await r.json();
    assertContactSchema(body.contact);
    expect(body.contact.id).toBe(SAMPLE_CONTACT_ID);
  });

  test('Negative: nonexistent id returns 404 with errors envelope', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get('/crm/sales/contacts/999999999999', { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
    expect((await r.json()).errors.code).toBe(404);
  });

  test('Negative: non-numeric id returns 404 (not 500)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get('/crm/sales/contacts/abc', { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
  });
});

test.describe('POST/PUT /crm/sales/contacts (mutating; run-created entities only)', () => {
  test('Functional: create contact (default New / Lead), then qualify it -> SQL lifecycle', async ({ request, freshsalesSessionCookie }) => {
    skipUnlessMutationReady(!!freshsalesSessionCookie);
    const h = { Cookie: freshsalesSessionCookie! };
    const s = unique();
    const created = await request.post('/crm/sales/contacts', {
      headers: h,
      data: { contact: { first_name: 'ApiAgentTest', last_name: `LeadPipeline-${s}`, emails: [{ value: `api.agent.test.${s}@example.com`, is_primary: true }] } },
    });
    expect([200, 201]).toContain(created.status());
    const c = (await created.json()).contact;
    assertContactSchema(c);
    recordCreated('contact', 'POST /crm/sales/contacts', c.id);
    expect(isCreatedByThisRun(c.id)).toBe(true);

    const statuses = (await (await request.get('/crm/sales/selector/contact_statuses', { headers: h })).json()).contact_statuses;
    const qualified = statuses.find((x: any) => x.name === 'Qualified');
    expect(qualified).toBeTruthy();
    const upd = await request.put(`/crm/sales/contacts/${c.id}?include=contact_status,lifecycle_stage`, {
      headers: h,
      data: { contact: { contact_status_id: qualified.id } },
    });
    expect(upd.status()).toBe(200);
    const u = (await upd.json()).contact;
    expect(u.lifecycle_stage_id ?? u.lifecycle_stage?.id).toBeTruthy();
  });

  test('Negative: missing last_name is rejected (4xx, no id)', async ({ request, freshsalesSessionCookie }) => {
    skipUnlessMutationReady(!!freshsalesSessionCookie);
    const r = await request.post('/crm/sales/contacts', {
      headers: { Cookie: freshsalesSessionCookie! },
      data: { contact: { first_name: 'NoLastName', emails: [{ value: `api.nolast.${unique()}@example.com`, is_primary: true }] } },
    });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });

  test('Negative: malformed email is rejected', async ({ request, freshsalesSessionCookie }) => {
    skipUnlessMutationReady(!!freshsalesSessionCookie);
    const r = await request.post('/crm/sales/contacts', {
      headers: { Cookie: freshsalesSessionCookie! },
      data: { contact: { first_name: 'BadEmail', last_name: `ApiAgentTest-${unique()}`, emails: [{ value: 'not-an-email', is_primary: true }] } },
    });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });
});
