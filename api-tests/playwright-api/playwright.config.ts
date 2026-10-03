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

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    // API host, NOT the frontend host -- this suite talks to the REST API directly.
    baseURL: 'https://api.eventhub.rahulshettyacademy.com/api',
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
        baseURL: 'https://rakesh-freshsales-ind-sep21.myfreshworks.com',
        extraHTTPHeaders: {
          Accept: 'application/json',
        },
      },
      testMatch: [/tests[\\/]freshsales[\\/]/],
    },
  ],
});
