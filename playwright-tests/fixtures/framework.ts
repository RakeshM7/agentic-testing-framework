import { test as base } from '@playwright/test';
import { frameworkConfig } from '../config/framework.config';
import { WaitHelper } from '../helpers/wait.helper';

type FrameworkFixtures = {
  waits: WaitHelper;
  frameworkConfig: typeof frameworkConfig;
};

/**
 * Common framework fixtures. Domain-specific fixtures should extend this
 * instead of importing environment/configuration directly in every test.
 */
export const frameworkTest = base.extend<FrameworkFixtures>({
  waits: async ({}, use) => {
    await use(new WaitHelper());
  },

  frameworkConfig: async ({}, use) => {
    await use(frameworkConfig);
  },
});

export const expect = base.expect;
