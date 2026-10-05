import { test, expect } from '@playwright/test';
import { ActivitiesPage } from '../../../pages/sales-activities/ActivitiesPage';

test.describe('Sales activities: visual baselines', () => {
  test('Sales Activities settings page', async ({ page }) => {
    const a = new ActivitiesPage(page);
    await a.gotoTypes();
    await expect(page.getByRole('heading', { name: 'Default sales activities', level: 4 })).toBeVisible();
    await expect(page.locator('main, #ember-app, body').first().locator('table').first()).toHaveScreenshot('default-activity-types-table.png');
  });

  test('Add task dialog', async ({ page }) => {
    const a = new ActivitiesPage(page);
    await a.gotoDashboard();
    await a.openAddTask();
    // Date/time fields are dynamic; mask them.
    await expect(a.dialog).toHaveScreenshot('add-task-dialog.png', {
      mask: [a.dialog.getByRole('textbox').filter({ hasText: /^$/ }).and(a.dialog.locator('input'))],
      maxDiffPixelRatio: 0.05,
    });
  });
});
