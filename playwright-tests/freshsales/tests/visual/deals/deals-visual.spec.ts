import { test, expect } from '../../../pages/deals/fixture';

test.describe('Deals: visual regression', () => {
  test('Add deal slide-over (not saved)', async ({ page, dm }) => {
    await dm.gotoLayout('Pipeline');
    await dm.openAddDeal();
    await expect(dm.nameInput).toBeVisible();
    await page.waitForTimeout(800); // slide-over animation
    await expect(page.locator('.modal, [role="dialog"]').filter({ has: dm.nameInput }).last())
      .toHaveScreenshot('add-deal-slideover.png', { maxDiffPixelRatio: 0.03 });
  });
});
