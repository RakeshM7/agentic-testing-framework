import { test, expect, skipIfNoSession } from '../../../fixtures/freshsales-api-fixtures';

// Dashboards track. Read-only: no mutating tests (see artifacts/.../modules/dashboards/api/api-test-plan.md).
// NOTE: analytic_widgets[].iframe_url embeds a JWT -- never log/print it.
const B = '/crm/sales';

test.describe('GET /crm/sales/analytics_dashboard', () => {
  test('Auth: no session -> 401 JSON login failed (Accept json)', async ({ request }) => {
    const r = await request.get(`${B}/analytics_dashboard`, { headers: { Accept: 'application/json' } });
    expect(r.status()).toBe(401);
    expect((await r.json()).login).toBe('failed');
  });

  test('Auth: no session, HTML Accept -> 302 redirect (content-negotiated)', async ({ request }) => {
    const r = await request.get(`${B}/analytics_dashboard`, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
    expect(r.status()).toBe(302);
  });

  test('Functional/Schema: default tabs and widget shape', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/analytics_dashboard`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.analytic_widgets)).toBe(true);
    for (const w of b.analytic_widgets) {
      expect(typeof w.id).toBe('number');
      expect(typeof w.name).toBe('string');
      expect(typeof w.position).toBe('number');
      expect(typeof w.hidden).toBe('boolean');
      expect(['iframe-page-widget', 'component-widget']).toContain(w.type);
      expect(typeof w.internal_name).toBe('string');
    }
    const visible = b.analytic_widgets.filter((w: any) => !w.hidden).map((w: any) => w.name);
    expect(visible).toEqual(expect.arrayContaining(['Sales Essentials Dashboard', 'Sales Dashboard', 'Activities Dashboard']));
    const byName = Object.fromEntries(b.analytic_widgets.map((w: any) => [w.name, w.external_id]));
    expect(byName['Sales Essentials Dashboard']).toBe('353503');
    expect(byName['Sales Dashboard']).toBe('81767');
    expect(byName['Activities Dashboard']).toBe('activities');
    expect(typeof b.hide_demo_widget).toBe('boolean');
  });

  test('Negative: unknown dashboard id -> 404 errors body', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/analytics_dashboard/999999999`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
    const b = await r.json();
    expect(b.errors.code).toBe(404);
    expect(Array.isArray(b.errors.message)).toBe(true);
  });
});

test.describe('GET /crm/sales/analytic_reports', () => {
  test('Functional/Schema: curated report catalogue', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/analytic_reports`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.analytic_reports.length).toBeGreaterThan(0);
    for (const x of b.analytic_reports) {
      expect(typeof x.id).toBe('number');
      expect(typeof x.name).toBe('string');
      expect(typeof x.curated).toBe('boolean');
    }
  });

  test('Auth: no session -> 401', async ({ request }) => {
    const r = await request.get(`${B}/analytic_reports`);
    expect(r.status()).toBe(401);
  });
});

test.describe('GET /crm/sales/activities_dashboard', () => {
  test('Functional/Schema: list with meta', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/activities_dashboard?page=1&per_page=10`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.activities_dashboard)).toBe(true);
    expect(typeof b.meta.has_next).toBe('boolean');
    expect(typeof b.meta.total_count).toBe('number');
    expect(typeof b.meta.total_pages).toBe('number');
    expect(b.activities_dashboard.length).toBeLessThanOrEqual(10);
  });

  test('Boundary: page=0 & per_page=-1 tolerated (200, empty-safe)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/activities_dashboard?page=0&per_page=-1`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    expect(Array.isArray((await r.json()).activities_dashboard)).toBe(true);
  });

  test('Negative: invalid date -> 400', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/activities_dashboard?start_date=garbage&end_date=x`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(400);
    expect((await r.json()).errors.code).toBe(400);
  });

  test('Auth: no session -> 401', async ({ request }) => {
    expect((await request.get(`${B}/activities_dashboard`)).status()).toBe(401);
  });
});

test.describe('GET /crm/sales/activities_dashboard/summary', () => {
  test('Functional/Schema: {summary:[]}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/activities_dashboard/summary`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    expect(Array.isArray((await r.json()).summary)).toBe(true);
  });
});

test.describe('GET /crm/sales/activities_dashboard/available_user_widgets', () => {
  test('Functional/Schema: native Activities widgets', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`${B}/activities_dashboard/available_user_widgets`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const w = (await r.json()).user_widgets;
    expect(w.map((x: any) => x.name)).toEqual(expect.arrayContaining(['calendar_appointment', 'todays_summary', 'quick_links']));
    for (const x of w) {
      expect(typeof x.position).toBe('number');
      expect(typeof x.is_selected).toBe('boolean');
      expect(x.type).toBe('ui-component');
    }
  });
});
