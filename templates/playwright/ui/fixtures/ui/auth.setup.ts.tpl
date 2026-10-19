// The UI login state for the `ui` project, saved to .auth/ui.json. STORAGE_STATE (a state a human saved after logging
// in) is always used first. Setup files are the only exemption from the mutation guard: they must be able to log in.
import { test as setup } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { uiSettings } from '../../config/ui/settings';

const STATE = path.resolve(__dirname, '..', '..', '.auth', 'ui.json');
const NEEDS_STATE = 'log in once by hand (CAPTCHA and MFA included), save the storage state, and set STORAGE_STATE to its path in .env';

setup('authenticate (ui)', async ({ page }) => {
  mkdirSync(path.dirname(STATE), { recursive: true });
  const given = process.env.STORAGE_STATE;
  if (given) {
    if (!existsSync(given)) throw new Error(`STORAGE_STATE is ${given}, which does not exist: ${NEEDS_STATE}`);
    writeFileSync(STATE, readFileSync(given));
    return;
  }
{{loginBlock}}});
