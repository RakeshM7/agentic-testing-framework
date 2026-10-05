import { expect, APIRequestContext } from '@playwright/test';
import { guardedTest } from './mutationGuard';

/**
 * Shared fixtures for the EventHub API test suite.
 *
 * GUARDRAIL: the only non-GET HTTP call anywhere in this suite is the single
 * `POST /auth/login` performed by `authToken` below. It authenticates the
 * pre-existing, already-verified EVENTHUB_EMAIL / EVENTHUB_PASSWORD dogfood
 * account (credentials come from playwright-tests/eventhub/.env via playwright.config.ts) --
 * it does not create or mutate any business data (no new user, no booking, no
 * event). It exists solely so the GET-only auth/contract-discrepancy tests
 * (GET /auth/me, and the "does GET /events or /bookings actually enforce a
 * bearer token" checks) have a real token to send. The fixture is worker-scoped
 * so at most one login call happens per parallel worker, not per test case.
 *
 * No test file may call anything other than `request.get(...)` against the
 * live API. POST /auth/register, POST /events, PUT /events/:id,
 * DELETE /events/:id, POST /bookings, and DELETE /bookings/:id are
 * intentionally never invoked by this suite -- see api-tests/playwright-api/README.md
 * and artifacts/eventhub/api/api-test-plan.md for the documented-but-not-executed
 * coverage for those endpoints.
 */

type ApiFixtures = {
  authToken: string;
};

export const test = guardedTest.extend<{}, ApiFixtures>({
  authToken: [
    async ({ playwright }, use) => {
      const email = process.env.EVENTHUB_EMAIL;
      const password = process.env.EVENTHUB_PASSWORD;

      if (!email || !password) {
        throw new Error(
          'EVENTHUB_EMAIL / EVENTHUB_PASSWORD not found in environment. ' +
            'Expected them to be loaded from playwright-tests/eventhub/.env by playwright.config.ts.'
        );
      }

      const context: APIRequestContext = await playwright.request.newContext({
        baseURL: 'https://api.eventhub.rahulshettyacademy.com/api',
      });

      const response = await context.post('/auth/login', {
        data: { email, password },
      });

      if (!response.ok()) {
        const body = await response.text();
        throw new Error(
          `Setup login failed (POST /auth/login -> ${response.status()}). ` +
            `Cannot run auth-required tests without a token. Body: ${body}`
        );
      }

      const json = await response.json();
      await context.dispose();

      await use(json.token as string);
    },
    { scope: 'worker' },
  ],
});

export { expect };
