import { defineConfig } from '@playwright/test';
import * as dotenv from 'dotenv';
import path from 'node:path';

// Values come from .env (never hard-coded): BASE_URL, API_BASE_URL, STORAGE_STATE, ATF_* (see .env.example).
dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

// ATF_MODE is set by the runner from the run's state/run.json; anything but full-run is readonly.
const fullRun = process.env.ATF_MODE === 'full-run';

export default defineConfig({
  timeout: {{testTimeoutMs}},
  expect: { timeout: {{expectTimeoutMs}} },
  fullyParallel: {{fullyParallel}},
  workers: {{workers}},
  retries: {{retries}},
  // The framework's runner passes its own --reporter; anywhere else (CI, D-080) a JSON and a JUnit report are written too.
  reporter: [['list'], ['json', { outputFile: 'test-results/report.json' }], ['junit', { outputFile: 'test-results/junit.xml' }]],
  // A test that creates, changes or deletes data carries @mutates in its title and runs only in full-run.
  grepInvert: fullRun ? undefined : /@mutates/,
  use: {
    baseURL: process.env.BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'setup-ui', testDir: './fixtures/ui', testMatch: /.*\.setup\.ts/ },
    {
      name: 'ui',
      testDir: './tests/ui',
      dependencies: ['setup-ui'],
      outputDir: './test-results/ui',
      use: { storageState: path.resolve(__dirname, '.auth', 'ui.json') },
    },
    { name: 'setup-api', testDir: './fixtures/api', testMatch: /.*\.setup\.ts/ },
    {
      name: 'api',
      testDir: './tests/api',
      dependencies: ['setup-api'],
      outputDir: './test-results/api',
    },
  ],
});
