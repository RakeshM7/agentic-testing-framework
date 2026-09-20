import { defineConfig } from '@playwright/test';
import path from 'path';

// Credentials for the EventHub dogfood test account live in playwright-tests/.env
// (sibling project at the repo root), not duplicated here. The password in that file
// is intentionally double-quoted because it contains a trailing '#', which dotenv would
// otherwise treat as the start of a comment -- do not strip those quotes.
require('dotenv').config({ path: path.resolve(__dirname, '../../playwright-tests/.env') });

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
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
  projects: [
    {
      name: 'api',
      testMatch: /.*\.spec\.ts/,
    },
  ],
});
