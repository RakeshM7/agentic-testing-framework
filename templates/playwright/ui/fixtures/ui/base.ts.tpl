// The UI side's base fixtures. fixtures/ui/index.ts (hand-written) builds the page-object fixtures on this `test`;
// never build UI tests on @playwright/test directly, or the mutation guard is lost.
import { test as base, expect, type Page } from '@playwright/test';
import { uiSettings } from '../../config/ui/settings';

// The only methods a readonly run may send to the product's hosts.
export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

function productHosts(): string[] {
  const hosts: string[] = [];
  for (const value of [process.env.BASE_URL, process.env.API_BASE_URL]) {
    if (!value) continue;
    try {
      hosts.push(new URL(value).host.toLowerCase());
    } catch {
      // an unparsable value matches nothing; with no host at all every non-safe request is aborted below
    }
  }
  return hosts;
}

// Waits until the product's loading indicator (config/ui/settings.ts) is gone; returns at once when none is known.
export async function waitForReady(page: Page): Promise<void> {
  const indicator = uiSettings.loadingIndicator;
  if (indicator) await expect(page.getByRole(indicator.role, { name: indicator.name, exact: true })).toHaveCount(0);
}

export const test = base.extend<{ mutationGuard: void }>({
  mutationGuard: [
    async ({ page }, use) => {
      if (process.env.ATF_MODE !== 'full-run') {
        const hosts = productHosts();
        await page.route('**/*', (route) => {
          const request = route.request();
          const host = new URL(request.url()).host.toLowerCase();
          const toProduct = hosts.length === 0 || hosts.includes(host);
          if (toProduct && !SAFE_METHODS.includes(request.method().toUpperCase())) return route.abort('blockedbyclient');
          return route.fallback();
        });
      }
      const banner = uiSettings.cookieBanner;
      if (banner) {
        const accept = page.getByRole(banner.role, { name: banner.name, exact: true });
        await page.addLocatorHandler(accept, async () => {
          await accept.click();
        });
      }
      page.setDefaultTimeout(uiSettings.actionTimeoutMs);
      page.setDefaultNavigationTimeout(uiSettings.navigationTimeoutMs);
      await page.setViewportSize(uiSettings.viewport);
      await use();
    },
    { auto: true },
  ],
});

export { expect };
