import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class ContactDetailPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  idFromUrl(): string {
    const m = this.page.url().match(/\/contacts\/(\d+)/);
    if (!m) throw new Error(`Not on a contact detail URL: ${this.page.url()}`);
    return m[1];
  }

  get lifecycleLabel(): Locator {
    return this.page.getByText('Lifecycle stage', { exact: true });
  }
  get statusLabel(): Locator {
    return this.page.getByText('Status', { exact: true });
  }
  get overview(): Locator {
    return this.page.getByText('Overview', { exact: true }).first();
  }

  /** Lifecycle-stage dropdown value (the blue text under the 'Lifecycle stage' label). */
  get lifecycleValue(): Locator {
    // The first h3 on the page is the contact name; the lifecycle value is the h3 right after the 'Lifecycle stage' label.
    return this.page.locator('xpath=(//*[normalize-space(text())="Lifecycle stage"])[1]/following::h3[1]');
  }

  /** The status progress bar: 'Qualified / Lost' stage opens a menu with 'Qualified' and 'Lost'. */
  async setStatusQualified() {
    await this.page.getByText('Qualified / Lost').click();
    await this.page.locator('.ember-basic-dropdown-content').getByText('Qualified', { exact: true }).click();
    await expect(this.toast('Contact updated.')).toBeVisible();
  }

  toast(text: string): Locator {
    return this.page.getByText(text, { exact: true });
  }

  get statusNewStage(): Locator {
    return this.page.getByText('New', { exact: true }).first();
  }

  async goto(url: string) {
    await this.page.goto(url);
    await expect(this.lifecycleValue).toBeVisible();
    await this.dismissNoise();
  }

  get statusQualifiedStage(): Locator {
    return this.page.getByRole('button', { name: 'Qualified', exact: true });
  }

  /** Account field in the overview card (inline editor: search combobox with 'Add new "<name>"...'). */
  async openAccountEditor() {
    await this.page.locator('text=Account >> xpath=../.. >> text=Click to add').first().click();
    await this.page.locator('.ember-power-select-trigger').first().click();
  }

  /** Types into the account search and returns the option texts the UI offers. */
  async searchAccount(name: string): Promise<Locator> {
    await this.page.locator('.ember-power-select-search-input:visible').first().fill(name);
    const options = this.page.locator('.ember-power-select-option');
    await expect(options.first()).toBeVisible();
    return options;
  }
}
