// The API session for the `api` project, saved to .auth/api.json. Header schemes read their variable per request
// (fixtures/api/base.ts); this setup only checks it is set. The `session` scheme uses STORAGE_STATE first, else the
// UI setup's .auth/ui.json. There is no credential login here: CAPTCHA or MFA always needs STORAGE_STATE.
import { test as setup } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { apiSettings } from '../../config/api/settings';

const STATE = path.resolve(__dirname, '..', '..', '.auth', 'api.json');
const UI_STATE = path.resolve(__dirname, '..', '..', '.auth', 'ui.json');
const NEEDS_STATE = 'log in once by hand (CAPTCHA and MFA included), save the storage state, and set STORAGE_STATE to its path in .env';

setup('authenticate (api)', async () => {
  mkdirSync(path.dirname(STATE), { recursive: true });
  const auth = apiSettings.auth;
  if (auth.scheme === 'session') {
    const source = process.env.STORAGE_STATE || (existsSync(UI_STATE) ? UI_STATE : undefined);
    if (!source || !existsSync(source)) throw new Error(`the API uses the product's session: ${NEEDS_STATE}`);
    writeFileSync(STATE, readFileSync(source));
    return;
  }
  if (auth.scheme === 'basic' && !(process.env.API_USERNAME && process.env.API_PASSWORD))
    throw new Error('the API uses basic auth: set API_USERNAME and API_PASSWORD in .env');
  if (['bearer', 'oauth2', 'api-key'].includes(auth.scheme) && !(auth.env && process.env[auth.env]))
    throw new Error(`the API uses ${auth.scheme} auth: set ${auth.env ?? 'its variable'} in .env`);
  writeFileSync(STATE, JSON.stringify({ cookies: [], origins: [] }));
});
