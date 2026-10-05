import { test, expect, skipIfNoSession, skipUnlessMutationReady } from '../../fixtures/freshsales-api-fixtures';
import { recordCreated } from '../../fixtures/created-entities';

// Deals coverage. Live-verified (read-only): detail wrapped in {deal} (+ sideloaded deal_stages),
// amount is a decimal STRING ("5600.0"), list is {deals:[...]} and needs segment_id. Pre-existing
// sample deal 402011904108 is used for READ-ONLY checks; stage-transition tests create their own deal.

const DEALS_SEGMENT = 402015942744;
const VIEW_ID = 402015942744;
const SAMPLE_DEAL_ID = 402011904108;
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1000)}`;

function assertDealSchema(d: any) {
  expect(typeof d.id).toBe('number');
  expect(typeof d.name).toBe('string');
  expect(typeof d.amount).toBe('string');
  expect(typeof d.deal_stage_id).toBe('number');
  expect(typeof d.deal_pipeline_id).toBe('number');
}

test.describe('GET /crm/sales/deals', () => {
  test('Functional/Schema: list with segment_id returns {deals}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/deals?per_page=3&segment_id=${DEALS_SEGMENT}`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.deals)).toBe(true);
    for (const d of b.deals) assertDealSchema(d);
  });

  test('Functional/Schema: sample deal detail wrapped in {deal}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/deals/${SAMPLE_DEAL_ID}?include=deal_stage`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    assertDealSchema(b.deal);
    expect(b.deal.id).toBe(SAMPLE_DEAL_ID);
  });

  test('Negative: nonexistent deal id returns 404 with errors envelope', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get('/crm/sales/deals/999999999999', { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(404);
    expect((await r.json()).errors.code).toBe(404);
  });

  test('Negative: non-numeric deal id does not 5xx', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get('/crm/sales/deals/abc', { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe('GET /crm/sales/deals/view/:viewId/aggregated_data (Kanban)', () => {
  test('Functional/Schema: with group_by_value[] returns a per-stage keyed object', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(
      `/crm/sales/deals/view/${VIEW_ID}/aggregated_data?group_by_type=deal_stage_id&group_by_value[]=402001912038&include=lookup_information&page=1&per_page=5`,
      { headers: { Cookie: freshsalesSessionCookie! } }
    );
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(b.meta).toBeTruthy();
    const stageKeys = Object.keys(b).filter((k) => /^\d+$/.test(k));
    expect(stageKeys.length).toBeGreaterThan(0);
    for (const k of stageKeys) expect(Array.isArray(b[k].deals)).toBe(true);
  });

  test('Negative/contract: omitting group_by_value[] returns 400 (documented)', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(
      `/crm/sales/deals/view/${VIEW_ID}/aggregated_data?group_by_type=deal_stage_id&include=lookup_information&per_page=25`,
      { headers: { Cookie: freshsalesSessionCookie! } }
    );
    expect(r.status()).toBe(400);
  });
});

test.describe('POST/PUT /crm/sales/deals (mutating; run-created entities only)', () => {
  test('Functional: create a deal then walk it New -> Qualification -> Won; invalid stage id rejected', async ({ request, freshsalesSessionCookie }) => {
    skipUnlessMutationReady(!!freshsalesSessionCookie);
    const h = { Cookie: freshsalesSessionCookie! };
    const stages = (await (await request.get('/crm/sales/selector/deal_stages', { headers: h })).json()).deal_stages;
    const byName = (n: string) => stages.find((s: any) => s.name === n);
    const created = await request.post('/crm/sales/deals', {
      headers: h,
      data: { deal: { name: `ApiAgentTest Deal ${unique()}`, amount: 2500, deal_stage_id: byName('New').id } },
    });
    expect([200, 201]).toContain(created.status());
    const d = (await created.json()).deal;
    assertDealSchema(d);
    recordCreated('deal', 'POST /crm/sales/deals', d.id);
    expect(d.deal_stage_id).toBe(byName('New').id);

    const bad = await request.put(`/crm/sales/deals/${d.id}`, { headers: h, data: { deal: { deal_stage_id: 999999999 } } });
    expect(bad.status()).toBeGreaterThanOrEqual(400);
    expect(bad.status()).toBeLessThan(500);

    for (const name of ['Qualification', 'Won']) {
      const u = await request.put(`/crm/sales/deals/${d.id}`, { headers: h, data: { deal: { deal_stage_id: byName(name).id } } });
      expect(u.status()).toBe(200);
      expect((await u.json()).deal.deal_stage_id).toBe(byName(name).id);
    }
  });

  test('Negative: blank deal name is rejected', async ({ request, freshsalesSessionCookie }) => {
    skipUnlessMutationReady(!!freshsalesSessionCookie);
    const r = await request.post('/crm/sales/deals', { headers: { Cookie: freshsalesSessionCookie! }, data: { deal: { name: '', amount: 2500 } } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });
});
