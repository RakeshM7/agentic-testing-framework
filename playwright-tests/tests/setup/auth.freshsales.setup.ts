import { test as setup, expect } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';
import { LoginPage } from '../../pages/freshsales/LoginPage';

const AUTH_FILE = path.join(__dirname, '..', '..', '.auth', 'freshsales-user.json');

// Freshsales credentials live in their own file, separate from the root .env (which holds
// EVENTHUB_* for the other target in this project) — loaded explicitly here rather than via the
// global `import 'dotenv/config'` in playwright.config.ts, so the two targets' env vars never
// collide under the same key names.
const ENV_FILE = path.join(__dirname, '..', '..', '.env.freshsales');
const parsed = dotenv.config({ path: ENV_FILE }).parsed ?? {};

/**
 * Runs once before the 'freshsales' project's functional/visual specs (declared as a dependency
 * in playwright.config.ts). Logs into this tenant through the real UI using credentials loaded
 * from playwright-tests/.env.freshsales and persists the resulting storageState so every
 * dependent spec starts already authenticated.
 *
 * Credentials are never logged, printed, or written anywhere by this file — only
 * process.env-sourced values are read and handed straight to Playwright's fill().
 *
 * KNOWN BLOCKER (see playwright-tests/README.md "Known blocker: Freshsales login is
 * reCAPTCHA-gated for scripted browsers"): every scripted submission attempt made against this
 * tenant's login form during this run triggered a Google reCAPTCHA image challenge instead of
 * completing the login — reproduced across headless Chromium, headed Chromium, and a headed real
 * Chrome channel, and across both instant and human-paced (typed character-by-character, with
 * mouse movement) input. This is Google's own automation-detection gate, not an app bug, and this
 * agent does not attempt to solve or bypass it (no CAPTCHA-solving service is in scope, and doing
 * so would circumvent an anti-bot control rather than test the application). This setup step is
 * therefore expected to fail in this environment until a human completes the challenge once
 * interactively and hands off a valid storageState file (or the tenant is placed on a CAPTCHA
 * allowlist for a known automation IP) — see the feedback file referenced in this run's report.
 */
setup('authenticate (freshsales)', async ({ page }) => {
  const email = parsed.FRESHSALES_EMAIL || process.env.FRESHSALES_EMAIL;
  const password = parsed.FRESHSALES_PASSWORD || process.env.FRESHSALES_PASSWORD;

  if (!email || !password) {
    throw new Error(
      `FRESHSALES_EMAIL / FRESHSALES_PASSWORD are not set (checked ${ENV_FILE}). Provide a real, ` +
        'authorized Freshsales test account for rakesh-freshsales-ind-sep21 before running the suite.'
    );
  }

  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(email, password);

  // A successful login redirects away from /login into the authenticated CRM shell
  // (/crm/sales/...). Give it a generous window since Freshsales' SPA bootstrap is slow.
  const stillOnLogin = await page
    .waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 })
    .then(() => false)
    .catch(() => true);

  if (stillOnLogin) {
    const captchaCount = await loginPage.recaptchaChallengeFrame().count();
    if (captchaCount > 0) {
      throw new Error(
        'Freshsales login did not complete: a reCAPTCHA challenge iframe appeared after ' +
          'submitting credentials. This is a known, reproducible blocker for scripted Playwright ' +
          'sessions against this tenant (verified across headless/headed Chromium and a real ' +
          'Chrome channel, with human-paced input) — not a credentials or app-logic problem. ' +
          'See playwright-tests/README.md "Known blocker" and the filed feedback for remediation ' +
          'options (e.g. a human completing the challenge once and handing off storageState, or a ' +
          'CAPTCHA allowlist for the automation IP). This agent does not attempt to solve the ' +
          'challenge itself.'
      );
    }
    throw new Error(
      'Freshsales login did not redirect away from /login and no reCAPTCHA challenge was ' +
        'detected either — the account credentials in .env.freshsales may have been rejected, or ' +
        'the tenant UI has changed since this suite was written. Verify FRESHSALES_EMAIL / ' +
        'FRESHSALES_PASSWORD in playwright-tests/.env.freshsales, then re-run.'
    );
  }

  await expect(page).toHaveURL(/\/crm\/sales\//, { timeout: 15_000 });

  await page.context().storageState({ path: AUTH_FILE });
});
