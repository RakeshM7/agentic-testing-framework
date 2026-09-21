import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import 'dotenv/config';

const AUTH_FILE = path.join(__dirname, '.auth', 'user.json');

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
      slowMo: 1000,
    },
    headless: false,
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE,
      },
      dependencies: ['setup'],
    },
  ],
});
