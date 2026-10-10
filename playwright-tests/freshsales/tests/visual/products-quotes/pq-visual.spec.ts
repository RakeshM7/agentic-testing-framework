import { test, expect, TEMPLATES_URL, CPQ_URL } from '../../../pages/products-quotes/PQ';

/** Visual baselines (read-only pages). Trial banner, header and the tenant-wide toasts are masked: they change daily. */
test.describe('Products and Quotes: visual', () => {
  test.setTimeout(120_000);
  const mask = (page: import('@playwright/test').Page) => [
    page.locator('.navbar, header, [class*="trial"], .announcement-bar, .top-banner').first(),
    page.getByText(/Your account will be renewed|Your trial ends/).first(),
  ];

  test('Document Templates list matches baseline', async ({ page, pq }) => {
    await pq.gotoTemplates();
    await expect(pq.templateRow('Sample Template').first()).toBeVisible();
    await expect(page).toHaveScreenshot('document-templates.png', { mask: mask(page), maxDiffPixelRatio: 0.03, fullPage: false });
  });

  test('CPQ Settings (pricing) matches baseline', async ({ page, pq }) => {
    await page.goto(CPQ_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Pricing settings').first()).toBeVisible({ timeout: 30_000 });
    await pq.dismissNoise();
    await page.waitForTimeout(1500);
    await expect(page).toHaveScreenshot('cpq-settings.png', { mask: mask(page), maxDiffPixelRatio: 0.03 });
  });
});
