import { Locator, Page } from '@playwright/test';
import { timeouts } from '../config/timeouts';

export type UrlMatcher = string | RegExp | ((url: URL) => boolean);

export class WaitHelper {
  /**
   * Wait for URL changes using the centralized navigation timeout.
   * Use this instead of repeating literal timeout values throughout tests.
   */
  async forUrl(page: Page, matcher: UrlMatcher, timeout = timeouts.navigation): Promise<void> {
    await page.waitForURL(matcher, { timeout });
  }

  async forVisible(locator: Locator, timeout = timeouts.action): Promise<void> {
    await locator.waitFor({ state: 'visible', timeout });
  }

  async forHidden(locator: Locator, timeout = timeouts.action): Promise<void> {
    await locator.waitFor({ state: 'hidden', timeout });
  }

  async forLoadState(
    page: Page,
    state: 'load' | 'domcontentloaded' | 'networkidle' = 'load',
    timeout = timeouts.navigation
  ): Promise<void> {
    await page.waitForLoadState(state, { timeout });
  }

  /**
   * Explicit sleeps should be rare. Prefer Playwright's auto-waiting and
   * condition-based waits. If a real application requirement needs a pause,
   * the duration is still configurable through PW_EXPLICIT_WAIT_MS.
   */
  async delay(milliseconds = timeouts.explicitWait): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}

export const waits = new WaitHelper();
