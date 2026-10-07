import { Page, Locator } from '@playwright/test';

/** Page Object for /login (also the redirect target for "/" when unauthenticated). */
export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly signInButton: Locator;
  readonly registerLink: Locator;

  constructor(private readonly page: Page) {
    this.emailInput = page.getByPlaceholder('you@email.com');
    this.passwordInput = page.getByPlaceholder('••••••');
    this.signInButton = page.getByRole('button', { name: 'Sign In' });
    this.registerLink = page.getByRole('link', { name: 'Register' });
  }

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.signInButton.click();
  }

  /** Fills only the provided field(s), leaving others untouched (for negative/boundary cases). */
  async fillForm(values: { email?: string; password?: string }) {
    if (values.email !== undefined) await this.emailInput.fill(values.email);
    if (values.password !== undefined) await this.passwordInput.fill(values.password);
  }

  async submit() {
    await this.signInButton.click();
  }

  /**
   * Verified live (directly-observed toast for the known-bad `known-bad-user@example.com` fixture,
   * per the clarifications doc): a plain text node reading exactly this, not embedded in any
   * larger joined string.
   */
  invalidCredentialsToast(): Locator {
    return this.page.getByText('Invalid email or password', { exact: true });
  }

  /** Verified live: shown under Email when it's empty/malformed. */
  emailError(): Locator {
    return this.page.getByText('Enter a valid email', { exact: true });
  }

  /**
   * Verified live: this is login's own (looser, 6-char) validator message — distinct from
   * register's password-policy message — shown under Password when it's empty.
   */
  passwordError(): Locator {
    return this.page.getByText('Password must be at least 6 characters', { exact: true });
  }
}
