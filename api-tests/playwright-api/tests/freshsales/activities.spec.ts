import { test, expect, skipIfNoSession, skipUnlessMutationReady } from '../../fixtures/freshsales-api-fixtures';
import { recordCreated } from '../../fixtures/created-entities';

// Activities. Live-verified (read-only): GET /deals/:id/tasks -> {tasks:[...]}; GET
// /deals/:id/activity_counts without types[] -> 200 with body `null`. Call/note creation endpoints
// were never captured, so no tests are generated for them (not even placeholders).
// Task creation attaches to a deal this run creates.

const SAMPLE_DEAL_ID = 402011904108;

test.describe('GET /crm/sales/deals/:id/tasks', () => {
  test('Functional/Schema: returns {tasks:[{id,title,status}]}', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get(`/crm/sales/deals/${SAMPLE_DEAL_ID}/tasks?per_page=25`, { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBe(200);
    const b = await r.json();
    expect(Array.isArray(b.tasks)).toBe(true);
    for (const t of b.tasks) {
      expect(typeof t.id).toBe('number');
      expect(typeof t.title).toBe('string');
    }
  });

  test('Negative: tasks of nonexistent deal is 404', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);
    const r = await request.get('/crm/sales/deals/999999999999/tasks', { headers: { Cookie: freshsalesSessionCookie! } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });
});

test.describe('POST /crm/sales/tasks (mutating; attaches to a run-created deal)', () => {
  test('Functional: create deal, log a Task on it (201), task list reflects it', async ({ request, freshsalesSessionCookie }) => {
    skipUnlessMutationReady(!!freshsalesSessionCookie);
    const h = { Cookie: freshsalesSessionCookie! };
    const dealRes = await request.post('/crm/sales/deals', { headers: h, data: { deal: { name: `ApiAgentTest TaskDeal ${Date.now()}`, amount: 100 } } });
    expect([200, 201]).toContain(dealRes.status());
    const deal = (await dealRes.json()).deal;
    recordCreated('deal', 'POST /crm/sales/deals', deal.id);

    const t = await request.post('/crm/sales/tasks', {
      headers: h,
      data: { task: { title: `ApiAgentTest follow-up ${Date.now()}`, targetable_type: 'Deal', targetable_id: deal.id, due_date: new Date(Date.now() + 86400000).toISOString() } },
    });
    expect(t.status()).toBe(201);
    const task = (await t.json()).task;
    recordCreated('task', 'POST /crm/sales/tasks', task.id);
    const list = await (await request.get(`/crm/sales/deals/${deal.id}/tasks`, { headers: h })).json();
    expect(list.tasks.map((x: any) => x.id)).toContain(task.id);
  });

  test('Negative: blank task title is rejected', async ({ request, freshsalesSessionCookie }) => {
    skipUnlessMutationReady(!!freshsalesSessionCookie);
    const r = await request.post('/crm/sales/tasks', { headers: { Cookie: freshsalesSessionCookie! }, data: { task: { title: '', targetable_type: 'Deal', targetable_id: SAMPLE_DEAL_ID } } });
    expect(r.status()).toBeGreaterThanOrEqual(400);
    expect(r.status()).toBeLessThan(500);
  });
});
