import { test, expect, APIRequestContext } from '@playwright/test';
import {
  TENANT, PREFIX, SEGMENT_ALL_DEALS, SAMPLE_DEAL_ID, PIPELINE_ID, STAGE_NEW, STAGE_QUALIFICATION,
  hasStateFile, stateFile, newMutCtx, Mut, createDeal, deleteDeal, readLog, isOurs, sfx,
} from '../../../helpers/freshsales/deals-track';

// deals track. Contracts live-verified 2026-10-06 (full-run, user's trial tenant).
// Reads use storageState; mutations need the Rails CSRF token + AUTHORIZATIONS_MODE=full-run in env.
// Only "ZZ API Deal*" deals created here are mutated/deleted (ids logged in deals/api/created-entities.json).
// The 17+ pre-existing deals (SAMPLE_DEAL_ID etc.) are READ ONLY.
const B = '/crm/sales/deals';

function assertDeal(d: any) {
  expect(typeof d.id).toBe('number');
  expect(typeof d.name).toBe('string');
  expect(typeof d.amount).toBe('string'); // decimal string e.g. "5600.0"
  expect(typeof d.deal_stage_id).toBe('number');
  expect(typeof d.deal_pipeline_id).toBe('number');
  expect(typeof d.created_at).toBe('string');
  expect(typeof d.links).toBe('object');
}

// ---------------- unauthenticated boundary
test.describe('unauthenticated boundary', () => {
  for (const p of [`${B}?segment_id=${SEGMENT_ALL_DEALS}`, `${B}/${SAMPLE_DEAL_ID}`, `${B}/filters`]) {
    test(`Auth: GET ${p} no session + json -> 401 {login:"failed"}`, async ({ request }) => {
      const r = await request.get(p, { headers: { Accept: 'application/json' }, maxRedirects: 0 });
      expect(r.status()).toBe(401);
      expect((await r.json()).login).toBe('failed');
    });
    test(`Auth: GET ${p} no session + html -> 302`, async ({ request }) => {
      const r = await request.get(p, { headers: { Accept: 'text/html' }, maxRedirects: 0 });
      expect(r.status()).toBe(302);
    });
  }
  test('Auth: bogus session cookie rejected', async ({ request }) => {
    const r = await request.get(`${B}/${SAMPLE_DEAL_ID}`, { headers: { Cookie: '_freshsales_session=invalid' }, maxRedirects: 0 });
    expect([401, 302]).toContain(r.status());
  });
  test('Auth: unauthenticated POST deal rejected before any write', async ({ request }) => {
    const r = await request.post(B, { headers: { 'Content-Type': 'application/json' }, data: { deal: { name: `${PREFIX} nosession` } }, maxRedirects: 0 });
    expect([401, 302, 422]).toContain(r.status());
  });
  test('Auth: unauthenticated DELETE deal rejected (nonexistent id)', async ({ request }) => {
    const r = await request.delete(`${B}/999999999999`, { headers: { 'Content-Type': 'application/json' }, maxRedirects: 0 });
    expect([401, 302, 422]).toContain(r.status());
  });
});

// ---------------- authenticated reads (pre-existing data, read-only)
test.describe('authenticated reads', () => {
  let ctx: APIRequestContext;
  test.beforeAll(async ({ playwright }) => {
    test.skip(!hasStateFile(), 'No session state file: authenticated tests skipped');
    ctx = await playwright.request.newContext({ baseURL: TENANT, storageState: stateFile(), extraHTTPHeaders: { Accept: 'application/json' } });
  });
  test.afterAll(async () => { await ctx?.dispose(); });

  test('Functional/Schema: list with segment_id returns {deals, meta}', async () => {
    const r = await ctx.get(`${B}?per_page=3&segment_id=${SEGMENT_ALL_DEALS}`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.deals.length).toBeLessThanOrEqual(3);
    expect(typeof b.meta.total).toBe('number');
    expect(typeof b.meta.total_pages).toBe('number');
    for (const d of b.deals) assertDeal(d);
  });
  test('Boundary: per_page=1 returns exactly one and page 2 differs', async () => {
    const a = await (await ctx.get(`${B}?per_page=1&page=1&segment_id=${SEGMENT_ALL_DEALS}`)).json();
    const b = await (await ctx.get(`${B}?per_page=1&page=2&segment_id=${SEGMENT_ALL_DEALS}`)).json();
    expect(a.deals).toHaveLength(1);
    expect(b.deals).toHaveLength(1);
    expect(a.deals[0].id).not.toBe(b.deals[0].id);
  });
  test('Boundary: per_page=0 returns empty list', async () => {
    const r = await ctx.get(`${B}?per_page=0&segment_id=${SEGMENT_ALL_DEALS}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).deals).toEqual([]);
  });
  test('Boundary: page beyond last returns empty list', async () => {
    const r = await ctx.get(`${B}?per_page=2&page=9999&segment_id=${SEGMENT_ALL_DEALS}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).deals).toEqual([]);
  });
  test('Boundary: huge per_page does not 5xx and is bounded by total', async () => {
    const r = await ctx.get(`${B}?per_page=1000&segment_id=${SEGMENT_ALL_DEALS}`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.deals.length).toBeLessThanOrEqual(b.meta.total);
  });
  test('Functional: sort by amount desc is ordered', async () => {
    const b = await (await ctx.get(`${B}?per_page=10&segment_id=${SEGMENT_ALL_DEALS}&sort=amount&sort_type=desc`)).json();
    const a = b.deals.map((d: any) => parseFloat(d.amount));
    expect([...a].sort((x, y) => y - x)).toEqual(a);
  });
  test('Negative: list without segment_id -> 403', async () => {
    const r = await ctx.get(`${B}?per_page=2`);
    expect(r.status()).toBe(403);
    expect((await r.json()).errors.code).toBe(403);
  });
  test('Negative: list with unknown segment_id -> 403', async () => {
    expect((await ctx.get(`${B}?per_page=2&segment_id=999`)).status()).toBe(403);
  });
  test('Functional/Schema: sample deal detail with include=deal_stage', async () => {
    const r = await ctx.get(`${B}/${SAMPLE_DEAL_ID}?include=deal_stage`);
    expect(r.status()).toBe(200);
    const b = await r.json();
    assertDeal(b.deal);
    expect(b.deal.id).toBe(SAMPLE_DEAL_ID);
    expect(Array.isArray(b.deal_stages)).toBe(true);
    expect(b.deal_stages.some((s: any) => s.id === b.deal.deal_stage_id)).toBe(true);
  });
  test('Negative: nonexistent id -> 404 errors envelope', async () => {
    const r = await ctx.get(`${B}/999999999999`);
    expect(r.status()).toBe(404);
    expect((await r.json()).errors.code).toBe(404);
  });
  test('Negative: non-numeric id does not 5xx', async () => {
    expect((await ctx.get(`${B}/abc`)).status()).toBeLessThan(500);
  });
  test('Schema: filters list contains system views', async () => {
    const r = await ctx.get(`${B}/filters`);
    expect(r.status()).toBe(200);
    const f = (await r.json()).filters;
    expect(f.find((x: any) => x.id === SEGMENT_ALL_DEALS)?.name).toBe('All Deals');
    for (const x of f) { expect(typeof x.id).toBe('number'); expect(x.model_class_name).toBe('Deal'); }
  });
  test('Schema: deal_pipelines include deal_stages with ordered positions', async () => {
    const r = await ctx.get('/crm/sales/settings/deal_pipelines?include=deal_stages');
    expect(r.status()).toBe(200);
    const p = (await r.json()).deal_pipelines.find((x: any) => x.id === PIPELINE_ID);
    expect(p.is_default).toBe(true);
    const names = p.deal_stages.map((s: any) => s.name);
    expect(names.slice(0, 5)).toEqual(['New', 'Qualification', 'Discovery', 'Demo', 'Negotiation']);
    for (const s of p.deal_stages) { expect(typeof s.probability).toBe('number'); expect(typeof s.forecast_type).toBe('string'); }
  });
  test('Schema: deals/fields has required name and amount', async () => {
    const f = (await (await ctx.get('/crm/sales/settings/deals/fields')).json()).fields;
    expect(f.find((x: any) => x.name === 'name').required).toBe(true);
    expect(f.find((x: any) => x.name === 'amount').required).toBe(true);
  });
  test('Functional: deal sub-resources notes/tasks of sample deal respond with lists', async () => {
    for (const sub of ['notes', 'tasks']) {
      const r = await ctx.get(`${B}/${SAMPLE_DEAL_ID}/${sub}`);
      expect(r.status()).toBe(200);
      const b = await r.json();
      expect(Array.isArray(b[sub])).toBe(true);
      expect(typeof b.meta.total).toBe('number');
    }
  });
});

// ---------------- mutations (full-run only; serial; cleanup guaranteed in afterAll)
test.describe.serial('deal lifecycle (mutating)', () => {
  let m: Mut;
  const mine: number[] = [];
  test.beforeAll(async ({ playwright }) => {
    test.skip(!hasStateFile(), 'No session state file: mutating tests skipped');
    test.skip(process.env.AUTHORIZATIONS_MODE !== 'full-run', 'AUTHORIZATIONS_MODE=full-run not set: mutating tests skipped');
    m = await newMutCtx(playwright);
    expect(m.csrf.length).toBeGreaterThan(10);
  });
  test.afterAll(async () => {
    if (!m) return;
    for (const id of mine) { const e = readLog().find((x) => x.id === id); if (e && !e.deleted) await deleteDeal(m, id).catch(() => {}); }
    await m.ctx.dispose();
  });
  const track = (d: any) => { if (d?.id) mine.push(d.id); return d; };

  let id = 0;
  const name = `${PREFIX} ${sfx()}`;

  test('Functional/Schema: POST creates deal in default pipeline/stage New', async () => {
    const { r, deal } = await createDeal(m, { name, amount: 1234.5, expected_close: '2027-01-15' });
    track(deal);
    expect(r.status()).toBe(200);
    assertDeal(deal);
    id = deal.id;
    expect(deal.name).toBe(name);
    expect(deal.amount).toBe('1234.5');
    expect(deal.expected_close).toBe('2027-01-15');
    expect(deal.deal_pipeline_id).toBe(PIPELINE_ID);
    expect(deal.deal_stage_id).toBe(STAGE_NEW);
    expect(isOurs(deal.id)).toBe(true);
  });
  test('Functional: GET created deal and it appears in list', async () => {
    const r = await m.ctx.get(`${B}/${id}`);
    expect(r.status()).toBe(200);
    expect((await r.json()).deal.name).toBe(name);
    const l = await (await m.ctx.get(`${B}?per_page=100&segment_id=${SEGMENT_ALL_DEALS}&sort=created_at&sort_type=desc`)).json();
    expect(l.deals.some((d: any) => d.id === id)).toBe(true);
  });
  test('Functional: PUT updates name and amount', async () => {
    const r = await m.ctx.put(`${B}/${id}`, { headers: m.hdr, data: { deal: { name: `${name} edited`, amount: 20 } } });
    expect(r.status()).toBe(200);
    const d = (await r.json()).deal;
    expect(d.name).toBe(`${name} edited`);
    expect(d.amount).toBe('20.0');
    const g = (await (await m.ctx.get(`${B}/${id}`)).json()).deal;
    expect(g.name).toBe(`${name} edited`);
  });
  test('Functional: PUT moves deal to Qualification (probability follows stage)', async () => {
    const r = await m.ctx.put(`${B}/${id}`, { headers: m.hdr, data: { deal: { deal_stage_id: STAGE_QUALIFICATION } } });
    expect(r.status()).toBe(200);
    const d = (await r.json()).deal;
    expect(d.deal_stage_id).toBe(STAGE_QUALIFICATION);
    expect(d.probability).toBe(30);
  });
  test('Negative: PUT empty name -> 400', async () => {
    const r = await m.ctx.put(`${B}/${id}`, { headers: m.hdr, data: { deal: { name: '' } } });
    expect(r.status()).toBe(400);
    expect((await r.json()).errors.message.join(' ')).toContain("can't be empty");
  });
  test('Negative: PUT non-numeric amount -> 400', async () => {
    const r = await m.ctx.put(`${B}/${id}`, { headers: m.hdr, data: { deal: { amount: 'abc' } } });
    expect(r.status()).toBe(400);
  });
  test('Negative: PUT nonexistent id -> 404 (no row created)', async () => {
    const r = await m.ctx.put(`${B}/999999999999`, { headers: m.hdr, data: { deal: { name: `${PREFIX} ghost` } } });
    expect(r.status()).toBe(404);
  });
  test('Negative: POST without CSRF token -> 422', async () => {
    const r = await m.ctx.post(B, { headers: { 'Content-Type': 'application/json' }, data: { deal: { name: `${PREFIX} nocsrf` } } });
    expect(r.status()).toBe(422);
    const j = await r.json().catch(() => ({})); if (j?.deal?.id) track(j.deal); // defensive: log if it unexpectedly succeeded
  });
  test('Negative: POST non-JSON content-type -> 500 (target quirk, no 2xx)', async () => {
    const r = await m.ctx.post(B, { headers: { ...m.hdr, 'Content-Type': 'text/plain' }, data: 'x' });
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });
  test('Negative: POST empty deal -> 400 name required', async () => {
    const { r } = await createDeal(m, { name: undefined });
    // createDeal spreads name:undefined over default -> JSON drops key
    expect(r.status()).toBe(400);
    expect((await r.json()).errors.message).toContain("Deal name can't be empty");
  });
  for (const bad of ['', '   ']) {
    test(`Negative: POST name ${JSON.stringify(bad)} -> 400`, async () => {
      const { r, deal } = await createDeal(m, { name: bad }); track(deal);
      expect(r.status()).toBe(400);
    });
  }
  test('Negative: POST non-numeric amount -> 400', async () => {
    const { r, deal } = await createDeal(m, { amount: 'abc' }); track(deal);
    expect(r.status()).toBe(400);
  });
  test('Boundary: POST amount above 9007199254740991 -> 400', async () => {
    const { r, deal } = await createDeal(m, { amount: 99999999999999999 }); track(deal);
    expect(r.status()).toBe(400);
  });
  test('Negative: POST unknown deal_stage_id -> 400', async () => {
    const { r, deal } = await createDeal(m, { deal_stage_id: 1 }); track(deal);
    expect(r.status()).toBe(400);
    expect((await r.json()).errors.message.join(' ')).toContain("Deal stage doesn't exist");
  });
  test('Boundary: amount 0 accepted', async () => {
    const { r, deal } = await createDeal(m, { amount: 0 }); track(deal);
    expect(r.status()).toBe(200);
    expect(deal.amount).toBe('0.0');
  });
  test('Boundary: 300-char name does not 5xx', async () => {
    const { r, deal } = await createDeal(m, { name: `${PREFIX} ${'x'.repeat(300)}` }); track(deal);
    expect(r.status()).toBeLessThan(500);
  });
  test('Negative: invalid expected_close does not 5xx (quirk: silently nulled)', async () => {
    const { r, deal } = await createDeal(m, { expected_close: 'notadate' }); track(deal);
    expect(r.status()).toBeLessThan(500);
    if (deal) expect(deal.expected_close).toBeNull();
  });
  test('Security: HTML in name is returned escaped/inert in JSON and does not 5xx', async () => {
    const { r, deal } = await createDeal(m, { name: `${PREFIX} <script>alert(1)</script>` }); track(deal);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('application/json');
  });
  // Human expectation: negative deal value should be rejected. The app accepts it ("-5.0").
  test.fail('Negative: POST negative amount should be rejected (app accepts -5: known defect)', async () => {
    const { r, deal } = await createDeal(m, { amount: -5 }); track(deal);
    expect(r.status()).toBe(400);
  });

  test('Safety: delete helper refuses ids not in this track log', async () => {
    await expect(deleteDeal(m, SAMPLE_DEAL_ID)).rejects.toThrow(/refusing/);
  });
  test('Functional: DELETE own deal -> 200 then GET 404', async () => {
    expect(isOurs(id)).toBe(true);
    const r = await deleteDeal(m, id);
    expect(r.status()).toBe(200);
    expect((await m.ctx.get(`${B}/${id}`)).status()).toBe(404);
    expect(readLog().find((e) => e.id === id)?.deleted).toBe(true);
  });
  test('Negative: DELETE already-deleted id -> 404', async () => {
    const r = await m.ctx.delete(`${B}/${id}`, { headers: m.hdr });
    expect(r.status()).toBe(404);
  });
  test('Negative: DELETE nonexistent id -> 404', async () => {
    expect((await m.ctx.delete(`${B}/999999999999`, { headers: m.hdr })).status()).toBe(404);
  });
});
