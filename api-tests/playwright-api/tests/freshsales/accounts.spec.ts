import { test, expect, skipIfNoSession, skipUnlessMutationReady } from '../../fixtures/freshsales-api-fixtures';

// sales_accounts coverage. Live-verified (read-only): list requires segment_id (bare list or
// ?name= filter returns 403, and so does a non-numeric segment_id); detail is wrapped in {sales_account}.
// Standalone account creation is out of scope per clarifications.

const ACCOUNTS_SEGMENT = 402015942758;
const SAMPLE_ACCOUNT_ID = 402012383128;

function assertAccountSchema(a: any) {
  expect(typeof a.id).toBe('number');
  expect(typeof a.name).toBe('string');
}

test.describe('GET /crm/sales/sales_accounts', () => {
  test('Functional/Schema: list with segment_id returns {sales_accounts}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/sales_accounts?page=1&per_page=5&segment_id=${ACCOUNTS_SEGMENT}`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.sales_accounts)).toBe(true);
    for (const a of b.sales_accounts) assertAccountSchema(a);
  });

  test('Functional/Schema: detail wrapped in {sales_account}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/sales_accounts/${SAMPLE_ACCOUNT_ID}`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    assertAccountSchema((await r.json()).sales_account);
  });

  test('Boundary: per_page=1000 returns 200', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/sales_accounts?page=1&per_page=1000&segment_id=${ACCOUNTS_SEGMENT}`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
  });

  test('Boundary: page far beyond last page returns an empty list', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/sales_accounts?page=9999&per_page=25&segment_id=${ACCOUNTS_SEGMENT}`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    expect((await r.json()).sales_accounts).toEqual([]);
  });

  test('Negative/contract: list without a valid segment_id is 403 (documented quirk; no 5xx)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    for (const q of ['name=Explore+Test+Co', 'segment_id=abc']) {
      const r = await request.get(`/crm/sales/sales_accounts?${q}`, { headers: { Cookie: freshsalesSessionCookie! } });
      expect(r.status()).toBe(403);
    }
  });

  test('Negative: nonexistent account id is 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get('/crm/sales/sales_accounts/999999999999', { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
  });
});

test.describe('POST /crm/sales/sales_accounts (validation only; creates nothing if rejected)', () => {
  test('Negative: blank account name is rejected', async ({ request, freshsalesSessionCookie }) => {
    skipUnlessMutationReady(!!freshsalesSessionCookie);
    const r = await request.post('/crm/sales/sales_accounts', { headers: { Cookie: freshsalesSessionCookie! }, data: { sales_account: { name: '' } } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });
});
