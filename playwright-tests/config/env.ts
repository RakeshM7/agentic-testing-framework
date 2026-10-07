import 'dotenv/config';

function getString(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function getNonNegativeInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative number. Received: "${raw}"`);
  }

  return Math.floor(value);
}

function getBoolean(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/**
 * Single source of truth for environment-driven framework configuration.
 *
 * Keep credentials in .env / .env.freshsales and keep framework behaviour such as
 * timeouts, retries and browser options in .env as well. Test/page modules should
 * not read process.env directly for framework settings.
 */
export const env = {
  urls: {
    eventHub: getString('EVENTHUB_BASE_URL', 'https://eventhub.rahulshettyacademy.com'),
    eventHubApi: getString('EVENTHUB_API_URL', 'https://api.eventhub.rahulshettyacademy.com/api'),
    freshsales: getString(
      'FRESHSALES_BASE_URL',
      'https://rakesh-freshsales-ind-sep21.myfreshworks.com'
    ),
    freshsalesHelp: getString('FRESHSALES_HELP_URL', 'https://support.freshsales.io'),
  },

  credentials: {
    eventHubEmail: getString('EVENTHUB_EMAIL'),
    eventHubPassword: getString('EVENTHUB_PASSWORD'),
  },

  browser: {
    headed: getBoolean('HEADED', false),
    slowMo: getNonNegativeInt('SLOWMO', 0),
  },

  execution: {
    isCI: getBoolean('CI', false),
    retries: getNonNegativeInt('PW_RETRIES', 0),
    workers: getNonNegativeInt('PW_WORKERS', 0),
    runVisual: getBoolean('RUN_VISUAL', false),
  },

  timeouts: {
    test: getNonNegativeInt('PW_TEST_TIMEOUT_MS', 30_000),
    expect: getNonNegativeInt('PW_EXPECT_TIMEOUT_MS', 10_000),
    action: getNonNegativeInt('PW_ACTION_TIMEOUT_MS', 10_000),
    navigation: getNonNegativeInt('PW_NAVIGATION_TIMEOUT_MS', 30_000),
    api: getNonNegativeInt('PW_API_TIMEOUT_MS', 30_000),
    explicitWait: getNonNegativeInt('PW_EXPLICIT_WAIT_MS', 1_000),
  },

  auth: {
    eventHubStateFile: getString('EVENTHUB_AUTH_FILE', '.auth/user.json'),
    freshsalesStateFile: getString('FRESHSALES_AUTH_FILE', '.auth/freshsales-user.json'),
  },
} as const;
