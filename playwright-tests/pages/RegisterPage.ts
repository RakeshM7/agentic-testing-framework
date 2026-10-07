import { Page, Locator } from '@playwright/test';

export interface RegisterFormValues {
  email?: string;
  password?: string;
  confirmPassword?: string;
}

/** Page Object for /register ("Create your account" — EventHub's sandbox-account signup form). */
export class RegisterPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly createAccountButton: Locator;
  readonly signInLink: Locator;

  constructor(private readonly page: Page) {
    // Email/Password have data-testid="register-email" / "register-password" (confirmed live);
    // Confirm Password has no testid, so it's targeted by its distinct placeholder instead.
    this.emailInput = page.getByTestId('register-email');
    this.passwordInput = page.getByTestId('register-password');
    this.confirmPasswordInput = page.getByPlaceholder('Repeat your password');
    this.createAccountButton = page.getByRole('button', { name: 'Create Account' });
    this.signInLink = page.getByRole('link', { name: 'Sign in' });
  }

  async goto() {
    await this.page.goto('/register');
  }

  /** Fills only the provided fields, leaving others untouched (for negative/boundary cases). */
  async fillForm(values: RegisterFormValues) {
    if (values.email !== undefined) await this.emailInput.fill(values.email);
    if (values.password !== undefined) await this.passwordInput.fill(values.password);
    if (values.confirmPassword !== undefined) await this.confirmPasswordInput.fill(values.confirmPassword);
  }

  async submit() {
    await this.createAccountButton.click();
  }

  /**
   * Verified live (read-only, form never submitted): the email field's own validator renders
   * this exact text when empty/malformed. It is a single dedicated element directly below the
   * Email label, not concatenated with anything else.
   */
  emailError(): Locator {
    return this.page.getByText('Enter a valid email', { exact: true });
  }

  /**
   * Verified live: shown when Password itself doesn't satisfy the displayed policy (too short /
   * missing uppercase / missing number / missing special character) — the same generic copy for
   * every individual rule violation; the app does not render a rule-specific message.
   */
  passwordPolicyError(): Locator {
    return this.page.getByText('Password does not meet the requirements below', { exact: true });
  }

  /** Verified live: shown whenever Confirm Password differs from Password (both non-empty). */
  passwordMismatchError(): Locator {
    return this.page.getByText('Passwords do not match', { exact: true });
  }
}
