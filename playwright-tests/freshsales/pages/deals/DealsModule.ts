import { Page, Locator, expect } from '@playwright/test';
import { isDealCreated, markDeleted, recordDeal } from './tracker';

export const ALL_DEALS_VIEW = '/crm/sales/deals/view/402015942744';
export type Layout = 'Table' | 'Pipeline' | 'Forecast';

/** Page object for the Deals module (list layouts, Add/Edit/Clone slide-overs, detail page actions, Recycle Bin). */
export class DealsModule {
  constructor(readonly page: Page) {}

  // ---------- generic helpers
  async dismissNoise() {
    for (const c of await this.page.getByRole('button', { name: 'Close', exact: true }).all()) {
      await c.click({ timeout: 1_000 }).catch(() => undefined);
    }
  }
  toast(text: string | RegExp): Locator { return this.page.getByText(text).first(); }
  get modal(): Locator { return this.page.locator('.modal').filter({ has: this.page.locator(':visible') }).last(); }
  get saveButton(): Locator { return this.page.getByRole('button', { name: 'Save', exact: true }); }
  get nameInput(): Locator { return this.page.locator('input[name="deal[name]"]'); }
  get valueInput(): Locator { return this.page.locator('input[name="deal[amount]"]'); }
  get probabilityInput(): Locator { return this.page.locator('input[name="deal[probability]"]'); }
  dropdown(): Locator { return this.page.locator('.ember-basic-dropdown-content'); }

  // ---------- list page
  get addDealButton(): Locator { return this.page.locator('button:has-text("Add deal")').first(); }
  get layoutButton(): Locator { return this.page.locator('button').filter({ hasText: /^(Table|Pipeline|Forecast|Group by: .+)$/ }).first(); }
  get columns(): Locator { return this.page.locator('.funnel-container'); }
  get gridRows(): Locator { return this.page.locator('.ag-row'); }
  card(name: string): Locator { return this.page.locator('.each-kanban-card').filter({ hasText: name }); }

  /** The last-used view is persisted tenant-side (e.g. Recycle Bin), so always switch back to 'All deals'. */
  async ensureAllDeals() {
    for (let i = 0; i < 3 && !/\/view\/402015942744/.test(this.page.url()); i++) {
      const tab = this.page.getByText('All deals', { exact: true });
      if (await tab.count()) await tab.first().click();
      else await this.page.goto('/crm/sales/deals');
      await this.page.waitForLoadState('load');
      await this.page.waitForTimeout(1_500);
    }
    await expect(this.page).toHaveURL(/\/view\/402015942744/);
  }
  async gotoList() {
    await this.page.goto('/crm/sales/deals');
    await expect(this.addDealButton).toBeVisible();
    await this.dismissNoise();
    await this.ensureAllDeals();
  }

  /** Layout (Table/Pipeline/Forecast) is persisted tenant-side, so always set it explicitly. */
  async setLayout(layout: Layout) {
    await expect(this.layoutButton).toBeVisible();
    if ((await this.layoutButton.innerText()).trim() === layout) return;
    await this.openLayoutMenu();
    await this.layoutMenuItem(layout).click();
    await expect(this.layoutButton).toHaveText(layout);
  }
  async openLayoutMenu() {
    await this.layoutButton.click();
    await expect(this.page.getByText('Group by', { exact: true })).toBeVisible();
  }
  layoutMenuItem(name: string): Locator {
    return this.page.locator('div')
      .filter({ has: this.page.getByText('Group by', { exact: true }) })
      .filter({ has: this.page.getByText('Forecast', { exact: true }) })
      .last().getByText(name, { exact: true });
  }
  async gotoLayout(layout: Layout) {
    await this.gotoList();
    await this.setLayout(layout);
    if (layout === 'Pipeline') await expect(this.columns).toHaveCount(7);
    if (layout === 'Table') await expect(this.gridRows.first()).toBeVisible();
  }
  /** Table with all rows on one page so run-created deals are always visible. */
  async gotoTableAll() {
    await this.page.goto(`${ALL_DEALS_VIEW}?per_page=100`);
    await expect(this.addDealButton).toBeVisible();
    await this.dismissNoise();
    if (!/\/view\/402015942744/.test(this.page.url())) {
      await this.ensureAllDeals();
      await this.page.goto(`${ALL_DEALS_VIEW}?per_page=100`);
      await expect(this.addDealButton).toBeVisible();
    }
    await this.setLayout('Table');
    await expect(this.gridRows.first()).toBeVisible();
  }

  /** Opens a saved view by name through the '<N> more...' picker (its list needs scrolling, so search for it). */
  async openView(name: string) {
    await this.openViewsList();
    await this.page.getByPlaceholder('Search views').fill(name);
    await this.page.getByText(name, { exact: true }).last().click();
  }
  async openViewsList() {
    await this.page.getByText(/^\d+ more\.\.\./).first().click();
    await expect(this.page.getByText('Select a view')).toBeVisible();
  }

  /** Opens the card's three-dots menu (bottom-right of a kanban card; the control has no accessible name). */
  async openCardKebab(card: Locator) {
    const b = (await card.boundingBox())!;
    await this.page.mouse.click(b.x + b.width - 25, b.y + b.height - 20);
  }

  // ---------- create
  async openAddDeal() {
    await expect(async () => {
      await this.addDealButton.click();
      await expect(this.nameInput).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 20_000 });
  }

  /** Creates a ZZ deal through the Add deal slide-over and records it the moment the app lands on its detail page. */
  async createDeal(name: string, value: string, note: string): Promise<string> {
    await this.gotoLayout('Pipeline');
    await this.openAddDeal();
    await this.nameInput.fill(name);
    await this.valueInput.fill(value);
    await this.saveButton.click();
    return this.captureCreated(name, note);
  }
  async captureCreated(name: string, note: string): Promise<string> {
    await expect(this.page).toHaveURL(/\/crm\/sales\/deals\/\d+$/);
    const id = this.page.url().match(/deals\/(\d+)/)![1];
    recordDeal({ type: 'deal', identifier: id, url: this.page.url(), note: `${name} (${note})`, deleted: false });
    return id;
  }

  // ---------- detail page
  async gotoDetail(id: string) {
    await this.page.goto(`/crm/sales/deals/${id}`);
    await expect(this.page.getByRole('button', { name: 'Task', exact: true }).first()).toBeVisible();
    await this.dismissNoise();
  }
  get kebab(): Locator { return this.page.locator('.fsa-dropdown-trigger').last(); }
  async kebabAction(label: 'Edit' | 'Clone' | 'Delete' | 'Commit deal' | 'Remove commit') {
    await this.kebab.click();
    await this.dropdown().getByText(label, { exact: true }).click();
  }
  stage(name: string): Locator { return this.page.locator('.strip-stage').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }); }
  get wonLost(): Locator { return this.page.locator('.strip-stage-won-lost'); }
  async chooseWonLost(which: 'Won' | 'Lost') {
    await this.wonLost.click();
    await this.dropdown().getByText(which, { exact: true }).click();
    await expect(this.page.getByText('Add more details')).toBeVisible();
  }
  async openCommit() {
    await this.page.getByRole('button', { name: 'Commit deal', exact: true }).first().click();
    await expect(this.page.getByText('You must set an expected close date to commit a deal')).toBeVisible();
  }

  /** Deletes a deal this suite created, via the detail kebab. Guarded by the track's created-entities file. */
  async deleteDeal(id: string, expectedName: string) {
    if (!id || !isDealCreated('deal', id)) throw new Error(`Refusing to delete deal ${id}: not created by this track`);
    await this.gotoDetail(id);
    await expect(this.page.getByText(expectedName).first()).toBeVisible();
    await this.kebabAction('Delete');
    await expect(this.page.getByText('Delete this deal and its related data?')).toBeVisible();
    await this.page.getByRole('button', { name: 'Yes', exact: true }).click();
    await expect(this.page).toHaveURL(/\/crm\/sales\/deals(\/view\/\d+)?(\?.*)?$/);
    markDeleted(id, true);
  }
}
