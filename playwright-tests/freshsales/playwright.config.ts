import { defineConfig, devices } from '@playwright/test';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '.env.freshsales') });

const BASE_URL = (process.env.FRESHSALES_URL || 'https://rakesh-freshsales-ind-sep21.myfreshworks.com').replace(/\/+$/, '');

// Scripted login is CAPTCHA-gated, so the suite reuses a pre-captured session instead of a setup project
// (authorizations.session_state_file).
const SESSION_STATE = path.join(__dirname, '.auth', 'freshsales-handoff.json');

export default defineConfig({
  testDir: './tests',
  // Tests share one live tenant and the lead-to-deal flow is an ordered chain: run serially.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000, toHaveScreenshot: { maxDiffPixelRatio: 0.02 } },
  use: {
    baseURL: BASE_URL,
    storageState: SESSION_STATE,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    headless: !process.env.HEADED,
  },
  projects: [{ name: 'freshsales', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
