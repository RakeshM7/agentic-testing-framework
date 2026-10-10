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
    // Rows load after the shell (sample products always exist): wait for them so absence checks are not false negatives.
    await expect(this.productsTableNames.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
    await expect(this.page.getByText(/\(\d+\)/).first()).toBeVisible();
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
    // Created: success toast. Blocked: no toast and the drawer is still open after the save round-trip settles.
    await created.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
    if (!(await created.isVisible())) await expect(this.nameInput).toBeVisible();
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
    // The products list is eventually consistent (header count can include a row the table has not rendered yet): reload until the row shows.
    await expect(async () => {
      if ((await this.productLink(name).count()) === 0) await this.gotoProducts();
      await this.productLink(name).click({ timeout: 5_000 });
    }).toPass({ timeout: 75_000, intervals: [2_000, 4_000] });
    await expect(this.drawerTitle).toBeVisible();
    await expect(this.page.getByText(name, { exact: true }).nth(1)).toBeVisible();
  }
  get drawerTitle(): Locator { return this.page.getByText('Product', { exact: true }).first(); }
  get pencil(): Locator { return this.page.locator('button.fsa-icon-button.truncate-right').first(); }
  get kebab(): Locator { return this.page.locator('.fsa-dropdown-trigger').last(); }
  async kebabAction(label: string) {
    await expect(async () => {
      const item = this.dropdown.getByText(label, { exact: true });
      if (!(await item.isVisible())) {
        if (await this.dropdown.isVisible()) { await this.page.keyboard.press('Escape'); await this.page.waitForTimeout(300); }
        await this.kebab.click({ timeout: 3_000 });
      }
      await item.click({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
  }
  async openClone() {
    // The clone drawer intermittently renders "Sorry, we couldn't load the page." (backend flake): close it and retry the kebab action.
    for (let i = 0; i < 4; i++) {
      await this.kebabAction('Clone');
      const ok = await this.nameInput.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true).catch(() => false);
      if (ok) return;
      await this.page.getByRole('button', { name: 'Close', exact: true }).click({ timeout: 3_000 }).catch(() => undefined);
      await this.page.waitForTimeout(2_000);
    }
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
    if (await this.page.getByText(/cannot be deleted/i).first().isVisible().catch(() => false)) {
      throw new Error(`Product "${name}" cannot be deleted (it has been used on a quote); left pending`);
    }
    markDeleted('product', name);
  }

  // ---------- views (Recycle Bin)
  async openViewsMenu() {
    await this.page.mouse.click(91, 124);
    await expect(this.page.getByText('Recycle Bin', { exact: true }).first()).toBeVisible();
  }
  async openRecycleBin() {
    await this.openViewsMenu();
    await this.page.getByText('Recycle Bin', { exact: true }).first().click();
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
    record({ type: 'deal', identifier: name, url: '', note: `${name} (quote prerequisite, by name until id known)` });
    await this.saveButton.click();
    const id = await this.resolveDealId(name);
    record({ type: 'deal', identifier: id, url: `/crm/sales/deals/${id}`, note: `${name} (quote prerequisite)` });
    markDeleted('deal', name);
    return id;
  }
  /** Id of a deal from the detail URL, or (Save returns to the Pipeline view) from the kanban card's draggable id. */
  async resolveDealId(name: string): Promise<string> {
    await expect(this.page).toHaveURL(/\/crm\/sales\/deals/, { timeout: 20_000 });
    if (/\/deals\/\d+/.test(this.page.url())) return this.page.url().match(/deals\/(\d+)/)![1];
    return this.dealIdFromBoard(name);
  }
  async dealIdFromBoard(name: string): Promise<string> {
    const card = this.page.locator('.each-kanban-card').filter({ hasText: name });
    await expect(async () => {
      if ((await card.count()) === 0) await this.page.goto('/crm/sales/deals', { waitUntil: 'domcontentloaded' });
      await expect(card.first()).toBeVisible({ timeout: 12_000 });
    }).toPass({ timeout: 70_000 });
    const attr = await card.first().getAttribute('data-rbd-draggable-id');
    const id = attr?.match(/deal:(\d+)/)?.[1];
    if (!id) throw new Error(`could not read deal id for ${name}`);
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
    let cur = id;
    if (!/^\d+$/.test(id)) {
      await this.page.goto('/crm/sales/deals', { waitUntil: 'domcontentloaded' });
      const card = this.page.locator('.each-kanban-card').filter({ hasText: id });
      await expect(card.first()).toBeVisible({ timeout: 25_000 }).catch(() => undefined);
      if ((await card.count()) === 0) throw new Error(`deal "${id}" not found on the board; left pending`);
      const real = await this.dealIdFromBoard(id);
      await this.page.goto(`/crm/sales/deals/${real}`, { waitUntil: 'domcontentloaded' });
    } else {
      await expect(async () => {
        await this.page.goto(`/crm/sales/deals/${id}`, { waitUntil: 'domcontentloaded' });
        await expect(this.page.getByRole('button', { name: 'Task', exact: true }).first()).toBeVisible({ timeout: 15_000 });
      }).toPass({ timeout: 90_000, intervals: [3_000] });
    }
    await expect(this.page.getByRole('button', { name: 'Task', exact: true }).first()).toBeVisible();
    await this.dismissNoise();
    await this.kebabAction('Delete');
    await expect(this.page.getByText('Delete this deal and its related data?')).toBeVisible();
    await this.confirmYes.click();
    await expect(this.page).toHaveURL(/\/crm\/sales\/deals(\/view\/\d+)?(\?.*)?$/);
    markDeleted('deal', cur);
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
    await this.page.goto(QUOTES_LIST, { waitUntil: 'domcontentloaded' });
    const add = this.page.getByRole('button', { name: 'Add quote', exact: true });
    await expect(async () => {
      if (!(await add.isVisible())) {
        // The list intermittently renders "We're having trouble applying your changes": back off, then hard-navigate again.
        await this.page.waitForTimeout(4_000);
        await this.page.goto(QUOTES_LIST, { waitUntil: 'domcontentloaded' });
      }
      await expect(add).toBeVisible({ timeout: 15_000 });
    }).toPass({ timeout: 120_000 });
    await this.dismissNoise();
  }
  /** Recycle Bin is virtualised and oldest-first, and grows with every run: scroll to the bottom (up to ~40 steps) until the text is rendered. */
  async scrollBinTo(text: string, exact = false): Promise<boolean> {
    const has = async () => (exact ? (await this.page.getByText(text, { exact: true }).count()) > 0 : (await this.page.locator('body').innerText()).includes(text));
    await this.page.mouse.move(700, 500);
    for (let k = 0; k < 40; k++) {
      if (await has()) return true;
      await this.page.mouse.wheel(0, 3000);
      await this.page.waitForTimeout(500);
    }
    return has();
  }
  async openPlusMenu() {
    await this.page.locator('li.navbar-add').click();
  }
  async deleteQuote(id: string) {
    if (!isCreated('quote', id)) throw new Error(`Refusing to delete quote ${id}: not created by this track`);
    await expect(async () => {
      await this.page.goto(`/crm/sales/cpq_documents/${id}`, { waitUntil: 'domcontentloaded' });
      await expect(this.page.getByText('Sync quote with deal')).toBeVisible({ timeout: 15_000 });
      await this.dismissNoise();
      await this.openQuoteKebab();
      await this.dropdown.getByText('Delete', { exact: true }).click();
      await expect(this.page.getByText('Delete this Quote?')).toBeVisible({ timeout: 10_000 });
    }).toPass({ timeout: 120_000, intervals: [3_000] });
    await this.confirmYes.click();
    await expect(this.page).toHaveURL(/cpq_documents\/view\//, { timeout: 30_000 });
    markDeleted('quote', id);
  }
  /** The quote kebab is an unnamed icon button right of 'View activity' (the first .fsa-dropdown-trigger is the Save arrow). */
  async openQuoteKebab() {
    const va = this.page.getByRole('button', { name: 'View activity', exact: true });
    await expect(va).toBeVisible();
    const box = (await va.boundingBox())!;
    await this.page.mouse.click(box.x + box.width + 24, box.y + box.height / 2);
    await expect(this.dropdown.getByText('Delete', { exact: true })).toBeVisible();
  }

  get quoteNameInput(): Locator { return this.page.locator('input[name="cpq-document[displayName]"]'); }
  get quoteTriggers(): Locator { return this.page.locator('.ember-power-select-trigger').filter({ visible: true }); }
  /** Opens the Add quote drawer from the Quotes list (button) or the header + menu. */
  async openAddQuote(via: 'button' | 'plus' = 'plus') {
    await this.dismissNoise();
    await expect(async () => {
      if (!(await this.quoteNameInput.isVisible())) {
        if (via === 'plus') {
          await this.openPlusMenu();
          await this.page.getByText('Add Quote', { exact: true }).click({ timeout: 3_000 });
        } else await this.page.getByRole('button', { name: 'Add quote', exact: true }).click({ timeout: 3_000 });
      }
      await expect(this.quoteNameInput).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 25_000 });
  }
  /** Picks an option in the n-th lookup (0 Deal, 1 Primary contact, 2 Account, 3 Quote type, 4 Quote template). */
  async pickLookup(index: number, search: string | null, option: string | RegExp) {
    await this.quoteTriggers.nth(index).click();
    if (search) {
      await this.page.locator('.ember-power-select-search-input').filter({ visible: true }).last().fill(search);
    }
    const opt = this.page.locator('.ember-power-select-option').filter({ hasText: option }).first();
    await expect(opt).toBeVisible({ timeout: 20_000 });
    await opt.click();
  }
  /** Creates a quote on the run-created deal/contact; returns the numeric quote id. Records it immediately. */
  async createQuote(dealName: string, contactName: string, quoteName: string, via: 'button' | 'plus' = 'plus'): Promise<string> {
    await this.openAddQuote(via);
    await this.pickLookup(0, dealName, dealName);
    await this.pickLookup(1, contactName, contactName);
    await this.pickLookup(4, null, 'Sample Template');
    await this.quoteNameInput.fill(quoteName);
    await this.saveButton.click();
    await expect(this.page).toHaveURL(/\/crm\/sales\/cpq_documents\/\d+/, { timeout: 30_000 });
    const id = this.page.url().match(/cpq_documents\/(\d+)/)![1];
    record({ type: 'quote', identifier: id, url: this.page.url(), note: `${quoteName} (TC quote)` });
    await expect(this.page.getByText('Sync quote with deal')).toBeVisible();
    await this.dismissNoise();
    return id;
  }
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
