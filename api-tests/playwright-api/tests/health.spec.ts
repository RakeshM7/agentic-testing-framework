import { test, expect } from '../fixtures/api-fixtures';

// GET /health -- no auth, no params. See artifacts/eventhub/api/api-test-plan.md section 12.

test.describe('GET /health', () => {
  test('Functional: returns ok status with a well-formed schema', async ({ request }) => {
    const response = await request.get('/health');

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(typeof body.status).toBe('string');
    expect(body.status).toBe('ok');
    expect(typeof body.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(typeof body.dbStatus).toBe('string');
  });

  test('Schema: content-type is application/json', async ({ request }) => {
    const response = await request.get('/health');
    expect(response.headers()['content-type']).toContain('application/json');
  });
});
