import { Page } from '@playwright/test';

/**
 * Safety net for negative/validation specs that click "Confirm Booking" on
 * purpose (expecting the app to block submission). The exact booking-creation
 * endpoint on api.eventhub.rahulshettyacademy.com was never confirmed during
 * exploration (see clarifications doc "Open questions"), so rather than guess
 * a URL to allow/block, this aborts every non-GET request to the API host for
 * the lifetime of the page. If client-side validation is genuinely blocking
 * submission (the assumption these specs verify), no request is ever attempted
 * and this is a no-op. If it turns out validation does NOT block submission,
 * this guard prevents the request from ever reaching the live backend instead
 * of silently creating a real booking on a third-party demo site.
 */
export async function blockLiveBookingMutations(page: Page) {
  await page.route('**://api.eventhub.rahulshettyacademy.com/**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.continue();
    } else {
      await route.abort('failed');
    }
  });
}

/**
 * Same guard as {@link blockLiveBookingMutations}, exposed under a feature-neutral name for the
 * app-wide suite's negative specs (registration/login validation) that intentionally submit
 * invalid data expecting client-side validation to block it. Verified live (see
 * playwright-automation-agent's dev notes): submitting an invalid registration/login form makes
 * zero requests to `/api/auth/register` or `/api/auth/login` — this guard is defense-in-depth for
 * if that assumption is ever wrong, not a workaround for a known gap.
 */
export const blockLiveApiMutations = blockLiveBookingMutations;
