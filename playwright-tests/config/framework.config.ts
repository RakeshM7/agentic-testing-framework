import path from 'path';
import { env } from './env';
import { timeouts } from './timeouts';

const root = path.resolve(__dirname, '..');

export const frameworkConfig = {
  root,
  urls: env.urls,
  credentials: env.credentials,
  browser: env.browser,
  execution: env.execution,
  timeouts,
  auth: {
    eventHubStateFile: path.resolve(root, env.auth.eventHubStateFile),
    freshsalesStateFile: path.resolve(root, env.auth.freshsalesStateFile),
  },
} as const;
