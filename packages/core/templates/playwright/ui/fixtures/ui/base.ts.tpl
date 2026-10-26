// The UI side's base fixtures. fixtures/ui/index.ts (hand-written) builds the page-object fixtures on this `test`;
// never build UI tests on @playwright/test directly, or the mutation guard is lost.
import { test as base, expect, type Page } from '@playwright/test';
import { uiSettings } from '../../config/ui/settings';
import { destructiveRefusal } from '../../utils/shared/ledger';

// The only methods a readonly run may send to the product's hosts.
export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

// The product's hosts (D-073): the run-config's target.url and target.api_urls hosts rendered into the UI settings, plus
// those of BASE_URL and API_BASE_URL; a subdomain of one is the product's too.
function productHosts(): string[] {
  const hosts = new Set(uiSettings.productHosts.map((h) => h.toLowerCase()));
  for (const value of [process.env.BASE_URL, process.env.API_BASE_URL]) {
    if (!value) continue;
    try {
      hosts.add(new URL(value).hostname.toLowerCase());
    } catch {
      // an unparsable value matches nothing; with no host at all every non-safe request is aborted below
    }
  }
  return [...hosts];
}
const isProductHost = (host: string, hosts: string[]): boolean => hosts.length === 0 || hosts.some((h) => host === h || host.endsWith(`.${h}`));

// Waits until the product's loading indicator (config/ui/settings.ts) is gone; returns at once when none is known.
export async function waitForReady(page: Page): Promise<void> {
  const indicator = uiSettings.loadingIndicator;
  if (indicator) await expect(page.getByRole(indicator.role, { name: indicator.name, exact: true })).toHaveCount(0);
}

export const test = base.extend<{ mutationGuard: void }>({
  mutationGuard: [
    async ({ page }, use) => {
      // Readonly: no non-safe request reaches the product. Full-run: a destructive one only for an entity this run created
      // (D-074); a refused one fails the test when it ends, naming the request.
      const hosts = productHosts();
      const refused: string[] = [];
      await page.route('**/*', (route) => {
        const request = route.request();
        const method = request.method().toUpperCase();
        if (SAFE_METHODS.includes(method) || !isProductHost(new URL(request.url()).hostname.toLowerCase(), hosts)) return route.fallback();
        if (process.env.ATF_MODE !== 'full-run') return route.abort('blockedbyclient');
        const why = destructiveRefusal(method, request.url());
        if (!why) return route.fallback();
        refused.push(why);
        return route.abort('blockedbyclient');
      });
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
      if (refused.length) throw new Error(refused[0] + (refused.length > 1 ? ` (${refused.length - 1} more destructive request(s) refused)` : ''));
    },
    { auto: true },
  ],
});

export { expect };
