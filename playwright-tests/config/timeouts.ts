import { env } from './env';

/**
 * Named timeout categories prevent arbitrary millisecond values from spreading
 * across page objects, fixtures and tests.
 */
export const timeouts = {
  test: env.timeouts.test,
  expect: env.timeouts.expect,
  action: env.timeouts.action,
  navigation: env.timeouts.navigation,
  api: env.timeouts.api,
  explicitWait: env.timeouts.explicitWait,
} as const;

export type TimeoutCategory = keyof typeof timeouts;
