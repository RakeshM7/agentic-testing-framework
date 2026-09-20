import { test, expect } from '@playwright/test';

/**
 * Visual-regression coverage. Baselines are generated fresh inside this
 * project (never taken from explore-agent's crawl screenshots, which use a
 * different render pipeline) via:
 *   npm run test:visual:update
 * on first run; the resulting PNGs under tests/visual/*-snapshots/ are the
 * true golden baselines going forward and should be committed.
 *
 * Login is the only unauthenticated, always-available, stable-content page
 * discovered by explore-agent (chosen for visual coverage since it renders
 * without depending on the shared account's live seat-count state). The
 * events listing is covered too since it's the richest, most regression-prone
 * surface (card grid + filters) and its 3 seeded fixture events are stable
 * "Featured"/"Read-only" data, per the clarifications doc.
 */

test.describe('visual regression @visual', () => {
  // The "chromium" project applies an authenticated storageState by default (see
  // playwright.config.ts). An authenticated visitor hitting /login is liable to be
  // redirected straight back into the app, so this test explicitly runs with a
  // clean, unauthenticated context to reliably capture the actual login page.
  test.describe('unauthenticated', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('login page', async ({ page }) => {
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

      await expect(page).toHaveScreenshot('login-page.png', {
        fullPage: true,
      });
    });
  });

  test('events listing page', async ({ page }) => {
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Upcoming Events' })).toBeVisible();

    // This is a live, shared third-party demo site: other testers' real bookings can
    // change each event's "seats available" count between exploration and any given
    // run of this spec. Mask that dynamic text so the visual diff isn't flaky on a
    // number that isn't a real regression.
    const seatCounts = page.getByText(/seats available/i);

    await expect(page).toHaveScreenshot('events-listing-page.png', {
      fullPage: true,
      mask: [seatCounts],
    });
  });
});
