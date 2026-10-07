import { defineConfig, devices } from '@playwright/test';
import { frameworkConfig } from './config/framework.config';

const { urls, timeouts, browser, execution, auth } = frameworkConfig;
const IS_CI = execution.isCI;

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: IS_CI,
  retries: IS_CI ? Math.max(execution.retries, 2) : execution.retries,
  workers: execution.workers > 0 ? execution.workers : undefined,

  reporter: IS_CI
    ? [
        ['github'],
        ['html', { open: 'never' }],
        ['junit', { outputFile: 'test-results/junit.xml' }],
      ]
    : [['list'], ['html', { open: 'never' }]],

  // Global values are configured once and inherited by every test/page/API module.
  timeout: timeouts.test,
  expect: {
    timeout: timeouts.expect,
  },

  use: {
    baseURL: urls.eventHub,
    actionTimeout: timeouts.action,
    navigationTimeout: timeouts.navigation,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      slowMo: browser.slowMo,
    },
    headless: !browser.headed,
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
        storageState: auth.eventHubStateFile,
      },
      testIgnore: [/freshsales/],
      dependencies: ['setup-eventhub'],
    },
    {
      name: 'setup-freshsales',
      use: { baseURL: urls.freshsales },
      testMatch: /auth\.freshsales\.setup\.ts/,
    },
    {
      name: 'freshsales',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: urls.freshsales,
        storageState: auth.freshsalesStateFile,
      },
      testMatch: [
        /tests[\\/]functional[\\/]freshsales[\\/]/,
        /tests[\\/]visual[\\/]freshsales[\\/]/,
      ],
      testIgnore: [/\.unauth\.spec\.ts$/],
      dependencies: ['setup-freshsales'],
    },
    {
      name: 'freshsales-unauth',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: urls.freshsales,
        storageState: { cookies: [], origins: [] },
      },
      testMatch: [/\.unauth\.spec\.ts$/],
    },
    {
      name: 'freshsales-help',
      use: {
        ...devices['Desktop Chrome'],
        baseURL: urls.freshsalesHelp,
        storageState: { cookies: [], origins: [] },
        headless: true,
        launchOptions: { slowMo: 0 },
      },
      testMatch: [/tests[\\/]functional[\\/]freshsales-help[\\/]/],
    },
  ],
});
