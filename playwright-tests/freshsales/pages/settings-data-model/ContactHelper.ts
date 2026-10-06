import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../BasePage';
import { recordEntity } from './helpers';

/** Minimal contact create/delete used only by this track's identity (038-041) and lifecycle-with-contact (043) cases. */
export class ContactHelper extends BasePage {
  constructor(page: Page) { super(page); }
  get addBtn(): Locator { return this.page.locator('button:has-text("Add contact")').first(); }
  get email(): Locator { return this.page.locator('input[name="fragments/email-address[value]"]'); }
  get firstName(): Locator { return this.page.locator('input[name="contact[firstName]"]'); }
  get lastName(): Locator { return this.page.locator('input[name="contact[lastName]"]'); }
  get mobile(): Locator { return this.page.locator('input[name="contact[mobileNumber]"]'); }

  async openAdd() {
    await this.page.goto('/crm/sales/contacts');
    await expect(this.addBtn).toBeVisible();
    await this.dismissNoise();
    await expect(async () => {
      if (!(await this.email.isVisible())) await this.addBtn.click({ timeout: 3_000 });
      await expect(this.email).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
  }

  /** Fills and saves; returns the new contact id when the save created one, else null (drawer stays open). */
  async fillAndSave(d: { email?: string; first?: string; last?: string; mobile?: string }, note: string): Promise<{ id: string; url: string } | null> {
    if (d.first !== undefined) await this.firstName.fill(d.first);
    if (d.last !== undefined) await this.lastName.fill(d.last);
    if (d.email !== undefined) await this.email.fill(d.email);
    if (d.mobile !== undefined) await this.mobile.fill(d.mobile);
    await this.drawerSave.click();
    const created = await this.page.waitForURL(/\/crm\/sales\/contacts\/\d+$/, { timeout: 12_000 }).then(() => true, () => false);
    if (!created) return null;
    const url = this.page.url();
    const id = url.match(/contacts\/(\d+)/)![1];
    recordEntity({ type: 'contact', identifier: id, createdAt: new Date().toISOString(), note });
    return { id, url };
  }

  /** Deletes a contact this suite created (recorded by id); soft-delete via the detail kebab. */
  async deleteById(id: string, note: string) {
    await this.page.goto(`/crm/sales/contacts/${id}`);
    await expect(this.page.getByText('Lifecycle stage', { exact: true })).toBeVisible();
    await this.dismissNoise();
    await this.page.mouse.click(1403, 119);
    const menu = this.page.locator('.ember-basic-dropdown-content');
    await expect(menu.getByText('Delete', { exact: true })).toBeVisible();
    await menu.getByText('Delete', { exact: true }).click();
    await this.page.getByRole('button', { name: 'Yes', exact: true }).click();
    await this.page.waitForURL(/\/contacts\/view\//);
    recordEntity({ type: 'contact', identifier: id, createdAt: new Date().toISOString(), note: `${note} deleted`, deleted: true });
  }
}
