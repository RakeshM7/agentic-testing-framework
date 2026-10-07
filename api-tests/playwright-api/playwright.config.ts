import { defineConfig } from '@playwright/test';
import path from 'path';

// Credentials for the EventHub dogfood test account live in playwright-tests/.env
// (sibling project at the repo root), not duplicated here. The password in that file
// is intentionally double-quoted because it contains a trailing '#', which dotenv would
// otherwise treat as the start of a comment -- do not strip those quotes.
require('dotenv').config({ path: path.resolve(__dirname, '../../playwright-tests/.env') });

// Freshsales credentials/session data live in their own file, separate from the root .env
// (which holds EVENTHUB_* for the other target project below), loaded explicitly so the two
// targets' env vars never collide under the same key names. FRESHSALES_SESSION_COOKIE is an
// operator-supplied value (not produced by this suite) -- see
// fixtures/freshsales-api-fixtures.ts and README.md for why.
require('dotenv').config({ path: path.resolve(__dirname, '../../playwright-tests/.env.freshsales') });

// Environment-driven targets (defaults preserve the original behaviour):
//   EVENTHUB_API_URL     EventHub REST API base (including the /api prefix)
//   FRESHSALES_BASE_URL  Freshsales tenant origin
// NOTE: the trailing slash is deliberate and required. Playwright resolves request paths with
// `new URL(path, baseURL)`; without it, `request.get('/health')` would drop the `/api` segment and
// hit `<host>/health`. EventHub tests therefore use *relative* paths (`request.get('health')`).
const EVENTHUB_API_URL = (process.env.EVENTHUB_API_URL ?? 'https://api.eventhub.rahulshettyacademy.com/api').replace(/\/*$/, '/');
const FRESHSALES_BASE_URL =
  process.env.FRESHSALES_BASE_URL ?? 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';
const IS_CI = !!process.env.CI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? 1 : 0,
  workers: IS_CI ? 2 : undefined,
  reporter: IS_CI
    ? [['github'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    // API host, NOT the frontend host -- this suite talks to the REST API directly.
    baseURL: EVENTHUB_API_URL,
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    trace: 'on-first-retry',
  },
  // This project now covers two independent targets (EventHub, the original target this project
  // was scaffolded for, and Freshsales, added by the lead-to-deal-pipeline run). Each gets its own
  // baseURL and is scoped by testMatch/testIgnore so neither target's tests run under the other's
  // baseURL -- mirroring the pattern already established in playwright-tests/playwright.config.ts.
  projects: [
    {
      name: 'api',
      testMatch: /.*\.spec\.ts/,
      testIgnore: [/freshsales/],
    },
    {
      name: 'freshsales-api',
      use: {
        baseURL: FRESHSALES_BASE_URL,
        extraHTTPHeaders: {
          Accept: 'application/json',
        },
      },
      testMatch: [/tests[\\/]freshsales[\\/]/],
    },
  ],
});
