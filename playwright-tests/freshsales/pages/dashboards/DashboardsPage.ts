import { Page, Locator, FrameLocator, expect } from '@playwright/test';
import { BasePage } from '../BasePage';

export const DEFAULT_TABS = ['Sales Essentials Dashboard', 'Sales Dashboard', 'Activities Dashboard'] as const;
export const DASHBOARDS_PATH = '/crm/sales/my_dashboards';

/** Dashboards module. Curated report widgets/Export/Edit live in the freshreports iframe; tabs, '+' and the Activities dashboard are in the main document. */
export class DashboardsPage extends BasePage {
  constructor(page: Page) { super(page); }

  get report(): FrameLocator { return this.page.frameLocator('iframe[src*="freshreports"]'); }
  get tabs(): Locator { return this.page.locator('.homepage-tab'); }
  tab(name: string): Locator { return this.tabs.filter({ has: this.page.locator('span.text-truncate', { hasText: new RegExp(`^\\s*${name}\\s*$`) }) }); }
  tabClose(name: string): Locator { return this.tab(name).locator('a[data-original-title="Close report"]'); }
  get addReport(): Locator { return this.page.locator('[data-original-title="Add report"], [aria-label="Add report"]').first(); }
  get reportSearch(): Locator { return this.page.getByRole('combobox', { name: 'Search report' }); }
  reportOption(name: string): Locator { return this.page.getByRole('option', { name, exact: true }); }

  // curated report header (inside iframe)
  get exportBtn(): Locator { return this.report.locator('#exportMenuItem'); }
  get exportApply(): Locator { return this.report.locator('#exportButtonApply'); }
  get filterBtn(): Locator { return this.report.locator('#FilterPane'); }
  get editBtn(): Locator { return this.report.getByRole('button', { name: /Edit/ }); }
  get discardBtn(): Locator { return this.report.getByRole('button', { name: 'Discard' }); }
  get curatedBadge(): Locator { return this.report.getByRole('button', { name: 'Curated' }); }
  get dataUpdated(): Locator { return this.report.getByText('Data Updated:'); }
  widget(title: string): Locator { return this.report.getByRole('heading', { name: title, level: 1, exact: true }); }

  // Activities dashboard (main document)
  get configureWidgets(): Locator { return this.page.getByRole('button', { name: 'Configure widgets' }); }
  get activityTypeBtn(): Locator { return this.page.getByRole('button', { name: /\+ \d+ activit(y|ies)$/ }); }
  widgetTitle(title: string): Locator { return this.page.getByRole('heading', { name: title, level: 5, exact: true }); }
  get visibleCols(): Locator { return this.page.locator('[data-test-visible-col]'); }
  visibleCol(id: string): Locator { return this.page.locator(`[data-test-visible-col="${id}"]`); }
  get requestDemo(): Locator { return this.page.getByRole('button', { name: 'Request demo' }); }

  async goto(tab?: string) {
    await this.page.goto(`${DASHBOARDS_PATH}${tab ? `?tab=${tab}` : ''}`);
    await expect(this.tabs.first()).toBeVisible({ timeout: 30_000 });
    await this.dismissNoise();
  }

  async openFromNav() {
    await this.page.goto('/crm/sales/contacts');
    await this.page.locator('a[href*="/crm/sales/my_dashboards"]').first().click();
    await expect(this.tabs.first()).toBeVisible({ timeout: 30_000 });
  }

  async select(name: string, urlPart?: RegExp) {
    await this.dismissNoise();
    await expect(async () => {
      await this.tab(name).click();
      if (urlPart) await expect(this.page).toHaveURL(urlPart, { timeout: 4_000 });
    }).toPass({ timeout: 30_000 });
  }

  async tabNames(): Promise<string[]> {
    return (await this.tabs.locator('span.text-truncate').allTextContents()).map((s) => s.trim());
  }

  async openAddReport() {
    await this.addReport.click();
    await expect(this.reportSearch).toBeVisible();
  }

  /** Adds a popular report as a new tab (mutating). */
  async addReportTab(name: string) {
    await this.openAddReport();
    await this.reportOption(name).click();
  }

  /** Removes ONLY a non-default tab. Refuses to touch default tabs. */
  async removeRunCreatedTab(name: string) {
    if ((DEFAULT_TABS as readonly string[]).includes(name)) throw new Error(`Refusing to remove default tab ${name}`);
    await this.tabClose(name).first().click();
  }

  /** Configure-widgets drawer helpers */
  get hiddenEmpty(): Locator { return this.page.getByText('No widgets found.'); }
  colCheckbox(id: string): Locator { return this.visibleCol(id).locator('input[type=checkbox]'); }
  async openConfigure() {
    await this.configureWidgets.click();
    await expect(this.page.getByText('Visible widgets')).toBeVisible();
  }
}
