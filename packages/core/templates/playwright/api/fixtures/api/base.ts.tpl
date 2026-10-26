// The API side's base fixtures. fixtures/api/index.ts (hand-written) builds the client fixtures on this `test`; never
// build API tests on @playwright/test's own `request`, or the readonly guard is lost.
import { test as base, expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';
import * as dotenv from 'dotenv';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { apiSettings, type AuthScheme } from '../../config/api/settings';

// The only methods a readonly run may send.
export const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

const AUTH_STATE = path.resolve(__dirname, '..', '..', '.auth', 'api.json');
const REPO_ROOT = process.env.ATF_REPO_ROOT || path.resolve(__dirname, '..', '..', '..', '..');
const fromRepo = (file: string): string => (path.isAbsolute(file) ? file : path.resolve(REPO_ROOT, file));

type Vars = Record<string, string | undefined>;
type FetchArgs = Parameters<APIRequestContext['fetch']>;

// Outside full-run, every call with a method other than GET, HEAD or OPTIONS throws instead of reaching the product.
export function guarded(ctx: APIRequestContext): APIRequestContext {
  if (process.env.ATF_MODE === 'full-run') return ctx;
  const blocked = (method: string) => Promise.reject(new Error(`Mutation blocked: readonly run (${method} is sent only in full-run)`));
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'post' || prop === 'put' || prop === 'patch' || prop === 'delete') return () => blocked(String(prop).toUpperCase());
      if (prop === 'fetch')
        return (urlOrRequest: FetchArgs[0], options?: FetchArgs[1]) => {
          const method = String(options?.method ?? (typeof urlOrRequest === 'string' ? 'GET' : urlOrRequest.method())).toUpperCase();
          return SAFE_METHODS.includes(method) ? target.fetch(urlOrRequest, options) : blocked(method);
        };
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// The auth headers of the configured scheme, from variables named in config/api/settings.ts (never values in code).
export function authHeaders(vars: Vars): Record<string, string> {
  const auth = apiSettings.auth;
  const value = auth.env ? vars[auth.env] : undefined;
  switch (auth.scheme) {
    case 'bearer':
    case 'oauth2':
      return value ? { [auth.header ?? 'Authorization']: `${auth.prefix}${value}` } : {};
    case 'api-key':
      return value && auth.header ? { [auth.header]: `${auth.prefix}${value}` } : {};
    case 'basic': {
      const user = vars.API_USERNAME;
      const pass = vars.API_PASSWORD;
      return user && pass ? { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` } : {};
    }
    default:
      return {};
  }
}

// A syntactically wrong credential for the scheme, for the plan's authentication scenarios.
function malformedHeaders(scheme: AuthScheme): Record<string, string> {
  const junk = `malformed-${Date.now().toString(36)}`;
  switch (scheme) {
    case 'bearer':
    case 'oauth2':
      return { [apiSettings.auth.header ?? 'Authorization']: `${apiSettings.auth.prefix || 'Bearer '}${junk}` };
    case 'api-key':
      return { [apiSettings.auth.header ?? 'X-API-Key']: junk };
    case 'basic':
      return { Authorization: `Basic ${Buffer.from(junk).toString('base64')}` };
    case 'session':
      return { Cookie: `${apiSettings.auth.cookie ?? 'session'}=${junk}` };
    default:
      return { Authorization: junk };
  }
}

async function newContext(headers: Record<string, string>, storageState?: string): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: process.env.API_BASE_URL || process.env.BASE_URL,
    extraHTTPHeaders: { ...apiSettings.defaultHeaders, ...headers },
    storageState,
    timeout: apiSettings.timeoutMs,
  });
}

type ApiFixtures = {
  api: APIRequestContext;
  noAuth: APIRequestContext;
  malformedAuth: (scheme?: AuthScheme) => Promise<APIRequestContext>;
  identity: (name: string) => Promise<APIRequestContext>;
};

export const test = base.extend<ApiFixtures>({
  // The run's own session, guarded.
  api: async ({}, use) => {
    const session = apiSettings.auth.scheme === 'session' && existsSync(AUTH_STATE) ? AUTH_STATE : undefined;
    const ctx = await newContext(authHeaders(process.env), session);
    await use(guarded(ctx));
    await ctx.dispose();
  },
  // No credentials at all, guarded.
  noAuth: async ({}, use) => {
    const ctx = await newContext({});
    await use(guarded(ctx));
    await ctx.dispose();
  },
  // A malformed credential of the scheme (default: the configured one), guarded.
  malformedAuth: async ({}, use) => {
    const made: APIRequestContext[] = [];
    await use(async (scheme: AuthScheme = apiSettings.auth.scheme) => {
      const ctx = await newContext(malformedHeaders(scheme));
      made.push(ctx);
      return guarded(ctx);
    });
    for (const ctx of made) await ctx.dispose();
  },
  // Another configured identity (authorizations.identities, by file path), guarded; skips the test when that identity
  // or its file is missing.
  identity: async ({}, use, testInfo) => {
    const made: APIRequestContext[] = [];
    await use(async (name: string) => {
      const who = apiSettings.identities.find((i) => i.name === name);
      const skip = (why: string): never => {
        testInfo.skip(true, `identity '${name}': ${why}`);
        throw new Error(`identity '${name}': ${why}`);
      };
      if (!who) return skip('not configured in the run-config (authorizations.identities)');
      const state = who.sessionStateFile ? fromRepo(who.sessionStateFile) : undefined;
      if (state && !existsSync(state)) return skip(`its session_state_file ${who.sessionStateFile} does not exist`);
      const credentials = who.credentialsFile ? fromRepo(who.credentialsFile) : undefined;
      if (credentials && !existsSync(credentials)) return skip(`its credentials_file ${who.credentialsFile} does not exist`);
      const vars: Vars = credentials ? dotenv.parse(readFileSync(credentials)) : {};
      const ctx = await newContext(authHeaders(vars), state);
      made.push(ctx);
      return guarded(ctx);
    });
    for (const ctx of made) await ctx.dispose();
  },
});

export { expect };
