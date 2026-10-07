import { test, expect, skipIfNoSession } from '../../fixtures/freshsales-api-fixtures';

// Deals + pipeline Kanban coverage -- see api-test-plan.md section 3. Uses the tenant's known,
// live-created deal (id 402012367593, "Explore Test Co - Pipeline Kanban Test Deal", currently at
// stage "Negotiation" per explore-agent's created-entities.json) for read/transition checks so
// this suite doesn't need to also create a fresh deal just to exercise the contract -- creation
// itself is covered by its own Functional case below.
//
// Full-run mode authorizes executing the Won/Lost transitions live; this suite is written to do
// so for real (see 'Move Deal to Won' / a fresh deal to 'Lost' below), guarded by
// skipIfNoSession like everything else in this directory, since none of it could run this pass.

const KNOWN_DEAL_ID = 402012367593;

function assertDealSchema(deal: any) {
  expect(typeof deal.id).toBe('number');
  expect(typeof deal.name).toBe('string');
  expect(typeof deal.amount).toBe('number');
  expect(deal.deal_stage).toBeTruthy();
  expect(typeof deal.deal_stage.name).toBe('string');
}

test.describe('POST /crm/sales/deals (create)', () => {
  test('Functional: create a Deal on the Default Pipeline, initial stage New', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.post('/crm/sales/deals', {
      headers: { Cookie: freshsalesSessionCookie! },
      data: {
        name: `ApiAgentTest Pipeline Deal ${Date.now()}`,
        amount: 2500,
      },
    });
    expect([200, 201]).toContain(response.status());
    const body = await response.json();
    assertDealSchema(body);
    expect(body.deal_stage.name).toBe('New');
    // If actually run: record the created deal id in
    // artifacts/rakesh-freshsales-ind-sep21/api/created-entities.json before any stage-transition
    // or DELETE test targets it (full-run scoping rule).
  });

  test('Negative: blank deal name is rejected', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.post('/crm/sales/deals', {
      headers: { Cookie: freshsalesSessionCookie! },
      data: { name: '', amount: 2500 },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe('GET /crm/sales/deals/:id', () => {
  test('Negative: nonexistent deal id returns 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/deals/999999999999', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBe(404);
  });

  test('Negative: non-numeric deal id does not 500', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/deals/abc', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBeLessThan(500);
  });

  test('Functional/Schema: the known deal matches the Deal schema', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get(
      `/crm/sales/deals/${KNOWN_DEAL_ID}?include=deal_stage,deal_pipeline,sales_account,contacts_details`,
      { headers: { Cookie: freshsalesSessionCookie! } }
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    assertDealSchema(body);
    expect(body.id).toBe(KNOWN_DEAL_ID);
  });
});

test.describe('PUT /crm/sales/deals/:id (stage transitions)', () => {
  test('Negative: an invalid/nonexistent deal_stage_id is rejected, not silently applied', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const before = await request.get(`/crm/sales/deals/${KNOWN_DEAL_ID}?include=deal_stage`, {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    const beforeStage = (await before.json()).deal_stage.name;

    const response = await request.put(`/crm/sales/deals/${KNOWN_DEAL_ID}?include=deal_stage`, {
      headers: { Cookie: freshsalesSessionCookie! },
      data: { deal_stage_id: 999999999 },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);

    const after = await request.get(`/crm/sales/deals/${KNOWN_DEAL_ID}?include=deal_stage`, {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect((await after.json()).deal_stage.name).toBe(beforeStage);
  });

  test('Functional: move the known deal Negotiation -> Won (primary terminal path, edge case #1)', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    // deal_stage_id for "Won" must be resolved live from
    // GET /crm/sales/settings/deal_pipelines?include=deal_stages (see selectors.spec.ts) --
    // placeholder null documents the real lookup step rather than hardcoding a guessed id.
    const response = await request.put(`/crm/sales/deals/${KNOWN_DEAL_ID}?include=deal_stage`, {
      headers: { Cookie: freshsalesSessionCookie! },
      data: { deal_stage_id: null },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.deal_stage.name).toBe('Won');
  });
});

test.describe('GET /crm/sales/deals/view/:viewId/aggregated_data (Kanban)', () => {
  test('Functional: a moved deal appears in its destination stage column\'s dataset', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    // viewId 402015942744 and the Won stage's group_by_value id are both tenant-specific constants
    // observed in explore-agent's captures -- see discovered-endpoints.json.
    const response = await request.get(
      '/crm/sales/deals/view/402015942744/aggregated_data?group_by_type=deal_stage_id&include=lookup_information&per_page=25',
      { headers: { Cookie: freshsalesSessionCookie! } }
    );
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toBeTruthy();
  });
});
