import { test, expect } from '../fixtures/api-fixtures';

// GET /auth/me -- the only endpoint in the whole spec that explicitly declares
// `security: [{bearerAuth: []}]`. See artifacts/eventhub/api/api-test-plan.md section 3.
//
// The token used here comes from the worker-scoped `authToken` fixture, which performs exactly
// one POST /auth/login call (see fixtures/api-fixtures.ts) against the pre-existing dogfood
// account -- not a mutating call, and the only non-GET request anywhere in this suite. Every
// assertion in this file itself is a GET.

test.describe('GET /auth/me', () => {
  test('Functional: valid token returns the authenticated user identity', async ({ request, authToken }) => {
    const response = await request.get('auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(typeof body.user.userId).toBe('number');
    expect(body.user.email).toBe(process.env.EVENTHUB_EMAIL);
  });

  test('Auth (negative): missing Authorization header is rejected', async ({ request }) => {
    const response = await request.get('auth/me');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe('string');
  });

  test('Auth (negative): header missing the "Bearer " scheme prefix is rejected', async ({ request, authToken }) => {
    const response = await request.get('auth/me', {
      headers: { Authorization: authToken }, // raw token, no "Bearer " prefix
    });
    expect(response.status()).toBe(401);
  });

  test('Auth (negative): well-formed-looking but garbage JWT is rejected', async ({ request }) => {
    const response = await request.get('auth/me', {
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.bm90LWEtcmVhbC1wYXlsb2Fk.fakefakefake' },
    });
    expect(response.status()).toBe(401);
  });

  test('Auth (negative): completely non-JWT garbage string is rejected', async ({ request }) => {
    const response = await request.get('auth/me', {
      headers: { Authorization: 'Bearer not-a-jwt-at-all' },
    });
    expect(response.status()).toBe(401);
  });

  test('Auth (negative): empty-string bearer token is rejected', async ({ request }) => {
    const response = await request.get('auth/me', {
      headers: { Authorization: 'Bearer ' },
    });
    expect(response.status()).toBe(401);
  });

  // NOTE: expired-token behavior is documented but NOT executed here -- the spec says tokens are
  // valid for 7 days, and this suite has no mechanism to mint a pre-expired token for the live
  // account without a signing secret it doesn't have. See api-test-plan.md section 3.

  test('Schema: success-response shape matches MeResponse', async ({ request, authToken }) => {
    const response = await request.get('auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      user: {
        userId: expect.any(Number),
        email: expect.any(String),
      },
    });
  });
});
