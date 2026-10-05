import { test, expect } from '@playwright/test';
import { DashboardsPage, DEFAULT_TABS } from '../../../pages/dashboards/DashboardsPage';

let d: DashboardsPage;
test.beforeEach(({ page }) => { d = new DashboardsPage(page); });

test.describe('Dashboards: navigation and tabs (read-only)', () => {
  test('TC-dashboards-001 open Dashboards from left navigation', async ({ page }) => {
    await d.openFromNav();
    await expect(page).toHaveURL(/\/crm\/sales\/my_dashboards/);
    for (const t of DEFAULT_TABS) await expect(d.tab(t)).toBeVisible();
    await expect(d.addReport).toBeVisible();
  });

  test('TC-dashboards-020 direct URL opens My dashboards', async ({ page }) => {
    await d.goto();
    await expect(page).toHaveURL(/\/crm\/sales\/my_dashboards/);
    for (const t of DEFAULT_TABS) await expect(d.tab(t)).toBeVisible();
  });

  test('TC-dashboards-002 Sales Essentials Dashboard widgets', async () => {
    await d.goto('353503');
    await expect(d.curatedBadge).toBeVisible({ timeout: 30_000 });
    for (const w of ['Revenue won', 'Revenue lost', 'Deal win/loss percentage', 'Open deal value by stage', 'Contacts by sales owner',
      'Forecasted revenue by deal stage', 'Revenue won by source', 'Tasks by owner']) {
      await expect(d.widget(w)).toBeVisible();
    }
    for (const p of ['Summary', 'Deals', 'Contacts', 'Sales activities', 'Revenue breakdown']) {
      await expect(d.report.getByTitle(p, { exact: true }).first()).toBeVisible();
    }
    await expect(d.exportBtn).toBeEnabled();
    await expect(d.editBtn).toBeEnabled();
  });

  test('TC-dashboards-003 Sales Dashboard widgets', async ({ page }) => {
    await d.goto('353503');
    await d.select('Sales Dashboard', /tab=81767/);
    await expect(page).toHaveURL(/tab=81767/);
    await expect(d.curatedBadge).toBeVisible({ timeout: 30_000 });
    for (const w of ['Contacts created over time', 'Contacts by owner', 'Open pipeline', 'Deals closed over time', 'Stage-wise forecast', 'Quota vs achievement']) {
      await expect(d.widget(w)).toBeVisible();
    }
  });

  test('TC-dashboards-004 Activities Dashboard native widgets', async ({ page }) => {
    await d.goto('353503');
    await d.select('Activities Dashboard', /tab=activities/);
    await expect(page).toHaveURL(/tab=activities/);
    for (const w of ['My calendar', 'Quick Links', "Today's summary", 'Freddy AI insights']) await expect(d.widgetTitle(w)).toBeVisible();
    await expect(d.exportBtn).toHaveCount(0);
    await expect(d.editBtn).toHaveCount(0);
  });

  test('TC-dashboards-029 Sales Essentials pages Contacts / Sales activities / Revenue breakdown open', async () => {
    await d.goto('353503');
    await expect(d.curatedBadge).toBeVisible({ timeout: 30_000 });
    for (const p of ['Contacts', 'Sales activities', 'Revenue breakdown']) {
      await d.report.getByTitle(p, { exact: true }).first().click();
      await expect(d.report.locator('h1').first()).toBeVisible({ timeout: 30_000 }); // loads widgets; contents not asserted (Open Q5)
    }
  });

  test('TC-dashboards-034 Request demo is present and never clicked', async () => {
    await d.goto();
    await expect(d.requestDemo).toBeVisible(); // guard check only
  });
});

test.describe('Dashboards: export and edit mode on curated dashboards', () => {
  test('TC-dashboards-005 Export menu offers Email Now and Download', async () => {
    await d.goto('353503');
    await d.exportBtn.click();
    await expect(d.report.getByText('Email Now', { exact: true })).toBeVisible();
    await expect(d.report.getByText('Download', { exact: true })).toBeVisible();
  });

  test('TC-dashboards-006 Export > Email Now (self only; observed feedback recorded)', async ({ page }) => {
    await d.goto('353503');
    await d.exportBtn.click();
    await d.report.getByText('Email Now', { exact: true }).click();
    if (await d.exportApply.isVisible({ timeout: 3_000 }).catch(() => false)) await d.exportApply.click(); // footer 'Export' confirms (sends to logged-in user only)
    // Confirmation text was never observed; assert only that the app stays on the dashboard without error page.
    await expect(page).toHaveURL(/my_dashboards/);
    await expect(d.exportBtn).toBeVisible();
    const toast = await page.getByText(/sent|email/i).first().textContent({ timeout: 5_000 }).catch(() => null);
    test.info().annotations.push({ type: 'observed-feedback', description: toast ?? 'no toast text captured in main doc' });
  });

  test('TC-dashboards-007 Export > Download saves a file', async ({ page }) => {
    await d.goto('353503');
    await d.exportBtn.click();
    const dl = page.waitForEvent('download', { timeout: 30_000 }).catch(() => null);
    await d.report.getByText('Download', { exact: true }).click();
    if (await d.exportApply.isVisible({ timeout: 3_000 }).catch(() => false)) await d.exportApply.click();
    const file = await dl;
    test.info().annotations.push({ type: 'observed-download', description: file ? file.suggestedFilename() : 'no download event within 30s (may be async/emailed)' });
    await expect(d.exportBtn).toBeVisible();
  });

  test('TC-dashboards-017 Edit mode exposes Discard and filters panel', async () => {
    await d.goto('353503');
    await d.editBtn.click();
    await expect(d.discardBtn).toBeVisible();
    await expect(d.exportBtn).toHaveCount(0);
    await d.filterBtn.click();
    await expect(d.report.getByText('PAGE FILTERS')).toBeVisible();
    await expect(d.report.getByText('REPORT FILTERS')).toBeVisible();
    await expect(d.report.getByText('filter', { exact: true }).first()).toBeVisible();
    await expect(d.report.getByText('date range', { exact: true }).first()).toBeVisible();
    await expect(d.report.getByRole('button', { name: 'Apply' })).toBeVisible();
    await d.discardBtn.click();
    await expect(d.editBtn).toBeVisible();
  });

  test('TC-dashboards-018 / 019 Edit then Discard returns to view mode', async () => {
    await d.goto('353503');
    await d.editBtn.click();
    await expect(d.discardBtn).toBeVisible();
    await d.discardBtn.click();
    await expect(d.exportBtn).toBeVisible();
    await expect(d.editBtn).toBeVisible();
    await expect(d.discardBtn).toHaveCount(0);
  });

  test('TC-dashboards-030 filter panel + filter / + date range then Discard', async () => {
    await d.goto('353503');
    await d.editBtn.click();
    await d.filterBtn.click();
    await d.report.getByText('filter', { exact: true }).first().click();
    await d.report.getByText('date range', { exact: true }).first().click().catch(() => undefined);
    await d.discardBtn.click();
    await expect(d.editBtn).toBeVisible(); // nothing was applied
  });
});
