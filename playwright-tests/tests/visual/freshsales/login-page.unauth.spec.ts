import { test, expect } from '@playwright/test';

/**
 * Visual-regression coverage for the Freshsales tenant's login page — the one page in this
 * target reachable without an authenticated session (see README.md "Known blocker": every other
 * page in this CRM requires a session, and this run's scripted login attempts were reproducibly
 * blocked by a reCAPTCHA challenge). Runs under the 'freshsales-unauth' project (no dependency on
 * 'setup-freshsales' — see playwright.config.ts), so it executes for real regardless of that
 * blocker.
 *
 * Baseline generated fresh inside this project (never from explore-agent's crawl screenshots,
 * which use a different render pipeline) via `npm run test:visual:update` — see README.md.
 */
test.describe('visual regression @freshsales', () => {
  test('Validate if Freshsales login page - loading the page in an unauthenticated context - matches the visual regression baseline', async ({
    page,
  }) => {
    // Step 1: Navigate to the tenant root, which redirects to /login for an unauthenticated visitor.
    // This tenant's login page briefly renders a loading spinner before settling on the actual
    // form (observed directly during this run's discovery — see README.md "Known blocker"), so
    // this waits for network idle in addition to the Sign in button becoming visible, to avoid
    // racing a screenshot against that transient state.
    await page.goto('/');
    await page.waitForURL(/\/login/, { timeout: 15_000 });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('#username')).toBeVisible();

    // Step 2: Take a viewport-only screenshot and compare against the golden baseline.
    // fullPage was tried first but proved flaky here: Google's injected reCAPTCHA badge/script on
    // this login page can affect the page's full scrollable width non-deterministically between
    // runs (observed full-page captures ranging from 1265px to 1501px wide across otherwise
    // identical runs), which a viewport-clipped screenshot of the static login form avoids. The
    // reCAPTCHA badge in the corner is masked too, since Google can rotate its rendering
    // (icon/animation state) independently of any real regression in this app's own login page.
    await expect(page).toHaveScreenshot('freshsales-login-page.png', {
      fullPage: false,
      mask: [page.locator('.grecaptcha-badge')],
    });
  });
});
