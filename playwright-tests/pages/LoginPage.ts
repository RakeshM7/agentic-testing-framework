import { Page } from '@playwright/test';

/** Page Object for /login (also the redirect target for "/" when unauthenticated). */
export class LoginPage {
  constructor(private readonly page: Page) {}

  async goto() {
    await this.page.goto('/login');
  }

  async login(email: string, password: string) {
    await this.page.getByPlaceholder('you@email.com').fill(email);
    await this.page.getByPlaceholder('••••••').fill(password);
    await this.page.getByRole('button', { name: 'Sign In' }).click();
  }
}
