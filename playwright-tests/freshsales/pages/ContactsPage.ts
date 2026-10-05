import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class ContactsPage extends BasePage {
  readonly addContactButton: Locator;
  readonly email: Locator;
  readonly firstName: Locator;
  readonly lastName: Locator;
  readonly mobile: Locator;

  constructor(page: Page) {
    super(page);
    this.addContactButton = page.locator('button:has-text("Add contact")').first();
    this.email = page.locator('input[name="fragments/email-address[value]"]');
    this.firstName = page.locator('input[name="contact[firstName]"]');
    this.lastName = page.locator('input[name="contact[lastName]"]');
    this.mobile = page.locator('input[name="contact[mobileNumber]"]');
  }

  async goto() {
    await this.page.goto('/crm/sales/contacts');
    await expect(this.addContactButton).toBeVisible();
    await this.dismissNoise();
  }

  async openAddContact() {
    await this.addContactButton.click();
    await expect(this.email).toBeVisible();
  }

  async fill(d: { email?: string; first?: string; last?: string; mobile?: string }) {
    if (d.email !== undefined) await this.email.fill(d.email);
    if (d.first !== undefined) await this.firstName.fill(d.first);
    if (d.last !== undefined) await this.lastName.fill(d.last);
    if (d.mobile !== undefined) await this.mobile.fill(d.mobile);
  }

  /** Field-level validation message shown under a form group (literal text from the live form). */
  emailError(text: string): Locator {
    return this.page.locator('.display-error-message').filter({ hasText: text });
  }
}
