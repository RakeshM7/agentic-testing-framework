import fs from 'fs';
import path from 'path';
import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from '../BasePage';

/** Track-local created-entities log (trackRoot/playwright/created-entities.json). */
export const TRACK_ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'contacts', 'playwright', 'created-entities.json',
);

export interface TrackEntity { type: 'contact'; identifier: string; url: string; createdAt: string; note: string; deleted?: boolean }

function readEntities(): TrackEntity[] {
  return fs.existsSync(TRACK_ENTITIES_FILE) ? JSON.parse(fs.readFileSync(TRACK_ENTITIES_FILE, 'utf-8')) : [];
}
export function recordEntity(e: TrackEntity) {
  fs.mkdirSync(path.dirname(TRACK_ENTITIES_FILE), { recursive: true });
  const list = readEntities();
  const i = list.findIndex((x) => x.identifier === e.identifier);
  if (i >= 0) list[i] = { ...list[i], ...e };
  else list.push(e);
  fs.writeFileSync(TRACK_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}
export function pendingEntities() { return readEntities().filter((x) => !x.deleted && x.type === 'contact'); }
export function isTrackCreated(id: string) {
  return readEntities().some((x) => x.identifier === id);
}

export const RUN = `${Date.now()}`;
export interface Made { id: string; url: string; first: string; last: string; fullName: string; email: string }

export class ContactsModulePage extends BasePage {
  constructor(page: Page) { super(page); }

  get addContactButton() { return this.page.locator('button:has-text("Add contact")').first(); }
  get email() { return this.page.locator('input[name="fragments/email-address[value]"]'); }
  get firstName() { return this.page.locator('input[name="contact[firstName]"]'); }
  get lastName() { return this.page.locator('input[name="contact[lastName]"]'); }
  get jobTitle() { return this.page.locator('input[name="contact[jobTitle]"]'); }
  get mobile() { return this.page.locator('input[name="contact[mobileNumber]"]'); }
  get listLinks() { return this.page.locator('a[href^="/crm/sales/contacts/"]:not([href*="view"])'); }
  get footer() { return this.page.getByText(/Showing \d+/); }
  get toast() { return this.page.locator('.toast, [class*="toast"], [role="alert"]'); }

  async gotoList() {
    await this.page.goto('/crm/sales/contacts');
    await expect(this.addContactButton).toBeVisible();
    await this.dismissNoise();
  }

  /** Opens the Add contact drawer; the click occasionally lands before the page is interactive, so retry. */
  async openAdd() {
    await expect(async () => {
      if (!(await this.email.isVisible())) await this.addContactButton.click({ timeout: 3_000 });
      await expect(this.email).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
  }

  async fill(d: { email?: string; first?: string; last?: string; mobile?: string; job?: string }) {
    if (d.email !== undefined) await this.email.fill(d.email);
    if (d.first !== undefined) await this.firstName.fill(d.first);
    if (d.last !== undefined) await this.lastName.fill(d.last);
    if (d.mobile !== undefined) await this.mobile.fill(d.mobile);
    if (d.job !== undefined) await this.jobTitle.fill(d.job);
  }

  fieldError(text: string): Locator {
    return this.page.locator('.display-error-message').filter({ hasText: text });
  }

  /** Creates a TCContacts-prefixed @example.com contact through the UI and records it. */
  async create(label: string, extra: { job?: string } = {}): Promise<Made> {
    const last = `${label}${RUN}`;
    const email = `tccontacts.${label.toLowerCase()}.${RUN}@example.com`;
    await this.gotoList();
    await this.openAdd();
    await this.fill({ email, first: 'TCContacts', last, job: extra.job });
    await this.drawerSave.click();
    await this.page.waitForURL(/\/crm\/sales\/contacts\/\d+$/);
    const url = this.page.url();
    const id = url.match(/contacts\/(\d+)/)![1];
    recordEntity({ type: 'contact', identifier: id, url, createdAt: new Date().toISOString(), note: `TCContacts ${last}` });
    await expect(this.heading).toBeVisible();
    await this.dismissNoise();
    return { id, url, first: 'TCContacts', last, fullName: `TCContacts ${last}`, email };
  }

  get heading() { return this.page.getByRole('heading', { level: 3 }).first(); }

  async openDetail(m: Made) {
    await this.page.goto(m.url);
    await expect(this.page.getByText('Lifecycle stage', { exact: true })).toBeVisible();
    await this.dismissNoise();
  }

  /** Three-dots menu at the right of the detail action bar. */
  async openKebab() {
    await this.dismissNoise();
    await this.page.mouse.click(1403, 119);
    await expect(this.page.locator('.ember-basic-dropdown-content').getByText('Delete', { exact: true })).toBeVisible();
  }
  async kebabChoose(item: string) {
    await this.openKebab();
    await this.page.locator('.ember-basic-dropdown-content').getByText(item, { exact: true }).click();
  }

  /** ag-grid row by contact id (row-id attribute); rows are not exposed with their text as accessible names. */
  rowById(id: string): Locator {
    return this.page.locator(`.ag-row[row-id="${id}"]`);
  }

  rowFor(name: string): Locator {
    return this.page.getByRole('row').filter({ hasText: name });
  }

  /** Soft-deletes a contact via the kebab; refuses anything not created by this track. */
  async deleteGuarded(m: Pick<Made, 'id' | 'url' | 'fullName'>) {
    if (!isTrackCreated(m.id)) throw new Error(`Refusing to delete contact ${m.id}: not created by this suite`);
    await this.page.goto(m.url);
    await expect(this.page.getByText(m.fullName).first()).toBeVisible();
    await this.dismissNoise();
    await this.kebabChoose('Delete');
    await this.page.getByRole('button', { name: 'Yes', exact: true }).click();
    await this.page.waitForURL(/\/contacts\/view\//);
    recordEntity({ type: 'contact', identifier: m.id, url: m.url, createdAt: new Date().toISOString(), note: `${m.fullName} deleted`, deleted: true });
  }
}

/**
 * Guarded cleanup: deletes only contacts recorded in this track's created-entities.json (TCContacts-prefixed) that are
 * still live; marks an entity deleted only when the delete was confirmed (or the contact is already gone).
 */
export async function cleanupTrackEntities(browser: import('@playwright/test').Browser, only?: (note: string) => boolean) {
  const ctx = await browser.newContext({
    storageState: path.join(__dirname, '..', '..', '.auth', 'freshsales-handoff.json'),
    baseURL: process.env.FRESHSALES_URL || 'https://rakesh-freshsales-ind-sep21.myfreshworks.com',
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();
  const m = new ContactsModulePage(page);
  for (const c of pendingEntities().filter((e) => e.note.includes('TCContacts') && (!only || only(e.note)))) {
    try {
      await page.goto(c.url);
      const lifecycle = page.getByText('Lifecycle stage', { exact: true });
      const gone = page.getByText('This contact is not in the CRM');
      await lifecycle.or(gone).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
      const live = await lifecycle.isVisible();
      if (live) {
        await m.dismissNoise();
        await m.kebabChoose('Delete');
        await page.getByRole('button', { name: 'Yes', exact: true }).click();
        await page.waitForURL(/\/contacts\/view\//, { timeout: 20_000 });
        recordEntity({ ...c, deleted: true, note: `${c.note} (deleted by cleanup)` });
      } else if (await gone.isVisible()) {
        recordEntity({ ...c, deleted: true, note: `${c.note} (already gone)` });
      }
    } catch (e) { console.log(`cleanup of ${c.identifier} failed: ${e}`); }
  }
  await ctx.close();
}
