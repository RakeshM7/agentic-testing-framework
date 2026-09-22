import { test, expect, skipIfNoSession } from '../../fixtures/freshsales-api-fixtures';

// Read-only reference-data / pipeline-config coverage -- see api-test-plan.md section 5. These
// endpoints back every dropdown/pill used across the Contact status/lifecycle and Deal stage UI,
// so their contract matters for schema/contract confidence independent of any single record.

function assertSelectorOptionShape(option: any) {
  expect(typeof option.id).toBe('number');
  expect(typeof option.name).toBe('string');
}

test.describe('GET /crm/sales/settings/deal_pipelines', () => {
  test('Functional: Default Pipeline stage order matches New, Qualification, Discovery, Demo, Negotiation, Won, Lost', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/settings/deal_pipelines?include=deal_stages', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const pipelines = Array.isArray(body) ? body : body.deal_pipelines || body.data;
    const defaultPipeline = pipelines.find((p: any) => /default/i.test(p.name));
    expect(defaultPipeline).toBeTruthy();

    const stageNames = defaultPipeline.deal_stages.map((s: any) => s.name);
    expect(stageNames).toEqual([
      'New',
      'Qualification',
      'Discovery',
      'Demo',
      'Negotiation',
      'Won',
      'Lost',
    ]);
  });
});

test.describe('GET /crm/sales/selector/contact_statuses', () => {
  test('Functional: includes the full confirmed status pipeline', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/selector/contact_statuses', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const statuses = Array.isArray(body) ? body : body.contact_statuses || body.data;
    for (const status of statuses) assertSelectorOptionShape(status);

    const names = statuses.map((s: any) => s.name);
    for (const expected of ['New', 'Contacted', 'Interested', 'Qualified']) {
      expect(names).toContain(expected);
    }
  });
});

test.describe('GET /crm/sales/selector/lifecycle_stages', () => {
  test('Functional: includes Lead and Sales Qualified Lead', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.get('/crm/sales/selector/lifecycle_stages', {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    const stages = Array.isArray(body) ? body : body.lifecycle_stages || body.data;
    for (const stage of stages) assertSelectorOptionShape(stage);

    const names = stages.map((s: any) => s.name);
    expect(names).toContain('Lead');
    expect(names).toContain('Sales Qualified Lead');
  });
});

for (const selector of [
  'owners',
  'teams',
  'territories',
  'business_types',
  'industry_types',
  'deal_reasons',
  'sales_activity_entity_types',
]) {
  test.describe(`GET /crm/sales/selector/${selector}`, () => {
    test(`Schema/contract: returns a [{id, name}] array shape`, async ({
      request,
      freshsalesSessionCookie,
    }) => {
      skipIfNoSession(!!freshsalesSessionCookie);

      const response = await request.get(`/crm/sales/selector/${selector}`, {
        headers: { Cookie: freshsalesSessionCookie! },
      });
      expect(response.status()).toBe(200);
      const body = await response.json();
      const options = Array.isArray(body) ? body : body[selector] || body.data || [];
      expect(Array.isArray(options)).toBe(true);
      for (const option of options) assertSelectorOptionShape(option);
    });
  });
}

test.describe('Leads module -- explicitly out of scope', () => {
  test.skip(
    true,
    'OUT OF SCOPE per the finalized clarifications doc (human answer, Q2): do not add a dedicated ' +
      'negative/403 test case asserting GET /crm/sales/leads is forbidden for this role. This is a ' +
      'deliberate scoping decision, not a gap -- see discovered-endpoints.json\'s "leads" entry, ' +
      'which documents the 403 for completeness without a corresponding test. This placeholder ' +
      'exists only so a future maintainer sees this decision was intentional rather than assuming ' +
      'coverage was simply forgotten.'
  );
  test('Leads module coverage (intentionally not implemented)', async () => {});
});
