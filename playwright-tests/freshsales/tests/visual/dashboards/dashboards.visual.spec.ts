import { test, expect } from '@playwright/test';
import { DashboardsPage } from '../../../pages/dashboards/DashboardsPage';

test.describe('Dashboards visual', () => {
  test('Activities Dashboard Configure widgets drawer', async ({ page }) => {
    const d = new DashboardsPage(page);
    await d.goto('activities');
    await d.openConfigure();
    const drawer = page.locator('[data-test-visible-col]').first().locator('xpath=ancestor::*[contains(@class,"drawer") or contains(@class,"modal") or contains(@class,"slide")][1]');
    await expect(drawer).toHaveScreenshot('configure-widgets-drawer.png', { animations: 'disabled' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  });

  test('Dashboard tab row', async ({ page }) => {
    const d = new DashboardsPage(page);
    await d.goto('353503');
    await expect(d.tabs.first().locator('xpath=..')).toHaveScreenshot('tab-row.png', { animations: 'disabled' });
  });
});
