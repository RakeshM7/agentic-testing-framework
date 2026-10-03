import { test as base } from '@playwright/test';

/**
 * Code-level enforcement of `authorizations.mode` (docs/conventions.md, "Standing safety
 * guardrails"). Without `AUTHORIZATIONS_MODE=full-run` in the environment, every non-GET/HEAD/OPTIONS
 * browser request made through a `guardedTest` context is aborted -- so a direct `npx playwright test`
 * can't mutate a live target no matter what a spec does. A human opts in per run:
 *
 *   AUTHORIZATIONS_MODE=full-run npx playwright test
 *
 * The auth setup projects deliberately use the plain `@playwright/test` `test` (they must POST a
 * login to produce storageState) and are therefore not guarded.
 */
export const MUTATIONS_ALLOWED = process.env.AUTHORIZATIONS_MODE === 'full-run';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const guardedTest = base.extend({
  context: async ({ context }, use) => {
    if (!MUTATIONS_ALLOWED) {
      await context.route('**/*', async (route) => {
        if (SAFE_METHODS.has(route.request().method())) {
          await route.fallback();
        } else {
          console.warn(
            `[mutation-guard] blocked ${route.request().method()} ${route.request().url()} ` +
              '(set AUTHORIZATIONS_MODE=full-run to allow)'
          );
          await route.abort('blockedbyclient');
        }
      });
    }
    await use(context);
  },
});
