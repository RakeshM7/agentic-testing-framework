import { expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { guardedTest, MUTATIONS_ALLOWED } from './mutationGuard';

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
 * (FRESHSALES_SESSION_COOKIE in playwright-tests/freshsales/.env.freshsales) produced OUTSIDE this suite --
 * e.g. a human completing the reCAPTCHA once interactively and copying the resulting session
 * cookie from their browser's dev tools, or a future storageState hand-off analogous to
 * playwright-tests/freshsales/.auth/freshsales-user.json once that exists. If it is not set, every test that
 * needs authentication calls `test.skip(...)` with an explicit reason -- it is never silently
 * treated as passing, and the suite never attempts to obtain the cookie itself via scripted login.
 *
 * Tests that do NOT require auth (e.g. asserting the unauthenticated-redirect behavior) run for
 * real regardless of whether this cookie is present.
 */

const TENANT_HOST = 'rakesh-freshsales-ind-sep21.myfreshworks.com';

function cookieFromStateFile(): string | null {
  const file =
    process.env.FRESHSALES_SESSION_STATE_FILE ||
    path.resolve(__dirname, '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
  try {
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cookies = (state.cookies ?? []).filter((c: any) => {
      const d = String(c.domain).replace(/^\./, '');
      return d === TENANT_HOST || d === 'myfreshworks.com';
    });
    if (!cookies.some((c: any) => c.name === '_freshsales_session' && c.value)) return null;
    return cookies.map((c: any) => `${c.name}=${c.value}`).join('; ');
  } catch {
    return null;
  }
}

type FreshsalesFixtures = {
  freshsalesSessionCookie: string | null;
};

export const test = guardedTest.extend<FreshsalesFixtures>({
  freshsalesSessionCookie: async ({}, use) => {
    // Resolution order: (1) FRESHSALES_SESSION_COOKIE (full Cookie header string), then (2) a
    // Playwright storageState hand-off file (FRESHSALES_SESSION_STATE_FILE, default
    // playwright-tests/freshsales/.auth/freshsales-handoff.json) -- cookies for the tenant host are joined into a
    // Cookie header. Values are never logged.
    const direct = process.env.FRESHSALES_SESSION_COOKIE;
    if (direct && direct.trim().length > 0) return use(direct);
    await use(cookieFromStateFile());
  },
});

export function skipIfNoSession(hasSession: boolean) {
  test.skip(
    !hasSession,
    'Blocked: no authenticated Freshsales session available this run. Scripted UI login for this ' +
      'tenant reliably triggers a Google reCAPTCHA challenge (see ' +
      'feedback/playwright-automation-agent/2026-09-21-freshsales-recaptcha-blocks-scripted-login.md), ' +
      'which a Playwright APIRequestContext cannot solve any more than a scripted browser can. Set ' +
      'FRESHSALES_SESSION_COOKIE in playwright-tests/freshsales/.env.freshsales (obtained by a human completing ' +
      'the login once interactively) to unblock this test -- see api-tests/playwright-api/README.md.'
  );
}

export { expect };

/**
 * Guard for tests that issue POST/PUT/PATCH/DELETE: skipped (with an explicit reason, never faked as
 * passing) unless a session exists AND AUTHORIZATIONS_MODE=full-run is set in the environment.
 */
export function skipUnlessMutationReady(hasSession: boolean) {
  skipIfNoSession(hasSession);
  test.skip(
    !MUTATIONS_ALLOWED,
    'Skipped: mutating call and AUTHORIZATIONS_MODE=full-run is not set in the process environment ' +
      '(code-level guard in fixtures/mutationGuard.ts; the Claude Code bash hook also blocks mutating ' +
      'shell calls without it). Relaunch with AUTHORIZATIONS_MODE=full-run for an authorized target.'
  );
}
