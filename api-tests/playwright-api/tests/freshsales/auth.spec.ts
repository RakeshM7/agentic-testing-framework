import { test, expect } from '../../fixtures/api-fixtures';

// Auth-boundary checks for the rakesh-freshsales-ind-sep21 tenant's /crm/sales/* app API.
//
// These are the ONE category of test in this suite that runs for real without needing the
// blocked authenticated session (see fixtures/freshsales-api-fixtures.ts and
// artifacts/rakesh-freshsales-ind-sep21/api/api-test-plan.md "Execution status"): they deliberately
// send NO session cookie and assert on the resulting response, confirmed live by this agent
// (2026-09-21, read-only GETs only).
//
// IMPORTANT/CONTENT-NEGOTIATION FINDING: this tenant's auth-failure response depends on the
// Accept header, not just on the missing session:
//   - No Accept header (a plain browser navigation): 302 redirect to /crm/sales/signin (HTML flow).
//   - `Accept: application/json` (this project's default -- see playwright.config.ts's
//     `extraHTTPHeaders`, and any real API client): 401 with a JSON body
//     `{"login":"failed","message":null}`.
// Both were verified live via curl before writing these assertions. The tests below exercise the
// JSON path, since that's what this project's `request` fixture actually sends and what any real
// API-calling client would receive.

test.describe('Auth: unauthenticated access to /crm/sales/* is redirected, not data-leaked', () => {
  test('Negative/Auth: GET /crm/sales/contacts without a session returns 401 JSON (Accept: application/json)', async ({
    request,
  }) => {
    const response = await request.get('/crm/sales/contacts');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ login: 'failed' });
  });

  test('Negative/Auth: GET /crm/sales/deals without a session returns 401 JSON', async ({ request }) => {
    const response = await request.get('/crm/sales/deals');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ login: 'failed' });
  });

  test('Negative/Auth: GET /crm/sales/sales_accounts without a session returns 401 JSON', async ({
    request,
  }) => {
    const response = await request.get('/crm/sales/sales_accounts');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({ login: 'failed' });
  });

  test('Auth/contract: with Accept: */* (a plain browser-style request), the same unauthenticated request instead 302s to /crm/sales/signin (HTML flow)', async ({
    playwright,
  }) => {
    // Verified live (2026-09-21) that Playwright's default request headers alone are NOT enough to
    // reproduce the 302 -- this tenant's content negotiation keys specifically off an explicit
    // `Accept: */*` (what curl and real browser navigations send), not merely the absence of an
    // `Accept: application/json` override. Both this test and the four 401-JSON tests above were
    // empirically verified against the live tenant before being written, not assumed.
    const context = await playwright.request.newContext({
      baseURL: 'https://rakesh-freshsales-ind-sep21.myfreshworks.com',
    });
    const response = await context.get('/crm/sales/contacts', {
      maxRedirects: 0,
      headers: { Accept: '*/*' },
    });
    expect(response.status()).toBe(302);
    expect(response.headers()['location']).toContain('/crm/sales/signin');
    await context.dispose();
  });

  test('Schema/contract: the 401 JSON body never leaks record data alongside the failure', async ({
    request,
  }) => {
    const response = await request.get('/crm/sales/contacts');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.data).toBeUndefined();
    expect(Array.isArray(body)).toBe(false);
  });
});
