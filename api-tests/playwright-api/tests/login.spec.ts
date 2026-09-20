import { test, expect } from '@playwright/test';

// POST /auth/login -- functional + negative coverage. See artifacts/eventhub/api/api-test-plan.md
// section 15 (app-wide run, added 2026-09-20).
//
// GUARDRAIL NOTE: this file calls POST /auth/login directly (not via the authToken fixture), and
// does so multiple times with a variety of valid/invalid payloads. This is intentional and stays
// within the suite's read-only-by-default guardrail: every call here authenticates (or fails to
// authenticate) against an *existing* account -- none of them create, modify, or delete any
// business data. This is the exact same category of call already sanctioned for the single
// happy-path login in fixtures/api-fixtures.ts; this file just exercises more of that same
// endpoint's documented negative paths live, which the event-booking run's api-test-plan.md
// (section 2) deliberately left undone "to avoid needlessly hammering the login endpoint". The
// app-wide run judges the marginal handful of extra login calls below an acceptable trade-off for
// concrete negative-path coverage of a feature (login) that is explicitly in this run's scope.
//
// POST /auth/register is NOT called anywhere in this suite, under any payload (valid or invalid) --
// see api-test-plan.md section 16 and README.md for why registration is treated differently from
// login (a registration attempt, even one designed to fail validation, is still an attempt against
// the account-creation endpoint).

test.describe('POST /auth/login', () => {
  test('Functional: valid EVENTHUB_EMAIL / EVENTHUB_PASSWORD returns a JWT and user identity', async ({
    request,
  }) => {
    const email = process.env.EVENTHUB_EMAIL;
    const password = process.env.EVENTHUB_PASSWORD;
    test.skip(!email || !password, 'EVENTHUB_EMAIL / EVENTHUB_PASSWORD not set in playwright-tests/.env');

    const response = await request.post('/auth/login', { data: { email, password } });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(0);
    expect(body.user).toMatchObject({
      id: expect.any(Number),
      email,
    });
  });

  test('Negative: directly-observed invalid-credentials fixture returns 400', async ({ request }) => {
    // Directly observed during explore-agent's app-wide crawl (not a guess): POST /api/auth/login
    // for akashmrakesh@gmail.com returned 400 live, with UI toast "Invalid email or password".
    // See artifacts/eventhub/explore/login-attempt-failed/network-request.json. Reused as-is here
    // as a known, reproducible negative fixture at the API level.
    const response = await request.post('/auth/login', {
      data: { email: 'akashmrakesh@gmail.com', password: 'clearly-wrong-password-for-api-test' },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  test('Negative: correct email, deliberately wrong password for the dogfood account', async ({ request }) => {
    const email = process.env.EVENTHUB_EMAIL;
    test.skip(!email, 'EVENTHUB_EMAIL not set in playwright-tests/.env');

    const response = await request.post('/auth/login', {
      data: { email, password: 'definitely-the-wrong-password-999!' },
    });

    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  test('Negative: well-formed but never-registered email', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: {
        email: `nonexistent-api-test-${Date.now()}@example.invalid`,
        password: 'whatever-password-123',
      },
    });

    // Contract question (see api-test-plan.md section 15): spec documents both a 400 ("Wrong
    // password or validation error") and a 404 ("No account found for this email") response shape.
    // Live behavior for this exact case (a syntactically valid but never-registered email) has not
    // been directly observed before, so this asserts "one of the two spec-documented outcomes"
    // rather than a single hard-coded value.
    expect([400, 404]).toContain(response.status());
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  test('Negative: missing password field entirely', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: 'someone-api-test@example.com' },
    });
    expect(response.status()).toBe(400);
  });

  test('Negative: missing email field entirely', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { password: 'whatever-password-123' },
    });
    expect(response.status()).toBe(400);
  });

  test('Negative: malformed email (no @)', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: 'not-an-email', password: 'whatever-password-123' },
    });
    expect(response.status()).toBe(400);
  });

  test('Negative: empty request body', async ({ request }) => {
    const response = await request.post('/auth/login', { data: {} });
    expect(response.status()).toBe(400);
  });

  test('Schema: failure response shape is consistent across negative cases', async ({ request }) => {
    const response = await request.post('/auth/login', { data: {} });
    const body = await response.json();
    expect(body).toMatchObject({
      success: false,
      error: expect.any(String),
    });
  });
});
