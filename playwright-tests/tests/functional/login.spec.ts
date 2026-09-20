import { test, expect } from '../../fixtures/base';
import { blockLiveApiMutations } from '../../pages/networkGuards';

/**
 * /login coverage from artifacts/eventhub/testcases/app-wide-testcases.md.
 *
 * All specs here run unauthenticated (see registration.spec.ts's header comment for why —
 * the "chromium" project applies an authenticated storageState by default).
 *
 * No test case in this file is flagged "DO NOT EXECUTE LIVE": invalid/empty-field login attempts
 * are expected to be blocked before establishing a session, and the valid-credentials cases reuse
 * this suite's own authorized fixture account (the same one auth.setup.ts already logs in with).
 */
test.describe('login @app-wide', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // TC-app-wide-003 — Login form renders required fields and "Register" link (P2)
  test('login form renders required fields and "Register" link', async ({ page, loginPage }) => {
    await loginPage.goto();

    // Verified live: "Sign in to EventHub" (h1) and "Enter your credentials to continue" (p) are
    // separate DOM nodes.
    await expect(page.getByRole('heading', { name: 'Sign in to EventHub', exact: true })).toBeVisible();
    await expect(page.getByText('Enter your credentials to continue', { exact: true })).toBeVisible();

    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.emailInput).toHaveAttribute('type', 'email');
    await expect(loginPage.emailInput).toHaveAttribute('placeholder', 'you@email.com');

    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    await expect(loginPage.passwordInput).toHaveAttribute('placeholder', '••••••');

    await expect(loginPage.signInButton).toBeVisible();
    await expect(loginPage.registerLink).toHaveAttribute('href', '/register');
  });

  // TC-app-wide-004 / TC-app-wide-022 — Successful login with valid credentials redirects into the
  // authenticated app, as a fresh interactive submission from a fully logged-out state (P0 / P1)
  test('valid credentials redirect into the authenticated app', async ({ page, loginPage }) => {
    const email = process.env.EVENTHUB_EMAIL;
    const password = process.env.EVENTHUB_PASSWORD;
    expect(
      email && email.length > 0 && password && password.length > 0,
      'EVENTHUB_EMAIL / EVENTHUB_PASSWORD must be set (see .env.example) for this spec to run'
    ).toBeTruthy();

    await loginPage.goto();
    await loginPage.login(email!, password!);

    await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 10_000 });
    // Scoped to the primary nav test id — "My Bookings" also appears in main content/footer on
    // other pages, so an unscoped role/text locator risks Playwright's strict-mode ambiguity.
    await expect(page.getByTestId('nav-bookings')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();
  });

  // TC-app-wide-011 — Login with invalid credentials shows "Invalid email or password" (P0)
  // TC-app-wide-023 — same case, additionally asserting the underlying network response (P0)
  test('invalid credentials are rejected with "Invalid email or password" and a 400 response', async ({
    page,
    loginPage,
  }) => {
    await loginPage.goto();
    await loginPage.fillForm({ email: 'akashmrakesh@gmail.com', password: 'clearly-wrong-password' });

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/login')),
      loginPage.submit(),
    ]);

    expect(response.status()).toBe(400);
    await expect(loginPage.invalidCredentialsToast()).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  // TC-app-wide-012 — Empty-field submission on /login is blocked by required-field validation (P1)
  test('submitting with Email and Password both empty is blocked', async ({ page, loginPage }) => {
    await blockLiveApiMutations(page);
    await loginPage.goto();

    await loginPage.submit();

    await expect(loginPage.emailError()).toBeVisible();
    await expect(loginPage.passwordError()).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  // TC-app-wide-021 (login sub-cases) — Empty-field submission on /login, per-field isolation (P2)
  test.describe('empty-field submission, per-field isolation', () => {
    test('1a. Email empty, Password filled', async ({ page, loginPage }) => {
      await blockLiveApiMutations(page);
      await loginPage.goto();
      await loginPage.fillForm({ password: 'SomeValue1!' });

      await loginPage.submit();

      await expect(loginPage.emailError()).toBeVisible();
      await expect(page).toHaveURL('/login');
    });

    test('1b. Password empty, Email filled', async ({ page, loginPage }) => {
      await blockLiveApiMutations(page);
      await loginPage.goto();
      await loginPage.fillForm({ email: 'app-wide-021b@example.com' });

      await loginPage.submit();

      await expect(loginPage.passwordError()).toBeVisible();
      await expect(page).toHaveURL('/login');
    });
  });
});
