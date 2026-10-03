import { test as base, APIRequestContext } from '@playwright/test';

/**
 * Code-level enforcement of `authorizations.mode` for the API suite. Without
 * `AUTHORIZATIONS_MODE=full-run` in the environment, any `request.post/put/patch/delete/fetch`
 * (non-GET) made through a `guardedTest` throws before leaving the machine:
 *
 *   AUTHORIZATIONS_MODE=full-run npx playwright test
 *
 * See docs/conventions.md, "Standing safety guardrails".
 */
export const MUTATIONS_ALLOWED = process.env.AUTHORIZATIONS_MODE === 'full-run';

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function refuse(what: string): never {
  throw new Error(
    `[mutation-guard] ${what} blocked: authorizations.mode is not full-run. ` +
      'Set AUTHORIZATIONS_MODE=full-run only for a target you are authorized to mutate.'
  );
}

export function guardRequest(request: APIRequestContext): APIRequestContext {
  return new Proxy(request, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      if (typeof prop === 'string' && MUTATING.has(prop)) {
        return (url: string) => refuse(`${prop.toUpperCase()} ${url}`);
      }
      if (prop === 'fetch') {
        return (urlOrRequest: any, options?: { method?: string }) => {
          const method = (options?.method ?? 'GET').toUpperCase();
          if (!SAFE_METHODS.has(method)) refuse(`${method} ${String(urlOrRequest)}`);
          return value.call(target, urlOrRequest, options);
        };
      }
      return value.bind(target);
    },
  });
}

export const guardedTest = base.extend({
  request: async ({ request }, use) => {
    await use(MUTATIONS_ALLOWED ? request : guardRequest(request));
  },
});
