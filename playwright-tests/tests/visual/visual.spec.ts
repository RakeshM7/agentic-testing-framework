import { test, expect } from '@playwright/test';

/**
 * Visual-regression coverage. Baselines are generated fresh inside this
 * project (never taken from explore-agent's crawl screenshots, which use a
 * different render pipeline) via:
 *   npm run test:visual:update
 * on first run; the resulting PNGs under tests/visual/*-snapshots/ are the
 * true golden baselines going forward and should be committed.
 *
 * Login and Register are the two unauthenticated, always-available, stable-content pages
 * discovered by explore-agent (chosen for visual coverage since they render without depending on
 * the shared account's live seat-count state). The events listing is covered too since it's the
 * richest, most regression-prone surface (card grid + filters) and its 3 seeded fixture events
 * are stable "Featured"/"Read-only" data, per the clarifications doc. My Bookings' empty state is
 * covered as the app-wide suite's key authenticated page — stable because the fixture account has
 * zero bookings (directly observed, not expected to change since no booking is ever completed
 * live by this suite).
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

    // app-wide: /register is the other stable, unauthenticated, always-available page (form
    // shape + password-policy list are static content, no live/seat-count data to mask).
    test('register page', async ({ page }) => {
      await page.goto('/register');
      await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();

      await expect(page).toHaveScreenshot('register-page.png', {
        fullPage: true,
      });
    });
  });

  // app-wide: /bookings in its empty state for the suite's fixture account (zero bookings,
  // directly observed and stable — see tests/functional/my-bookings.spec.ts). Authenticated via
  // the default "chromium" project storageState.
  test('my bookings page (empty state)', async ({ page }) => {
    await page.goto('/bookings');
    await expect(page.getByRole('heading', { name: 'My Bookings' })).toBeVisible();

    await expect(page).toHaveScreenshot('my-bookings-empty.png', {
      fullPage: true,
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
