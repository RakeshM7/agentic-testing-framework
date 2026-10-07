import { test, expect, skipIfNoSession } from '../../fixtures/freshsales-api-fixtures';

// Accounts (sales_accounts) coverage -- see api-test-plan.md section 2. Per the finalized
// clarifications doc, standalone Account creation is explicitly OUT OF SCOPE (the only in-scope
// creation path is the inline auto-create from the Add Contact form, exercised implicitly as part
// of contacts.spec.ts's create-contact flow, not duplicated here). This file covers read/list/
// negative/boundary coverage on the resulting sales_accounts resource.

function assertAccountSchema(account: any) {
  expect(typeof account.id).toBe('number');
  expect(typeof account.name).toBe('string');
}

test.describe('GET /crm/sales/sales_accounts (list/lookup)', () => {
  test('Functional: the inline-created "Explore Test Co" account resolves by name', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/sales_accounts?name=Explore+Test+Co', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const accounts = Array.isArray(body) ? body : body.sales_accounts || body.data;
    expect(Array.isArray(accounts)).toBe(true);
    expect(accounts.length).toBeGreaterThanOrEqual(1);
    for (const account of accounts) assertAccountSchema(account);
  });

  test('Boundary: per_page far beyond actual row count returns all rows without erroring', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/sales_accounts?per_page=1000&page=1', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBe(200);
  });

  test('Boundary: page far beyond the last page returns an empty, not error, result', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/sales_accounts?per_page=25&page=9999', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const accounts = Array.isArray(body) ? body : body.sales_accounts || body.data;
    expect(accounts).toEqual([]);
  });

  test('Negative: non-numeric segment_id does not 500', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/sales_accounts?segment_id=abc', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe('POST /crm/sales/sales_accounts (inline create validation)', () => {
  test('Negative: blank account name is rejected', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.post('/crm/sales/sales_accounts', {
      headers: { Cookie: freshsalesSessionCookie! },
      data: { name: '' },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });
});
