import { Page, Locator } from '@playwright/test';

export class BasePage {
  constructor(protected readonly page: Page) {}

  /** Closes the reminder toasts / banners that overlay the CRM chrome and intercept clicks. */
  async dismissNoise() {
    const closers = this.page.getByRole('button', { name: 'Close', exact: true });
    for (const c of await closers.all()) {
      await c.click({ timeout: 1_000 }).catch(() => undefined);
    }
  }

  get drawerSave(): Locator {
    return this.page.getByRole('button', { name: 'Save', exact: true });
  }
}
