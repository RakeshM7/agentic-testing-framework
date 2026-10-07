import { test as setup, expect } from '@playwright/test';
import { LoginPage } from '../../pages/LoginPage';
import { frameworkConfig } from '../../config/framework.config';
import { waits } from '../../helpers/wait.helper';

const AUTH_FILE = frameworkConfig.auth.eventHubStateFile;

/**
 * Runs once before the functional/visual projects (declared as a dependency
 * in playwright.config.ts). Logs into EventHub through the real UI using
 * credentials loaded from process.env (see .env.example) and persists the
 * resulting storage state so every other spec starts already authenticated.
 *
 * Credentials are never logged, printed, or written anywhere by this file —
 * only process.env.EVENTHUB_EMAIL / EVENTHUB_PASSWORD are read and handed
 * straight to Playwright's fill().
 */
setup('authenticate', async ({ page }) => {
  const email = frameworkConfig.credentials.eventHubEmail;
  const password = frameworkConfig.credentials.eventHubPassword;

  if (!email || !password) {
    throw new Error(
      'EVENTHUB_EMAIL / EVENTHUB_PASSWORD are not set. Copy playwright-tests/.env.example to ' +
        '.env and fill in a real, authorized EventHub test account before running the suite.'
    );
  }

  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(email, password);

  // A successful login redirects away from /login into the authenticated app shell
  // (home or /events) and reveals the authenticated nav (e.g. "My Bookings"). If it
  // doesn't, surface the app's own (non-secret) error banner text so a failure here
  // is diagnosable without ever needing to print the credential values themselves.
  const stillOnLogin = await waits
    .forUrl(page, (url) => !url.pathname.endsWith('/login'))
    .then(() => false)
    .catch(() => true);

  if (stillOnLogin) {
    const errorBanner = page.getByText(/invalid|error|incorrect|failed|blocked|too many/i).first();
    const errorText = await errorBanner.isVisible().then((v) => (v ? errorBanner.innerText() : null)).catch(() => null);
    throw new Error(
      `EventHub login did not redirect away from /login — the account credentials in .env were ` +
        `rejected by the live app.${errorText ? ` App error banner: "${errorText}"` : ''} ` +
        `Verify EVENTHUB_EMAIL / EVENTHUB_PASSWORD in playwright-tests/.env are correct and the ` +
        `account is not locked/rate-limited, then re-run.`
    );
  }

  // Scoped to the primary nav test id: "My Bookings" also appears in the main
  // content and footer, so an unscoped role locator hits Playwright's strict-mode
  // ambiguity check.
  await expect(page.getByTestId('nav-bookings')).toBeVisible();

  await page.context().storageState({ path: AUTH_FILE });
});
