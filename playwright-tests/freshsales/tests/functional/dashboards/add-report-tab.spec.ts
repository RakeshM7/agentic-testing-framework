import { test, expect } from '@playwright/test';
import { DashboardsPage, DEFAULT_TABS } from '../../../pages/dashboards/DashboardsPage';
import { recordEntity } from './helpers';

const created = new Set<string>(); // tab names THIS suite added; only these are ever removed

test.describe.serial('Dashboards: add / remove report tabs (full-run, run-created only)', () => {
  let d: DashboardsPage;
  test.beforeEach(({ page }) => { d = new DashboardsPage(page); });

  test.afterAll(async ({ browser }) => {
    if (!created.size) return;
    const ctx = await browser.newContext({ storageState: test.info().project.use.storageState as string });
    const page = await ctx.newPage();
    const dd = new DashboardsPage(page);
    await dd.goto();
    for (const name of created) {
      while (await dd.tab(name).count()) { await dd.removeRunCreatedTab(name); await page.waitForTimeout(800); }
      recordEntity({ type: 'dashboard-tab', identifier: name, createdAt: new Date().toISOString(), note: 'removed in afterAll safety net', deleted: true });
    }
    await ctx.close();
  });

  test('TC-dashboards-010 popular reports list (no tab created)', async ({ page }) => {
    await d.goto();
    const before = await d.tabNames();
    await d.openAddReport();
    for (const r of ['Chat Dashboard', 'Ecommerce Marketing Journey Report', 'Product Dashboard', 'Team activity report', 'Sales Trends', 'Sales Forecast', 'Contact generation and trends']) {
      await expect(d.reportOption(r)).toBeVisible();
    }
    await page.keyboard.press('Escape');
    expect(await d.tabNames()).toEqual(before);
  });

  test('TC-dashboards-023 report search with no match (observed)', async () => {
    await d.goto();
    const before = await d.tabNames();
    await d.openAddReport();
    await d.reportSearch.fill('zzzxxqq-nomatch');
    await expect(d.reportOption('Sales Trends')).toHaveCount(0);
    expect(await d.tabNames()).toEqual(before);
  });

  test('TC-dashboards-008 add Sales Trends as a tab', async ({ page }) => {
    await d.goto();
    test.skip(await d.tab('Sales Trends').count() > 0, 'A pre-existing Sales Trends tab exists; refusing to manage a non-run-created tab');
    await d.addReportTab('Sales Trends');
    created.add('Sales Trends');
    recordEntity({ type: 'dashboard-tab', identifier: 'Sales Trends', createdAt: new Date().toISOString(), note: 'TC-dashboards-008' });
    await expect(d.tab('Sales Trends')).toBeVisible({ timeout: 30_000 });
    await expect(d.curatedBadge).toBeVisible({ timeout: 30_000 });
    for (const w of ['Deals created over time', 'Open pipeline', 'Deals closed over time', 'Pipeline by owner', 'Lost reasons', 'Sales cycle']) {
      await expect(d.widget(w)).toBeVisible();
    }
    await expect(page).toHaveURL(/my_dashboards/);
  });

  test('TC-dashboards-022 add same report twice (observed, not asserted)', async ({ page }) => {
    test.skip(!created.has('Sales Trends'), 'depends on TC-008');
    await d.goto();
    const before = (await d.tabNames()).filter((n) => n === 'Sales Trends').length;
    await d.openAddReport();
    await d.reportOption('Sales Trends').click({ timeout: 5_000 }).catch(() => test.info().annotations.push({ type: 'observed', description: 'Sales Trends option not offered/clickable when tab already exists' }));
    await page.waitForTimeout(3_000);
    const after = (await d.tabNames()).filter((n) => n === 'Sales Trends').length;
    test.info().annotations.push({ type: 'observed', description: `Sales Trends tabs before=${before} after=${after}` });
    expect(after).toBeGreaterThanOrEqual(1);
  });

  test('TC-dashboards-009 remove run-created Sales Trends tab(s)', async () => {
    test.skip(!created.has('Sales Trends'), 'depends on TC-008');
    await d.goto();
    while (await d.tab('Sales Trends').count()) {
      const n = await d.tab('Sales Trends').count();
      await d.removeRunCreatedTab('Sales Trends');
      await expect(d.tab('Sales Trends')).toHaveCount(n - 1);
    }
    recordEntity({ type: 'dashboard-tab', identifier: 'Sales Trends', createdAt: new Date().toISOString(), note: 'TC-dashboards-009 removed', deleted: true });
    created.delete('Sales Trends');
    await expect(d.tabs.locator('span.text-truncate')).toHaveText([...DEFAULT_TABS]);
  });

  test('TC-dashboards-011 add Sales Forecast then remove', async () => {
    await d.goto();
    test.skip(await d.tab('Sales Forecast').count() > 0, 'pre-existing Sales Forecast tab; not run-created');
    await d.addReportTab('Sales Forecast');
    created.add('Sales Forecast');
    recordEntity({ type: 'dashboard-tab', identifier: 'Sales Forecast', createdAt: new Date().toISOString(), note: 'TC-dashboards-011' });
    await expect(d.tab('Sales Forecast')).toBeVisible({ timeout: 30_000 });
    await d.removeRunCreatedTab('Sales Forecast');
    await expect(d.tab('Sales Forecast')).toHaveCount(0);
    recordEntity({ type: 'dashboard-tab', identifier: 'Sales Forecast', createdAt: new Date().toISOString(), note: 'TC-011 removed', deleted: true });
    created.delete('Sales Forecast');
  });

  test('TC-dashboards-021 default tabs remain after cleanup (post-condition only)', async () => {
    await d.goto();
    for (const t of DEFAULT_TABS) await expect(d.tab(t)).toHaveCount(1);
  });

  test.skip('TC-dashboards-012 custom dashboard from an Analytics report', async () => {
    // Skipped: no explored flow / Analytics report list UI unverified (see feedback file).
  });
});
