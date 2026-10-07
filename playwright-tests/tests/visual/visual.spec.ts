import { test, expect } from '@playwright/test';
import { frameworkConfig } from '../../config/framework.config';

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
  // Committed baselines are macOS-only (*-darwin.png). On other OSes a missing baseline makes
  // toHaveScreenshot() fail, so skip unless baselines for this OS exist. To opt in elsewhere,
  // generate them (npm run test:visual:update, or the "Visual baselines (Linux)" workflow) and set RUN_VISUAL=1.
  test.skip(
    process.platform !== 'darwin' && !frameworkConfig.execution.runVisual,
    'Visual baselines are macOS-only; set RUN_VISUAL=1 after generating baselines for this OS.'
  );

  // The "chromium" project applies an authenticated storageState by default (see
  // playwright.config.ts). An authenticated visitor hitting /login is liable to be
  // redirected straight back into the app, so this test explicitly runs with a
  // clean, unauthenticated context to reliably capture the actual login page.
  test.describe('unauthenticated', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('Validate if Login page - loading the page in an unauthenticated context - matches the visual regression baseline', async ({ page }) => {
      // Step 1: Navigate to /login and verify the Sign In button is visible.
      await page.goto('/login');
      await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

      // Step 2: Take a full-page screenshot and compare against the golden baseline.
      await expect(page).toHaveScreenshot('login-page.png', {
        fullPage: true,
      });
    });

    // app-wide: /register is the other stable, unauthenticated, always-available page (form
    // shape + password-policy list are static content, no live/seat-count data to mask).
    test('Validate if Register page - loading the page in an unauthenticated context - matches the visual regression baseline', async ({ page }) => {
      // Step 1: Navigate to /register and verify the Create Account button is visible.
      await page.goto('/register');
      await expect(page.getByRole('button', { name: 'Create Account' })).toBeVisible();

      // Step 2: Take a full-page screenshot and compare against the golden baseline.
      await expect(page).toHaveScreenshot('register-page.png', {
        fullPage: true,
      });
    });
  });

  // app-wide: /bookings in its empty state for the suite's fixture account (zero bookings,
  // directly observed and stable — see tests/functional/my-bookings.spec.ts). Authenticated via
  // the default "chromium" project storageState.
  test('Validate if My Bookings page - loading the empty state for the fixture account - matches the visual regression baseline', async ({ page }) => {
    // Step 1: Navigate to /bookings and verify the "My Bookings" heading is visible.
    await page.goto('/bookings');
    await expect(page.getByRole('heading', { name: 'My Bookings' })).toBeVisible();

    // Step 2: Take a full-page screenshot and compare against the golden baseline.
    await expect(page).toHaveScreenshot('my-bookings-empty.png', {
      fullPage: true,
    });
  });

  test('Validate if Events Listing page - loading the page with all seeded events - matches the visual regression baseline', async ({ page }) => {
    // Step 1: Navigate to /events and verify the "Upcoming Events" heading is visible.
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: 'Upcoming Events' })).toBeVisible();

    // Step 2: Mask the dynamic "seats available" text, since other testers' live bookings can
    // change each event's count between exploration and any given run of this spec.
    // This is a live, shared third-party demo site: other testers' real bookings can
    // change each event's "seats available" count between exploration and any given
    // run of this spec. Mask that dynamic text so the visual diff isn't flaky on a
    // number that isn't a real regression.
    const seatCounts = page.getByText(/seats available/i);

    // Step 3: Take a full-page screenshot (with the seat counts masked) and compare against the
    // golden baseline.
    await expect(page).toHaveScreenshot('events-listing-page.png', {
      fullPage: true,
      mask: [seatCounts],
    });
  });
});
