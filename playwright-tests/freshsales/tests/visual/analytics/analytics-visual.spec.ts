import { test, expect } from '@playwright/test';
import { AnalyticsPage } from '../../../pages/analytics/AnalyticsPage';

test.describe('Analytics: visual regression', () => {
  test('curated Sales Dashboard report view', async ({ page }) => {
    const a = new AnalyticsPage(page);
    await a.gotoPath('/reports/MTg4NDE=/page/1');
    await expect(a.f.getByRole('heading', { name: 'Quota vs achievement' })).toBeVisible({ timeout: 30_000 });
    await expect(a.f.getByText('No data!')).toBeVisible();
    await page.waitForTimeout(2000); // chart entry animations
    // charts hold live tenant data; baseline the stable report header (title, Curated badge, Export/Edit)
    await expect(a.f.locator('h2').filter({ hasText: 'Sales Dashboard' })).toHaveScreenshot('sales-dashboard-header.png', { maxDiffPixelRatio: 0.03 });
  });

  test('Settings custom attributes empty state', async ({ page }) => {
    const a = new AnalyticsPage(page);
    await a.gotoPath('/settings/custom-attributes');
    await expect(a.f.getByText("You haven't configured any custom attributes.")).toBeVisible({ timeout: 30_000 });
    await expect(a.f.locator('body')).toHaveScreenshot('custom-attributes-empty.png', {
      mask: [], maxDiffPixelRatio: 0.03,
    });
  });
});
