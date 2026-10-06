import { Page, FrameLocator, Locator, expect } from '@playwright/test';

/** Analytics runs inside a freshreports.com iframe embedded in the CRM shell. */
export class AnalyticsPage {
  readonly f: FrameLocator;
  constructor(readonly page: Page) {
    this.f = page.frameLocator('iframe[src*="freshreports"]');
  }

  async gotoLibrary() {
    await this.page.goto('/crm/sales/analytics');
    const newReport = this.f.getByRole('button', { name: 'New Report' });
    const crumb = this.f.getByRole('heading', { name: 'Analytics', exact: true });
    // landing may redirect to the last viewed report (non-deterministic): use the Analytics breadcrumb to reach the list
    await expect(newReport.or(crumb).first()).toBeVisible({ timeout: 30_000 });
    if (!(await newReport.isVisible().catch(() => false))) await crumb.click();
    await expect(newReport).toBeVisible({ timeout: 30_000 });
    await this.dismissBanner();
  }
  async gotoPath(path: string) {
    await this.page.goto('/crm/sales/analytics' + path);
  }
  async dismissBanner() { /* renewal banner does not block the iframe; kept for symmetry */ }

  sidebar(name: string): Locator { return this.f.getByText(name, { exact: true }).first(); }
  get libraryRows(): Locator { return this.f.getByRole('row').filter({ hasNot: this.f.getByRole('columnheader') }); }
  libraryRow(name: string): Locator { return this.f.getByRole('row').filter({ has: this.f.getByRole('gridcell', { name }) }); }

  // ---- report builder
  get nameInput(): Locator { return this.f.locator('h2 input'); }
  get saveBtn(): Locator { return this.f.getByRole('button', { name: 'Save', exact: true }); }
  async openBuilder() {
    await this.gotoLibrary();
    await this.f.getByRole('button', { name: 'New Report' }).click();
    await expect(this.page).toHaveURL(/analytics\/reports\/new\/page\/1/);
    await expect(this.nameInput).toHaveValue('Untitled Report', { timeout: 30_000 });
  }
  /** Adds the Deals gallery template widget by drag-and-drop (the app only accepts a real drag). */
  async addGalleryDealsWidget() {
    const f = this.f;
    const galleryCard = f.getByRole('heading', { name: 'Gallery', exact: true });
    // the ADD WIDGETS panel may already be open (persisted UI state); only open it when the Gallery card is absent
    if (!(await galleryCard.isVisible().catch(() => false))) await f.getByRole('button', { name: 'Add Widgets' }).click();
    await galleryCard.click();
    await f.getByRole('heading', { name: 'Accounts', level: 2 }).click();
    await f.getByText('Deals', { exact: true }).first().click();
    const tpl = f.getByRole('heading', { name: 'TOTAL Deals grouped by Sales owner', level: 3 });
    await expect(tpl).toBeVisible();
    const hb = (await tpl.boundingBox())!;
    const cv = (await f.getByText('Drag and Drop widgets here').boundingBox())!;
    const m = this.page.mouse;
    await m.move(hb.x + 20, hb.y + hb.height / 2);
    await m.down();
    await m.move(hb.x + 60, hb.y + 30, { steps: 5 });
    await m.move(cv.x + cv.width / 2, cv.y + cv.height / 2, { steps: 20 });
    await m.up();
    await expect(f.getByRole('heading', { name: 'TOTAL Deals grouped by Sales owner', level: 1 })).toBeVisible({ timeout: 20_000 });
  }
  /** Creates a report with the Gallery widget and returns its view URL. */
  async createReport(name: string): Promise<string> {
    await this.openBuilder();
    await this.addGalleryDealsWidget();
    await this.nameInput.fill(name);
    await this.saveBtn.click();
    await this.page.waitForURL(/analytics\/reports\/(?!new)[^/]+\/page\/1/, { timeout: 30_000 });
    return this.page.url();
  }

  // ---- report view
  get chevron(): Locator { return this.f.getByRole('button', { name: 'chevron-icon' }); }
  get exportBtn(): Locator { return this.f.getByRole('button', { name: 'Export' }); }
  get reportTitle(): Locator { return this.f.locator('h2').filter({ has: this.chevron }); }
  async waitView() { await expect(this.exportBtn).toBeVisible({ timeout: 30_000 }); }
  async gotoReport(url: string) { await this.page.goto(url); await this.waitView(); }

  async trashCurrent(name: string) {
    await this.chevron.click();
    await this.f.getByText('Move to trash').click();
    const dlg = this.f.getByRole('dialog');
    await expect(dlg).toContainText(name.slice(0, 40));
    await dlg.getByRole('button', { name: 'Trash' }).click();
    await this.page.waitForURL(/\/crm\/sales\/analytics\/?$/, { timeout: 30_000 });
  }

  // ---- schedules
  get schedulePanel(): Locator { return this.f.getByRole('navigation').filter({ hasText: 'Schedules - Report' }); }
  async openSchedulePanel() {
    await this.exportBtn.click();
    await this.f.getByText('Schedule report').click();
    await expect(this.f.getByRole('heading', { name: 'Schedules - Report' })).toBeVisible();
  }
  async openNewScheduleForm() {
    await this.openSchedulePanel();
    await this.f.getByRole('button', { name: 'New Schedule' }).click();
    await expect(this.schedulePanel.getByRole('textbox').first()).toBeVisible();
  }
  get scName(): Locator { return this.schedulePanel.getByRole('textbox').nth(0); }
  get scSubject(): Locator { return this.schedulePanel.getByRole('textbox').nth(1); }
  get scSave(): Locator { return this.schedulePanel.getByRole('button', { name: 'Save' }); }
  get scCancel(): Locator { return this.schedulePanel.getByRole('button', { name: 'Cancel' }); }
  scheduleCard(name: string): Locator {
    return this.f.locator('[data-testid="StyledScheduleList"] [data-testid="StyledCard"]').filter({ hasText: name });
  }
  /** Deletes schedules named like `prefix` on the currently open report (used for run-created ZZ schedules only). */
  async deleteSchedulesNamed(prefix: string) {
    if (!(await this.f.getByRole('heading', { name: 'Schedules - Report' }).isVisible().catch(() => false))) await this.openSchedulePanel();
    await this.page.waitForTimeout(2500);
    for (let i = 0; i < 5; i++) {
      const card = this.f.locator('[data-testid="StyledScheduleList"] [data-testid="StyledCard"]').filter({ hasText: prefix }).first();
      if (!(await card.count())) break;
      await card.locator('.fw-icon-more-vertical').click();
      await this.f.getByText('Delete', { exact: true }).locator('visible=true').click();
      const dlg = this.f.getByRole('dialog');
      await expect(dlg).toContainText('Are you sure you want to delete schedule');
      await dlg.getByRole('button', { name: 'Delete' }).click();
      await expect(dlg).toHaveCount(0);
      await this.page.waitForTimeout(1000);
    }
  }
}

/** Kebab (widget options) of a widget on a report view; icon is only rendered once the card is hovered. */
export function widgetKebab(a: AnalyticsPage, title: string): Locator {
  return a.f
    .locator('[data-testid="StyledCardHeaderTitle"]')
    .filter({ hasText: title })
    .locator('xpath=ancestor::*[.//*[contains(@class,"more-vertical")]][1]')
    .locator('[class*="more-vertical"]')
    .first();
}
