import { test, expect } from '../../../fixtures/base';
import { SequencesPage } from '../../../pages/sales-sequences/SequencesPage';

test.describe('Sales Sequences - visual', () => {
  test('Create sequence page (configuration sections) baseline @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoNew();
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot('sequence-new.png', {
      clip: { x: 64, y: 96, width: 1030, height: 700 },
      mask: [page.locator('input'), page.locator('.date-time-input')],
      animations: 'disabled',
      maxDiffPixelRatio: 0.05,
    });
  });
});
