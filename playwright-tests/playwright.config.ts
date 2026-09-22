import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import 'dotenv/config';

const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');
const FRESHSALES_AUTH_FILE = path.join(__dirname, '.auth', 'freshsales-user.json');

// This project now covers two independent targets (EventHub, the original target this project
// was scaffolded for, and Freshsales — see README.md "Multi-target structure"). Each target gets
// its own setup project (own login flow, own storageState file) and its own chromium project
// (own baseURL), scoped by testMatch/testIgnore so neither target's tests run under the other's
// session/baseURL.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'https://eventhub.rahulshettyacademy.com',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
    launchOptions: {
      slowMo: 500,
    },
    headless: false,
  },
  projects: [
    {
      name: 'setup-eventhub',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
      },
      testIgnore: [/freshsales/],
      dependencies: ['setup-eventhub'],
    },
    {
      name: 'setup-freshsales',
      testMatch: /auth\.freshsales\.setup\.ts/,
    },
    {
      name: 'freshsales',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'https://rakesh-freshsales-ind-sep21.myfreshworks.com',
        storageState: FRESHSALES_AUTH_FILE,
      },
      // *.unauth.spec.ts files (e.g. the /login visual baseline, which is reachable without a
      // session) run under 'freshsales-unauth' instead — see that project below — so they aren't
      // skipped if setup-freshsales fails (Playwright skips a whole dependent project when its
      // dependency fails, not just the tests that actually needed the session).
      testMatch: [/tests[\\/]functional[\\/]freshsales[\\/]/, /tests[\\/]visual[\\/]freshsales[\\/]/],
      testIgnore: [/\.unauth\.spec\.ts$/],
      dependencies: ['setup-freshsales'],
    },
    {
      name: 'freshsales-unauth',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: 'https://rakesh-freshsales-ind-sep21.myfreshworks.com',
        storageState: { cookies: [], origins: [] },
      },
      testMatch: [/\.unauth\.spec\.ts$/],
      // No dependency on setup-freshsales: these specs are the ones this suite can still run for
      // real even when live login is blocked (see README's "Known blocker" section).
    },
  ],
});
