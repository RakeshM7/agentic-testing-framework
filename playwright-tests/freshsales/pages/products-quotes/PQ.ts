import path from 'path';
import { Browser, Page, Locator, expect, test as base } from '@playwright/test';
import { record, markDeleted, isCreated, pending, RUN } from './tracker';

export const PRODUCTS_VIEW = '/crm/sales/products/view/402015942778?per_page=100';
export const QUOTES_LIST = '/crm/sales/cpq_documents/view/402015942782';
export const TEMPLATES_URL = '/crm/sales/settings/cpq-document-templates';
export const CPQ_URL = '/crm/sales/settings/cpq';
const STORAGE = path.join(__dirname, '..', '..', '.auth', 'freshsales-handoff.json');

export const test = base.extend<{ pq: PQ }>({ pq: async ({ page }, use) => use(new PQ(page)) });
export { expect };

/** Records observed behaviour for UNCONFIRMED rules instead of asserting a guess. */
export function observe(description: string) {
  test.info().annotations.push({ type: 'observed', description });
}

/** Page object for Products, Document Templates, Quotes and the run-created Deal/Contact prerequisites. */
export class PQ {
  constructor(readonly page: Page) {}

  // ---------- generic
  async dismissNoise() {
    for (const c of await this.page.getByRole('button', { name: 'Close', exact: true }).all()) {
      await c.click({ timeout: 1_000 }).catch(() => undefined);
    }
  }
  get dropdown(): Locator { return this.page.locator('.ember-basic-dropdown-content'); }
  get saveButton(): Locator { return this.page.getByRole('button', { name: 'Save', exact: true }); }
  get cancelButton(): Locator { return this.page.getByRole('button', { name: 'Cancel', exact: true }); }
  /** Inline field error text(s) rendered under invalid form groups. */
  get fieldErrors(): Locator { return this.page.locator('.validation-msg, .display-error-message, .error-message'); }
  toast(text: string | RegExp): Locator { return this.page.getByText(text).first(); }

  // ---------- products list
  async gotoProducts() {
    await this.page.goto(PRODUCTS_VIEW);
    await expect(this.addProductButton).toBeVisible();
    await this.dismissNoise();
    await expect(this.page.getByText('All Products', { exact: true }).first()).toBeVisible();
  }
  get addProductButton(): Locator { return this.page.getByRole('button', { name: 'Add product', exact: true }); }
  get productsTableNames(): Locator { return this.page.locator('table').first(); }
  productLinks(name: string): Locator { return this.productsTableNames.getByText(name, { exact: true }); }
  productLink(name: string): Locator { return this.productLinks(name).first(); }
  /** Left table holds the Name column, right table the remaining columns; they share row order. */
  async rowCells(name: string): Promise<string> {
    await expect(this.productLink(name)).toBeVisible();
    const names = this.productsTableNames.locator('tbody tr');
    const n = await names.count();
    let idx = -1;
    for (let i = 0; i < n; i++) if ((await names.nth(i).innerText()).includes(name)) { idx = i; break; }
    expect(idx, `row for ${name}`).toBeGreaterThanOrEqual(0);
    return (await this.page.locator('table').nth(1).locator('tbody tr').nth(idx).innerText()).replace(/\s+/g, ' ').trim();
  }
  /** Attempts Save on an open product drawer; resolves 'created' (success toast) or 'blocked' (inline error / drawer stays). */
  async trySave(): Promise<'created' | 'blocked'> {
    await this.saveButton.click();
    const created = this.page.getByText(/Product (added|cloned|updated)\./).first();
    const blocked = this.fieldErrors.first();
    await expect(created.or(blocked).or(this.page.getByText(/Review \d+ field/))).toBeVisible({ timeout: 10_000 });
    return (await created.isVisible()) ? 'created' : 'blocked';
  }
  /** Deletes every list row with this exact name (all are run-created by construction: the caller recorded the name). */
  async removeAllNamed(name: string) {
    await this.gotoProducts();
    while ((await this.productLinks(name).count()) > 0) {
      record({ type: 'product', identifier: name, url: '', note: 'duplicate cleanup', deleted: false });
      await this.deleteProduct(name);
      await this.gotoProducts();
    }
  }
  /** If a duplicate-name attempt unexpectedly succeeded, deletes the extra rows (all but the first) of that run-created name. */
  async removeDuplicatesOf(name: string) {
    for (let guard = 0; guard < 3 && (await this.productLinks(name).count()) > 1; guard++) {
      await this.productLinks(name).nth(1).click();
      await expect(this.drawerTitle).toBeVisible();
      await this.kebabAction('Delete');
      await this.confirmYes.click();
      await this.gotoProducts();
    }
  }
  async listCount(): Promise<number> {
    const t = await this.page.getByText(/\(\d+\)/).first().innerText();
    return Number(t.replace(/\D/g, ''));
  }

  // ---------- product create / edit / clone drawers
  get nameInput(): Locator { return this.page.locator('input[name="product[name]"]'); }
  get priceInput(): Locator { return this.page.locator('input.unit-price'); }
  get codeInput(): Locator { return this.page.locator('input[name="product[productCode]"]'); }
  get skuInput(): Locator { return this.page.locator('input[name="product[skuNumber]"]'); }
  get oneTimeRadio(): Locator { return this.page.locator('label.product__pricing-type, label.inline-radio').filter({ hasText: 'One-time pricing' }).first(); }
  get subscriptionRadio(): Locator { return this.page.locator('label.inline-radio').filter({ hasText: 'Subscription pricing' }).first(); }

  async openAddProduct() {
    await expect(async () => {
      if (!(await this.nameInput.isVisible())) await this.addProductButton.click({ timeout: 3_000 });
      await expect(this.nameInput).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
  }
  async showAllFields() {
    const b = this.page.getByRole('button', { name: 'Show all fields' });
    if (await b.isVisible()) await b.click();
    await expect(this.codeInput).toBeVisible();
  }
  async fillProduct(d: { name?: string; price?: string; code?: string; sku?: string }) {
    if (d.name !== undefined) await this.nameInput.fill(d.name);
    if (d.price !== undefined) await this.priceInput.fill(d.price);
    if (d.code !== undefined) await this.codeInput.fill(d.code);
    if (d.sku !== undefined) await this.skuInput.fill(d.sku);
  }
  /** Creates a ZZ product and records it BEFORE Save (so a mid-flow failure still gets cleaned up). */
  async createProduct(name: string, price: string, extra: { code?: string; sku?: string; note?: string } = {}) {
    await this.gotoProducts();
    await this.openAddProduct();
    if (extra.code || extra.sku) await this.showAllFields();
    await this.fillProduct({ name, price, code: extra.code, sku: extra.sku });
    record({ type: 'product', identifier: name, url: '', note: extra.note ?? 'product' });
    await this.saveButton.click();
    await expect(this.toast('Product added.')).toBeVisible();
    await this.gotoProducts();
    await expect(this.productLink(name)).toBeVisible();
  }

  // ---------- product detail drawer
  async openProduct(name: string) {
    await this.productLink(name).click();
    await expect(this.drawerTitle).toBeVisible();
    await expect(this.page.getByText(name, { exact: true }).nth(1)).toBeVisible();
  }
  get drawerTitle(): Locator { return this.page.getByText('Product', { exact: true }).first(); }
  get pencil(): Locator { return this.page.locator('button.fsa-icon-button.truncate-right').first(); }
  get kebab(): Locator { return this.page.locator('.fsa-dropdown-trigger').last(); }
  async kebabAction(label: string) {
    await expect(async () => {
      if (!(await this.dropdown.isVisible())) await this.kebab.click({ timeout: 3_000 });
      await this.dropdown.getByText(label, { exact: true }).click({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
  }
  async openClone() {
    await this.kebabAction('Clone');
    await expect(this.nameInput).toBeVisible();
  }
  async openEdit() {
    await this.pencil.click();
    await expect(this.nameInput).toBeVisible();
  }
  get confirmYes(): Locator { return this.page.getByRole('button', { name: 'Yes', exact: true }); }
  get confirmNo(): Locator { return this.page.getByRole('button', { name: 'No', exact: true }); }

  /** Deletes a product this suite created, via the detail drawer kebab. */
  async deleteProduct(name: string) {
    if (!isCreated('product', name)) throw new Error(`Refusing to delete product "${name}": not created by this track`);
    await this.gotoProducts();
    await this.openProduct(name);
    await this.kebabAction('Delete');
    await expect(this.page.getByText('Delete this product and its related data?')).toBeVisible();
    await this.confirmYes.click();
    await expect(this.page.getByText('Delete this product and its related data?')).toBeHidden();
    markDeleted('product', name);
  }

  // ---------- views (Recycle Bin)
  async openViewsMenu() {
    await this.page.mouse.click(91, 124);
    await expect(this.page.getByText('Recycle Bin', { exact: true })).toBeVisible();
  }
  async openRecycleBin() {
    await this.openViewsMenu();
    await this.page.getByText('Recycle Bin', { exact: true }).click();
  }

  // ---------- templates
  async gotoTemplates() {
    await this.page.goto(TEMPLATES_URL);
    await expect(this.page.getByRole('button', { name: 'Create template' })).toBeVisible();
    await this.dismissNoise();
  }

  get templateNameInput(): Locator { return this.page.getByPlaceholder('Enter a name for your template'); }
  get createTemplateButton(): Locator { return this.page.getByRole('button', { name: 'Create template' }); }
  get createButton(): Locator { return this.page.getByRole('button', { name: 'Create', exact: true }); }
  get quoteTypeSelect(): Locator { return this.page.locator('.ember-power-select-trigger').filter({ visible: true }).last(); }
  async openCreateTemplate() {
    await expect(async () => {
      if (!(await this.templateNameInput.isVisible())) await this.createTemplateButton.click({ timeout: 3_000 });
      await expect(this.templateNameInput).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
  }
  async pickQuoteType(type: string) {
    await this.quoteTypeSelect.click();
    await this.page.locator('.ember-power-select-option').filter({ hasText: new RegExp(`^\\s*${type}\\s*$`) }).click();
  }
  templateRow(name: string): Locator { return this.page.getByRole('row').filter({ hasText: name }); }
  /** Deletes a template this suite created (guarded by the track's created-entities file) via its row kebab. */
  async deleteTemplate(name: string) {
    if (!isCreated('template', name)) throw new Error(`Refusing to delete template "${name}": not created by this track`);
    await this.gotoTemplates();
    const row = this.templateRow(name);
    await expect(row).toBeVisible();
    await row.getByRole('button').last().click();
    await this.dropdown.getByText('Delete', { exact: true }).click();
    await this.confirmYes.click();
    await expect(this.templateRow(name)).toHaveCount(0);
    markDeleted('template', name);
  }

  // ---------- deal / contact prerequisites (run-created)
  async createDeal(name: string): Promise<string> {
    await this.page.goto('/crm/sales/deals');
    const add = this.page.locator('button:has-text("Add deal")').first();
    await expect(add).toBeVisible();
    await this.dismissNoise();
    const nameIn = this.page.locator('input[name="deal[name]"]');
    await expect(async () => {
      if (!(await nameIn.isVisible())) await add.click({ timeout: 3_000 });
      await expect(nameIn).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
    await nameIn.fill(name);
    await this.page.locator('input[name="deal[amount]"]').fill('10');
    await this.saveButton.click();
    await expect(this.page).toHaveURL(/\/crm\/sales\/deals\/\d+$/);
    const id = this.page.url().match(/deals\/(\d+)/)![1];
    record({ type: 'deal', identifier: id, url: this.page.url(), note: `${name} (quote prerequisite)` });
    return id;
  }
  async createContact(last: string): Promise<string> {
    await this.page.goto('/crm/sales/contacts');
    const add = this.page.locator('button:has-text("Add contact")').first();
    await expect(add).toBeVisible();
    await this.dismissNoise();
    const email = this.page.locator('input[name="fragments/email-address[value]"]');
    await expect(async () => {
      if (!(await email.isVisible())) await add.click({ timeout: 3_000 });
      await expect(email).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
    await email.fill(`zz.pq.${RUN}@example.test`);
    await this.page.locator('input[name="contact[firstName]"]').fill('ZZ');
    await this.page.locator('input[name="contact[lastName]"]').fill(last);
    await this.saveButton.click();
    await this.page.waitForURL(/\/crm\/sales\/contacts\/\d+$/);
    const id = this.page.url().match(/contacts\/(\d+)/)![1];
    record({ type: 'contact', identifier: id, url: this.page.url(), note: `ZZ ${last} (quote prerequisite)` });
    return id;
  }
  async deleteDeal(id: string) {
    if (!isCreated('deal', id)) throw new Error(`Refusing to delete deal ${id}: not created by this track`);
    await this.page.goto(`/crm/sales/deals/${id}`);
    await expect(this.page.getByRole('button', { name: 'Task', exact: true }).first()).toBeVisible();
    await this.dismissNoise();
    await this.kebabAction('Delete');
    await expect(this.page.getByText('Delete this deal and its related data?')).toBeVisible();
    await this.confirmYes.click();
    await expect(this.page).toHaveURL(/\/crm\/sales\/deals(\/view\/\d+)?(\?.*)?$/);
    markDeleted('deal', id);
  }
  async deleteContact(id: string) {
    if (!isCreated('contact', id)) throw new Error(`Refusing to delete contact ${id}: not created by this track`);
    await this.page.goto(`/crm/sales/contacts/${id}`);
    await expect(this.page.getByText('Lifecycle stage', { exact: true })).toBeVisible();
    await this.dismissNoise();
    await this.page.mouse.click(1403, 119);
    await this.dropdown.getByText('Delete', { exact: true }).click();
    await this.confirmYes.click();
    await this.page.waitForURL(/\/contacts\/view\//);
    markDeleted('contact', id);
  }

  // ---------- quotes
  async gotoQuotes() {
    await this.page.goto(QUOTES_LIST);
    await expect(this.page.getByRole('button', { name: 'Add quote', exact: true })).toBeVisible();
    await this.dismissNoise();
  }
  async openPlusMenu() {
    await this.page.locator('li.navbar-add').click();
  }
  async deleteQuote(id: string) {
    if (!isCreated('quote', id)) throw new Error(`Refusing to delete quote ${id}: not created by this track`);
    await this.page.goto(`/crm/sales/cpq_documents/${id}`);
    await expect(this.page.getByText('Sync quote with deal')).toBeVisible();
    await this.dismissNoise();
    await this.quoteKebab.click();
    await this.dropdown.getByText('Delete', { exact: true }).click();
    await expect(this.page.getByText('Delete this Quote?')).toBeVisible();
    await this.confirmYes.click();
    await expect(this.page).toHaveURL(/cpq_documents\/view\//);
    markDeleted('quote', id);
  }
  get quoteKebab(): Locator { return this.page.locator('.fsa-dropdown-trigger').first(); }
}

/** Soft-deletes every product/quote/deal/contact still marked pending in the track's created-entities.json. */
export async function cleanupPending(browser: Browser, baseURL: string) {
  const ctx = await browser.newContext({ storageState: STORAGE, viewport: { width: 1440, height: 900 }, baseURL });
  const page = await ctx.newPage();
  const pq = new PQ(page);
  const order = ['quote', 'product', 'template', 'deal', 'contact'];
  for (const type of order) {
    for (const e of pending(type)) {
      try {
        if (type === 'product') {
          await pq.gotoProducts();
          if ((await pq.productLinks(e.identifier).count()) === 0) { markDeleted('product', e.identifier); continue; }
          await pq.deleteProduct(e.identifier);
        } else if (type === 'template') {
          await pq.gotoTemplates();
          if ((await pq.templateRow(e.identifier).count()) === 0) { markDeleted('template', e.identifier); continue; }
          await pq.deleteTemplate(e.identifier);
        } else if (type === 'quote') await pq.deleteQuote(e.identifier);
        else if (type === 'deal') await pq.deleteDeal(e.identifier);
        else if (type === 'contact') await pq.deleteContact(e.identifier);
      } catch (err) {
        record({ ...e, note: `${e.note} [cleanup failed: ${(err as Error).message.split('\n')[0]}]` });
      }
    }
  }
  await ctx.close();
}
