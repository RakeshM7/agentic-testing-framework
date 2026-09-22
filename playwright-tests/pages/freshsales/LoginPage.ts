import { Page, Locator } from '@playwright/test';

/**
 * Page Object for the Freshsales/Freshworks login page
 * (`https://rakesh-freshsales-ind-sep21.myfreshworks.com/login`).
 *
 * Verified live during this run (headed and headless, real Chrome channel): navigating the
 * tenant root redirects unauthenticated visitors to `/login?redirect_uri=...`, which renders a
 * plain `#username` (type=email) / `#password` (type=password) form with a "Sign in" button —
 * these three locators were directly observed in the live DOM, not guessed. See
 * `tests/setup/auth.freshsales.setup.ts` for the known blocker on what happens *after* submit.
 */
export class LoginPage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;

  constructor(private readonly page: Page) {
    this.usernameInput = page.locator('#username');
    this.passwordInput = page.locator('#password');
    this.signInButton = page.getByRole('button', { name: 'Sign in', exact: true });
  }

  async goto() {
    await this.page.goto('/');
    await this.page.waitForURL(/\/login/, { timeout: 15_000 });
  }

  async login(email: string, password: string) {
    await this.usernameInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }

  /**
   * The reCAPTCHA challenge iframe Google serves this tenant's login form. Verified live: a
   * scripted Playwright submission (headless and headed, bundled Chromium and a real Chrome
   * channel, with and without human-paced typing/mouse movement) reliably triggers an image
   * challenge here instead of completing the login — see the "Known blocker" section of
   * playwright-tests/README.md and tests/setup/auth.freshsales.setup.ts.
   */
  recaptchaChallengeFrame(): Locator {
    return this.page.locator('iframe[title*="recaptcha" i], iframe[title*="challenge" i]');
  }
}
