import path from 'path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';
import { atfMode, optional, storageStatePath } from './utils/shared/env';

// Load .env before reading any value (the runner's environment wins over the file). The env accessors read
// process.env lazily, so the import order above does not matter.
dotenv.config({ path: path.resolve(__dirname, '.env') });

const BASE_URL = optional('BASE_URL');
const API_BASE_URL = optional('API_BASE_URL') ?? BASE_URL;
const STORAGE_STATE = storageStatePath();

// Safety: tests tagged @mutates run only when the run mode is explicitly full-run.
const grepInvert = atfMode() === 'full-run' ? undefined : /@mutates/;

export default defineConfig({
  fullyParallel: false,
  retries: 1,
  reporter: 'list',
  grepInvert,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    ...(STORAGE_STATE ? { storageState: STORAGE_STATE } : {}),
  },
  projects: [
    {
      name: 'setup-ui',
      testDir: './fixtures/ui',
      testMatch: /.*\.setup\.ts$/,
      outputDir: 'test-results/ui/setup-output',
    },
    {
      name: 'ui',
      testDir: './tests/ui',
      dependencies: ['setup-ui'],
      outputDir: 'test-results/ui/output',
    },
    {
      name: 'setup-api',
      testDir: './fixtures/api',
      testMatch: /.*\.setup\.ts$/,
      outputDir: 'test-results/api/setup-output',
      use: { baseURL: API_BASE_URL },
    },
    {
      name: 'api',
      testDir: './tests/api',
      dependencies: ['setup-api'],
      outputDir: 'test-results/api/output',
      use: { baseURL: API_BASE_URL },
    },
  ],
});
