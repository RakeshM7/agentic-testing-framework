import { test as base, expect } from '@playwright/test';

/**
 * Shared fixture for the Freshsales (`rakesh-freshsales-ind-sep21`) API test suite.
 *
 * KNOWN BLOCKER — read before "fixing" a skipped test:
 * This tenant's `/crm/sales/*` app API authenticates via a session cookie obtained only through a
 * full interactive login. That login form is gated by a Google reCAPTCHA challenge that reliably
 * triggers for scripted browser sessions (see
 * feedback/playwright-automation-agent/2026-09-21-freshsales-recaptcha-blocks-scripted-login.md).
 * A Playwright `APIRequestContext` has the same limitation as a scripted browser here -- it cannot
 * solve a visual CAPTCHA, and this suite does not attempt to. There is no bearer-token alternative:
 * no captured request in any artifacts/rakesh-freshsales-ind-sep21/explore/pages/<slug>/network-requests.json
 * carries an Authorization header.
 *
 * This fixture therefore looks for an operator-supplied session cookie value
 * (FRESHSALES_SESSION_COOKIE in playwright-tests/.env.freshsales) produced OUTSIDE this suite --
 * e.g. a human completing the reCAPTCHA once interactively and copying the resulting session
 * cookie from their browser's dev tools, or a future storageState hand-off analogous to
 * playwright-tests/.auth/freshsales-user.json once that exists. If it is not set, every test that
 * needs authentication calls `test.skip(...)` with an explicit reason -- it is never silently
 * treated as passing, and the suite never attempts to obtain the cookie itself via scripted login.
 *
 * Tests that do NOT require auth (e.g. asserting the unauthenticated-redirect behavior) run for
 * real regardless of whether this cookie is present.
 */

type FreshsalesFixtures = {
  freshsalesSessionCookie: string | null;
};

export const test = base.extend<FreshsalesFixtures>({
  freshsalesSessionCookie: async ({}, use) => {
    const cookie = process.env.FRESHSALES_SESSION_COOKIE || null;
    await use(cookie && cookie.trim().length > 0 ? cookie : null);
  },
});

export function skipIfNoSession(hasSession: boolean) {
  test.skip(
    !hasSession,
    'Blocked: no authenticated Freshsales session available this run. Scripted UI login for this ' +
      'tenant reliably triggers a Google reCAPTCHA challenge (see ' +
      'feedback/playwright-automation-agent/2026-09-21-freshsales-recaptcha-blocks-scripted-login.md), ' +
      'which a Playwright APIRequestContext cannot solve any more than a scripted browser can. Set ' +
      'FRESHSALES_SESSION_COOKIE in playwright-tests/.env.freshsales (obtained by a human completing ' +
      'the login once interactively) to unblock this test -- see api-tests/playwright-api/README.md.'
  );
}

export { expect };
