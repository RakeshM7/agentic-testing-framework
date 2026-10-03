import { test, expect } from '../fixtures/api-fixtures';

// GET /config -- no auth, no params. See artifacts/eventhub/api/api-test-plan.md section 13.
// Cross-referenced against the live network capture: home/network-requests.json and
// login/network-requests.json both independently observed a successful, unauthenticated
// GET https://api.eventhub.rahulshettyacademy.com/api/config call.

test.describe('GET /config', () => {
  test('Functional: returns public feature-flag object', async ({ request }) => {
    const response = await request.get('/config');

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body).toHaveProperty('showExploreLinks');
    expect(typeof body.showExploreLinks).toBe('boolean');
  });

  test('Functional: is callable with no Authorization header (confirms public route)', async ({ request }) => {
    const response = await request.get('/config', { headers: { Authorization: '' } });
    expect(response.status()).toBe(200);
  });
});
