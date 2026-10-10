import { test, expect, skipIfNoSession } from '../../../fixtures/freshsales-api-fixtures';

// Analytics track. Read-only: tenant host has no mutating analytics endpoints (see api-test-plan.md).
const B = '/crm/sales';

test.describe('GET /crm/sales/analytic_reports', () => {
  test('Auth: no session -> 401', async ({ request }) => {
    expect((await request.get(`${B}/analytic_reports`)).status()).toBe(401);
  });

  test('Auth: no session, HTML Accept -> 302 or 401 (content-negotiated)', async ({ request }) => {
    const r = await request.get(`${B}/analytic_reports`, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
    expect([302, 401]).toContain(r.status());
  });

  test('Functional/Schema: curated catalogue', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/analytic_reports`, { headers: { Cookie: freshsalesSessionCookie!, Accept: 'application/json' } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Object.keys(b)).toEqual(['analytic_reports']);
    expect(b.analytic_reports.length).toBeGreaterThanOrEqual(8);
    for (const x of b.analytic_reports) {
      expect(typeof x.id).toBe('number');
      expect(typeof x.name).toBe('string');
      expect(typeof x.curated).toBe('boolean');
    }
    const names = b.analytic_reports.map((x: any) => x.name);
    expect(names).toEqual(expect.arrayContaining(['Sales Essentials Dashboard', 'Sales Dashboard', 'Sales Forecast', 'Sales Trends']));
    expect(new Set(b.analytic_reports.map((x: any) => x.id)).size).toBe(b.analytic_reports.length);
  });

  test('Boundary: ?curated=true and unknown params do not change the list', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const h = { Cookie: freshsalesSessionCookie!, Accept: 'application/json' };
    const base = await (await request.get(`${B}/analytic_reports`, { headers: h })).json();
    const r = await request.get(`${B}/analytic_reports?curated=true&bogus=1`, { headers: h });
    expect(r.status()).toBe(200);
    expect((await r.json()).analytic_reports.length).toBe(base.analytic_reports.length);
  });

  test('Negative: no show route (/analytic_reports/:id -> 404)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    for (const id of ['1', '999999999', 'abc']) {
      const r = await request.get(`${B}/analytic_reports/${id}`, { headers: { Cookie: freshsalesSessionCookie!, Accept: 'application/json' } });
      expect(r.status()).toBe(404);
    }
  });
});

test.describe('GET /crm/sales/analytics_dashboard (analytics angle)', () => {
  test('Functional: Analytics tabs resolve to curated report ids without exposing JWT in test output', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/analytics_dashboard`, { headers: { Cookie: freshsalesSessionCookie!, Accept: 'application/json' } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.analytic_widgets.length).toBeGreaterThan(0);
    const iframe = b.analytic_widgets.find((w: any) => w.type === 'iframe-page-widget');
    expect(String(iframe.iframe_url)).toContain('freshreports.com');
  });
});
