import fs from 'fs';
import path from 'path';
import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../BasePage';

export const ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'accounts', 'playwright', 'created-entities.json',
);
export const ZZ_RUN = `${Date.now()}`.slice(-8);

export interface AccountEntity { type: 'account'; identifier: string; url: string; createdAt: string; note: string; deleted?: boolean }

export function recordAccount(e: Omit<AccountEntity, 'type' | 'createdAt'> & { note?: string }) {
  fs.mkdirSync(path.dirname(ENTITIES_FILE), { recursive: true });
  const list: AccountEntity[] = fs.existsSync(ENTITIES_FILE) ? JSON.parse(fs.readFileSync(ENTITIES_FILE, 'utf-8')) : [];
  const i = list.findIndex((x) => x.identifier === e.identifier);
  const rec = { type: 'account' as const, createdAt: new Date().toISOString(), note: 'created by accounts track', ...e };
  if (i >= 0) list[i] = { ...list[i], ...rec, createdAt: list[i].createdAt };
  else list.push(rec);
  fs.writeFileSync(ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}

export function isRunCreated(identifier: string): boolean {
  if (!identifier.startsWith('ZZ') || !fs.existsSync(ENTITIES_FILE)) return false;
  return (JSON.parse(fs.readFileSync(ENTITIES_FILE, 'utf-8')) as AccountEntity[]).some((x) => x.identifier === identifier);
}

export class AccountsPage extends BasePage {
  readonly addAccountButton: Locator;
  readonly nameInput: Locator;
  readonly websiteInput: Locator;
  readonly phoneInput: Locator;
  readonly dialog: Locator;

  constructor(page: Page) {
    super(page);
    this.addAccountButton = page.locator('button:has-text("Add account")').first();
    this.dialog = page.locator('[role="dialog"]');
    this.nameInput = page.locator('input[name="sales-account[name]"]');
    this.websiteInput = page.locator('input[name="sales-account[website]"]');
    this.phoneInput = page.locator('input[name="sales-account[phone]"]');
  }

  async goto() {
    await this.page.goto('/crm/sales/accounts');
    await expect(this.addAccountButton).toBeVisible();
    await this.dismissNoise();
  }

  async openAdd(showAll = false) {
    await this.addAccountButton.click();
    await expect(this.nameInput).toBeVisible();
    if (showAll) {
      await this.page.getByRole('button', { name: 'Show all fields' }).click();
      await expect(this.phoneInput).toBeVisible();
    }
  }

  async save() {
    await this.dialog.getByRole('button', { name: 'Save', exact: true }).click();
  }

  accountIdFromUrl(): string | null {
    return this.page.url().match(/\/accounts\/(\d+)/)?.[1] ?? null;
  }

  /** Creates an account via the Add drawer, records it, and returns its id. */
  async create(d: { name: string; website?: string; phone?: string }): Promise<string> {
    await this.goto();
    await this.openAdd(d.phone !== undefined);
    await this.nameInput.fill(d.name);
    if (d.website !== undefined) await this.websiteInput.fill(d.website);
    if (d.phone !== undefined) await this.phoneInput.fill(d.phone);
    await this.save();
    await this.page.waitForURL(/\/crm\/sales\/accounts\/\d+/);
    const id = this.accountIdFromUrl()!;
    recordAccount({ identifier: d.name, url: this.page.url() });
    await expect(this.page.locator('h3').first()).toContainText(d.name);
    return id;
  }

  kebab(): Locator {
    return this.page.locator('.fsa-dropdown-trigger').last(); // right-most trigger = kebab (Call/Add deal chevrons come first)
  }

  async openKebabItem(label: 'Edit' | 'Clone' | 'Delete') {
    await this.kebab().click();
    await this.page.locator('li.menu-item').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first().click();
  }

  /** Deletes a run-created account (guarded by the created-entities file) from its detail page. */
  async deleteRunCreated(id: string, name: string) {
    if (!isRunCreated(name)) throw new Error(`Refusing to delete non run-created account "${name}"`);
    await this.page.goto(`/crm/sales/accounts/${id}`);
    await expect(this.page.locator('h3').first()).toContainText(name);
    await this.dismissNoise();
    await this.openKebabItem('Delete');
    await expect(this.dialog).toContainText('Delete this account?');
    await this.dialog.getByRole('button', { name: 'Yes' }).click();
    await expect(this.dialog).toBeHidden();
    await this.page.goto(`/crm/sales/accounts/${id}`);
    await expect(this.page.getByText('This account is not in the CRM.')).toBeVisible({ timeout: 20_000 });
    recordAccount({ identifier: name, url: `/crm/sales/accounts/${id}`, deleted: true });
  }

  /** Best-effort cleanup that never throws (used in finally blocks). */
  async safeDelete(id: string | null, name: string) {
    if (!id) return;
    await this.deleteRunCreated(id, name).catch((e) => console.log(`cleanup of ${name} failed: ${e}`));
  }

  async openView(label: string) {
    await this.page.getByText(/\d+ more\.\.\./).first().click();
    await this.page.getByText(label, { exact: true }).first().click();
  }
}
