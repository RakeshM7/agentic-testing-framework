import { test, expect } from '../../fixtures/base';
import { frameworkConfig } from '../../config/framework.config';
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
  test('Validate if Login page - loading the page - renders the required fields and "Register" link', async ({ page, loginPage, waits }) => {
    // Step 1: Navigate to /login.
    await loginPage.goto();

    // Step 2: Verify the heading and subtitle text.
    // Verified live: "Sign in to EventHub" (h1) and "Enter your credentials to continue" (p) are
    // separate DOM nodes.
    await expect(page.getByRole('heading', { name: 'Sign in to EventHub', exact: true })).toBeVisible();
    await expect(page.getByText('Enter your credentials to continue', { exact: true })).toBeVisible();

    // Step 3: Verify the Email input is visible with the correct type and placeholder.
    await expect(loginPage.emailInput).toBeVisible();
    await expect(loginPage.emailInput).toHaveAttribute('type', 'email');
    await expect(loginPage.emailInput).toHaveAttribute('placeholder', 'you@email.com');

    // Step 4: Verify the Password input is visible with the correct type and placeholder.
    await expect(loginPage.passwordInput).toBeVisible();
    await expect(loginPage.passwordInput).toHaveAttribute('type', 'password');
    await expect(loginPage.passwordInput).toHaveAttribute('placeholder', '••••••');

    // Step 5: Verify the Sign In button and the "Register" link (pointing to /register) are visible.
    await expect(loginPage.signInButton).toBeVisible();
    await expect(loginPage.registerLink).toHaveAttribute('href', '/register');
  });

  // TC-app-wide-004 / TC-app-wide-022 — Successful login with valid credentials redirects into the
  // authenticated app, as a fresh interactive submission from a fully logged-out state (P0 / P1)
  test('Validate if Login page - submitting valid credentials - redirects into the authenticated app', async ({ page, loginPage, waits }) => {
    // Step 1: Read the fixture account's credentials from environment variables.
    const email = frameworkConfig.credentials.eventHubEmail;
    const password = frameworkConfig.credentials.eventHubPassword;
    expect(
      email && email.length > 0 && password && password.length > 0,
      'EVENTHUB_EMAIL / EVENTHUB_PASSWORD must be set (see .env.example) for this spec to run'
    ).toBeTruthy();

    // Step 2: Navigate to /login and submit valid credentials.
    await loginPage.goto();
    await loginPage.login(email!, password!);

    // Step 3: Wait for navigation away from /login.
    await waits.forUrl(page, (url) => !url.pathname.endsWith('/login'));
    // Step 4: Verify the authenticated nav renders ("My Bookings" and "Admin").
    // Scoped to the primary nav test id — "My Bookings" also appears in main content/footer on
    // other pages, so an unscoped role/text locator risks Playwright's strict-mode ambiguity.
    await expect(page.getByTestId('nav-bookings')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible();
  });

  // TC-app-wide-011 — Login with invalid credentials shows "Invalid email or password" (P0)
  // TC-app-wide-023 — same case, additionally asserting the underlying network response (P0)
  test('Validate if Login page - submitting invalid credentials - is rejected with "Invalid email or password" and a 400 response', async ({
    page,
    loginPage,
  }) => {
    // Step 1: Navigate to /login and fill in a valid-looking email with a wrong password.
    await loginPage.goto();
    await loginPage.fillForm({ email: 'known-bad-user@example.com', password: 'clearly-wrong-password' });

    // Step 2: Submit the form and capture the login API response.
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/login')),
      loginPage.submit(),
    ]);

    // Step 3: Verify the response status is 400, the "Invalid email or password" toast is shown,
    // and the user remains on /login.
    expect(response.status()).toBe(400);
    await expect(loginPage.invalidCredentialsToast()).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  // TC-app-wide-012 — Empty-field submission on /login is blocked by required-field validation (P1)
  test('Validate if Login page - submitting with Email and Password both empty - is blocked by required-field validation', async ({ page, loginPage, waits }) => {
    // Step 1: Block live API mutations as defense-in-depth and navigate to /login.
    await blockLiveApiMutations(page);
    await loginPage.goto();

    // Step 2: Submit the form with both fields empty.
    await loginPage.submit();

    // Step 3: Verify both the Email and Password required-field errors are shown and the user
    // remains on /login.
    await expect(loginPage.emailError()).toBeVisible();
    await expect(loginPage.passwordError()).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  // TC-app-wide-021 (login sub-cases) — Empty-field submission on /login, per-field isolation (P2)
  test.describe('empty-field submission, per-field isolation', () => {
    test('Validate if Login page - submitting with Email empty and Password filled - is blocked with an Email required-field error', async ({ page, loginPage, waits }) => {
      // Step 1: Block live API mutations as defense-in-depth and navigate to /login.
      await blockLiveApiMutations(page);
      await loginPage.goto();
      // Step 2: Fill only the Password field, leaving Email empty.
      await loginPage.fillForm({ password: 'SomeValue1!' });

      // Step 3: Submit the form.
      await loginPage.submit();

      // Step 4: Verify the Email required-field error is shown and the user remains on /login.
      await expect(loginPage.emailError()).toBeVisible();
      await expect(page).toHaveURL('/login');
    });

    test('Validate if Login page - submitting with Password empty and Email filled - is blocked with a Password required-field error', async ({ page, loginPage, waits }) => {
      // Step 1: Block live API mutations as defense-in-depth and navigate to /login.
      await blockLiveApiMutations(page);
      await loginPage.goto();
      // Step 2: Fill only the Email field, leaving Password empty.
      await loginPage.fillForm({ email: 'app-wide-021b@example.com' });

      // Step 3: Submit the form.
      await loginPage.submit();

      // Step 4: Verify the Password required-field error is shown and the user remains on /login.
      await expect(loginPage.passwordError()).toBeVisible();
      await expect(page).toHaveURL('/login');
    });
  });
});
