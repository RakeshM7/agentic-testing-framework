import { test, expect, skipIfNoSession } from '../../fixtures/freshsales-api-fixtures';

// Task/Call/Note activity coverage against the known deal (id 402012367593) -- see
// api-test-plan.md section 4. Per the clarifications doc (confirmed behavior Q5), all three
// activity types are in scope, but only Task creation's endpoint (POST /crm/sales/tasks -> 201)
// was actually captured live by explore-agent. Call/Note tests are written against a best-guess
// endpoint shape and are additionally skip-guarded on that being wrong, not just on the auth
// blocker -- see the dedicated reason strings below.

const KNOWN_DEAL_ID = 402012367593;

test.describe('POST /crm/sales/tasks', () => {
  test('Functional: log a Task against the Deal', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.post('/crm/sales/tasks', {
      headers: { Cookie: freshsalesSessionCookie! },
      data: {
        title: `ApiAgentTest follow-up on ${KNOWN_DEAL_ID} ${Date.now()}`,
        targetable_type: 'Deal',
        targetable_id: KNOWN_DEAL_ID,
      },
    });
    // Confirmed live by explore-agent at 201 for this exact endpoint/shape.
    expect(response.status()).toBe(201);
    const body = await response.json();
    expect(typeof body.id).toBe('number');
    expect(typeof body.title).toBe('string');
    expect(body.completed).toBeFalsy();
  });

  test('Negative: blank task title is rejected', async ({ request, freshsalesSessionCookie }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const response = await request.post('/crm/sales/tasks', {
      headers: { Cookie: freshsalesSessionCookie! },
      data: { title: '', targetable_type: 'Deal', targetable_id: KNOWN_DEAL_ID },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    expect(response.status()).toBeLessThan(500);
  });
});

test.describe('GET /crm/sales/deals/:id/tasks and /activity_counts', () => {
  test('Functional: deal task list and activity_counts stay consistent', async ({
    request,
    freshsalesSessionCookie,
  }) => {
    skipIfNoSession(!!freshsalesSessionCookie);

    const tasksResponse = await request.get(`/crm/sales/deals/${KNOWN_DEAL_ID}/tasks?per_page=25`, {
      headers: { Cookie: freshsalesSessionCookie! },
    });
    expect(tasksResponse.status()).toBe(200);
    const tasksBody = await tasksResponse.json();
    const tasks = Array.isArray(tasksBody) ? tasksBody : tasksBody.tasks || tasksBody.data;

    const countsResponse = await request.get(
      `/crm/sales/deals/${KNOWN_DEAL_ID}/activity_counts?types[]=tasks&types[]=notes&types[]=appointments`,
      { headers: { Cookie: freshsalesSessionCookie! } }
    );
    expect(countsResponse.status()).toBe(200);
    const counts = await countsResponse.json();
    expect(counts.tasks).toBe(tasks.length);
  });
});

test.describe('Call log creation (endpoint NOT captured -- best-effort discovery)', () => {
  test.skip(
    true,
    'Neither the auth blocker nor the exact endpoint is resolved: explore-agent never captured a ' +
      'Call-log creation network request (only Task creation was exercised -- see ' +
      'discovered-endpoints.json\'s "sales_activities" entry and the clarifications doc\'s own admission). ' +
      'This case cannot even be pointed at a confirmed URL yet, separate from the session-cookie blocker. ' +
      'Once a session is available, the correct fix is to open the Deal detail page\'s "Call log" action ' +
      'in a real browser once, capture the actual POST request/response, then replace this skip with a ' +
      'real assertion -- not to guess a Freshsales public-API-style path that this tenant\'s internal ' +
      'app API may not actually use.'
  );
  test('Functional: log a Call activity against the Deal (placeholder)', async () => {});
});

test.describe('Note creation (endpoint NOT captured -- best-effort discovery)', () => {
  test.skip(
    true,
    'Same situation as the Call-log case above: no Note-creation request was captured against a ' +
      'Deal (only GET /crm/sales/contacts/:id/notes was observed, for a different resource). Do not ' +
      'assume /crm/sales/deals/:id/notes exists by analogy without confirming it live first.'
  );
  test('Functional: log a Note against the Deal (placeholder)', async () => {});
});
