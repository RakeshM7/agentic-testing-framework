import { test, expect } from '../../fixtures/base';
import { frameworkConfig } from '../../config/framework.config';
import { blockLiveApiMutations } from '../../pages/networkGuards';

/**
 * /register coverage from artifacts/eventhub/testcases/app-wide-testcases.md.
 *
 * All specs here run unauthenticated (the "chromium" project applies an authenticated
 * storageState by default — see playwright.config.ts — so every describe block below opts out
 * with a clean context, same pattern as tests/visual/visual.spec.ts's login-page spec).
 *
 * TC-app-wide-002, 017, and 020 are flagged "DO NOT EXECUTE LIVE — documented-but-not-executed
 * only" in the test-case doc (creating a real account / duplicate-email registration testing is
 * out of scope for this run's non-mutation stance). They are written as test.fixme() below so
 * they show up as pending rather than silently missing — same convention as
 * tests/functional/booking-mutating.spec.ts.
 *
 * Every negative spec that clicks "Create Account" wraps the page in blockLiveApiMutations() as
 * defense-in-depth. This was verified live during development: submitting invalid registration
 * data (empty fields, policy-violating passwords, mismatched confirm-password) makes zero
 * requests to /api/auth/register — validation is genuinely client-side and blocks before any
 * network call — so the guard is a no-op safety net, not a workaround for a known gap.
 */
test.describe('registration @app-wide', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // TC-app-wide-001 — Registration form renders required fields, password policy, and navigation link (P2)
  test('Validate if Register page - loading the page - renders required fields, password policy, and "Sign in" link', async ({
    page,
    registerPage,
  }) => {
    // Step 1: Navigate to /register.
    await registerPage.goto();

    // Step 2: Verify the heading and subtitle text.
    // Verified live: heading and subtitle are separate DOM nodes ("Create your account" h1,
    // "Get your own EventHub sandbox" p) — not one em-dash-joined string.
    await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toBeVisible();
    await expect(page.getByText('Get your own EventHub sandbox', { exact: true })).toBeVisible();

    // Step 3: Verify the Email input is visible with the correct type and placeholder.
    await expect(registerPage.emailInput).toBeVisible();
    await expect(registerPage.emailInput).toHaveAttribute('type', 'email');
    await expect(registerPage.emailInput).toHaveAttribute('placeholder', 'you@email.com');

    // Step 4: Verify the Password input, its placeholder, and the 4 displayed policy rules.
    await expect(registerPage.passwordInput).toBeVisible();
    await expect(registerPage.passwordInput).toHaveAttribute('type', 'password');
    await expect(registerPage.passwordInput).toHaveAttribute(
      'placeholder',
      'Min 8 chars, uppercase, number & symbol'
    );
    await expect(page.getByText('At least 8 characters', { exact: true })).toBeVisible();
    await expect(page.getByText('One uppercase letter (A–Z)', { exact: true })).toBeVisible();
    await expect(page.getByText('One number (0–9)', { exact: true })).toBeVisible();
    await expect(page.getByText('One special character (!@#$%^&*…)', { exact: true })).toBeVisible();

    // Step 5: Verify the Confirm Password input is visible with the correct type and placeholder.
    await expect(registerPage.confirmPasswordInput).toBeVisible();
    await expect(registerPage.confirmPasswordInput).toHaveAttribute('type', 'password');
    await expect(registerPage.confirmPasswordInput).toHaveAttribute('placeholder', 'Repeat your password');

    // Step 6: Verify the Create Account button and the "Sign in" link (pointing to /login) are visible.
    await expect(registerPage.createAccountButton).toBeVisible();
    await expect(registerPage.signInLink).toHaveAttribute('href', '/login');
  });

  // TC-app-wide-013 — Empty-field submission on /register is blocked by required-field validation (P1)
  test('Validate if Register page - submitting with Email, Password, and Confirm Password all empty - is blocked by required-field validation', async ({
    page,
    registerPage,
  }) => {
    // Step 1: Block live API mutations as defense-in-depth and navigate to /register.
    await blockLiveApiMutations(page);
    await registerPage.goto();

    // Step 2: Submit the form with all fields empty.
    await registerPage.submit();

    // Step 3: Verify the Email and Password-policy errors are shown, no mismatch error fires
    // (both fields are equally empty), and the user remains on /register.
    await expect(registerPage.emailError()).toBeVisible();
    await expect(registerPage.passwordPolicyError()).toBeVisible();
    // Confirm Password is empty too ("" === ""), so no mismatch error fires — verified live.
    await expect(registerPage.passwordMismatchError()).not.toBeVisible();
    await expect(page).toHaveURL('/register');
  });

  // TC-app-wide-014 — Registration with a password violating the displayed policy is blocked (P1)
  test('Validate if Register page - submitting a password violating the policy (7 chars, below the 8-char minimum) - is rejected', async ({
    page,
    registerPage,
  }) => {
    // Step 1: Block live API mutations as defense-in-depth and navigate to /register.
    await blockLiveApiMutations(page);
    await registerPage.goto();
    // Step 2: Fill the form with a 7-character password.
    await registerPage.fillForm({
      email: 'app-wide-014@example.com',
      password: 'short1!',
      confirmPassword: 'short1!',
    });

    // Step 3: Submit the form.
    await registerPage.submit();

    // Step 4: Verify the password-policy error is shown and the user remains on /register.
    await expect(registerPage.passwordPolicyError()).toBeVisible();
    await expect(page).toHaveURL('/register');
  });

  // TC-app-wide-015 — Registration with Confirm Password != Password is blocked (P1)
  test('Validate if Register page - submitting a Confirm Password differing from Password - is rejected', async ({ page, registerPage }) => {
    // Step 1: Block live API mutations as defense-in-depth and navigate to /register.
    await blockLiveApiMutations(page);
    await registerPage.goto();
    // Step 2: Fill the form with a Password and a different Confirm Password.
    await registerPage.fillForm({
      email: 'app-wide-015@example.com',
      password: 'TestPass1!',
      confirmPassword: 'TestPass2!',
    });

    // Step 3: Submit the form.
    await registerPage.submit();

    // Step 4: Verify the password-mismatch error is shown and the user remains on /register.
    await expect(registerPage.passwordMismatchError()).toBeVisible();
    await expect(page).toHaveURL('/register');
  });

  // TC-app-wide-018 — Registration password policy: each individual rule violation, tested in isolation (P1)
  test.describe('password policy — each rule violated in isolation', () => {
    const cases: Array<{ name: string; password: string }> = [
      { name: '1a. missing the 8-character minimum', password: 'Ab1!xyz' },
      { name: '1b. missing an uppercase letter', password: 'abcdef1!' },
      { name: '1c. missing a number', password: 'Abcdefg!' },
      { name: '1d. missing a special character', password: 'Abcdefg1' },
    ];

    for (const [i, { name, password }] of cases.entries()) {
      test(`Validate if Register page - submitting a password ${name} - is rejected by the password policy`, async ({ page, registerPage }) => {
        // Step 1: Block live API mutations as defense-in-depth and navigate to /register.
        await blockLiveApiMutations(page);
        await registerPage.goto();
        // Step 2: Fill the form with a password violating this specific rule (see the `name` case above).
        await registerPage.fillForm({
          email: `app-wide-018-${i}@example.com`,
          password,
          confirmPassword: password,
        });

        // Step 3: Submit the form.
        await registerPage.submit();

        // Step 4: Verify the password-policy error is shown and the user remains on /register.
        // Verified live: the app shows the same generic policy message for every individual rule
        // violation — there is no rule-specific error text to assert on instead.
        await expect(registerPage.passwordPolicyError()).toBeVisible();
        await expect(page).toHaveURL('/register');
      });
    }
  });

  // TC-app-wide-019 — Registration Confirm Password mismatch by a single character (P2)
  test('Validate if Register page - submitting a Confirm Password differing from Password by a single trailing character - is rejected (exact-match comparison)', async ({
    page,
    registerPage,
  }) => {
    // Step 1: Block live API mutations as defense-in-depth and navigate to /register.
    await blockLiveApiMutations(page);
    await registerPage.goto();
    // Step 2: Fill the form with a Password and a Confirm Password differing by one character.
    await registerPage.fillForm({
      email: 'app-wide-019@example.com',
      password: 'TestPass1!',
      confirmPassword: 'TestPass1?',
    });

    // Step 3: Submit the form.
    await registerPage.submit();

    // Step 4: Verify the password-mismatch error is shown and the user remains on /register.
    await expect(registerPage.passwordMismatchError()).toBeVisible();
    await expect(page).toHaveURL('/register');
  });

  // TC-app-wide-021 (register sub-cases) — Empty-field submission on /register, per-field isolation (P2)
  test.describe('empty-field submission, per-field isolation', () => {
    test('Validate if Register page - submitting with Email empty and Password/Confirm Password filled and matching - is blocked with an Email required-field error', async ({
      page,
      registerPage,
    }) => {
      // Step 1: Block live API mutations as defense-in-depth and navigate to /register.
      await blockLiveApiMutations(page);
      await registerPage.goto();
      // Step 2: Fill Password and Confirm Password validly, leaving Email empty.
      await registerPage.fillForm({ password: 'TestPass1!', confirmPassword: 'TestPass1!' });

      // Step 3: Submit the form.
      await registerPage.submit();

      // Step 4: Verify the Email required-field error is shown and the user remains on /register.
      await expect(registerPage.emailError()).toBeVisible();
      await expect(page).toHaveURL('/register');
    });

    test('Validate if Register page - submitting with Password empty (Confirm Password filled) and Email filled - is blocked with a password-policy error', async ({ page, registerPage }) => {
      // Step 1: Block live API mutations as defense-in-depth and navigate to /register.
      await blockLiveApiMutations(page);
      await registerPage.goto();
      // Step 2: Fill Email and Confirm Password, leaving Password empty.
      await registerPage.fillForm({
        email: 'app-wide-021d@example.com',
        confirmPassword: 'TestPass1!',
      });

      // Step 3: Submit the form.
      await registerPage.submit();

      // Step 4: Verify the password-policy error is shown and the user remains on /register.
      await expect(registerPage.passwordPolicyError()).toBeVisible();
      await expect(page).toHaveURL('/register');
    });

    test('Validate if Register page - submitting with Confirm Password empty (Password filled) and Email filled - is blocked with a password-mismatch error', async ({ page, registerPage }) => {
      // Step 1: Block live API mutations as defense-in-depth and navigate to /register.
      await blockLiveApiMutations(page);
      await registerPage.goto();
      // Step 2: Fill Email and Password, leaving Confirm Password empty.
      await registerPage.fillForm({
        email: 'app-wide-021e@example.com',
        password: 'TestPass1!',
      });

      // Step 3: Submit the form.
      await registerPage.submit();

      // Step 4: Verify the password-mismatch error is shown and the user remains on /register.
      await expect(registerPage.passwordMismatchError()).toBeVisible();
      await expect(page).toHaveURL('/register');
    });
  });

  // TC-app-wide-002 — Successful registration submission auto-logs in and redirects (P1)
  // DO NOT EXECUTE LIVE — would create a real account. See testcases-summary.md's flag table.
  test.fixme(
    'Validate if Register page - submitting a successful registration - auto-logs in and redirects into the authenticated app',
    async ({ registerPage }) => {
      // Step 1: Navigate to /register.
      await registerPage.goto();
      // Step 2: Fill the form with a never-used email and a valid, matching password/confirm-password.
      await registerPage.fillForm({
        email: 'a-valid-never-used-email@example.com',
        password: 'TestPass1!',
        confirmPassword: 'TestPass1!',
      });
      // Step 3: Submit the form.
      await registerPage.submit();
      // Step 4 (not executed): Would assert: redirected to /events (or home); nav bar shows the authenticated state.
      // NOT EXECUTED: clicking "Create Account" here would create a real account against the live
      // demo backend. Skipped per this run's no-live-mutation constraint.
    }
  );

  // TC-app-wide-017 — Registration with duplicate (already-registered) email is rejected (P1)
  // DO NOT EXECUTE LIVE — requires submitting the form with a real account's email.
  test.fixme(
    'Validate if Register page - registering with an already-registered email - is rejected with an inline error',
    async ({ registerPage }) => {
      // Step 1: Navigate to /register.
      await registerPage.goto();
      // Step 2: Fill the form with a known already-registered email.
      await registerPage.fillForm({
        email: frameworkConfig.credentials.eventHubEmail || 'registered-user@example.com', // known already-registered address (the suite's own test account)
        password: 'TestPass1!',
        confirmPassword: 'TestPass1!',
      });
      // Step 3: Submit the form.
      await registerPage.submit();
      // Step 4 (not executed): Would assert: inline "Email already registered" (or similar) error near Email; no
      // duplicate account created. NOT EXECUTED: this run's non-mutation stance treats any
      // registration-form submission (positive or negative) as out of scope for live execution.
    }
  );

  // TC-app-wide-020 — Successful registration submission — redirect target and auto-login state (P1)
  // DO NOT EXECUTE LIVE — same reason as TC-app-wide-002 (boundary/edge-case-row variant).
  test.fixme(
    'Validate if Register page - a successful registration submission - redirects to /events (or home) in an authenticated, non-admin state',
    async ({ registerPage }) => {
      // Step 1: Navigate to /register.
      await registerPage.goto();
      // Step 2: Fill the form with a different never-used email and a valid, matching password/confirm-password.
      await registerPage.fillForm({
        email: 'another-valid-never-used-email@example.com',
        password: 'TestPass1!',
        confirmPassword: 'TestPass1!',
      });
      // Step 3: Submit the form.
      await registerPage.submit();
      // Step 4 (not executed): Would assert: URL is /events (or home); nav shows Home/Events/My Bookings/API
      // Docs/Logout, no Admin (fresh accounts are not expected to be admin-capable).
      // NOT EXECUTED per this run's no-live-mutation constraint.
    }
  );
});
