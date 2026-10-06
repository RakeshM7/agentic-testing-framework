import { test as base, expect } from '@playwright/test';
import { DealsModule } from './DealsModule';
import { pendingDeals, recordDeal } from './tracker';
import fs from 'fs';
import { DEALS_ENTITIES_FILE } from './tracker';

export const test = base.extend<{ dm: DealsModule }>({
  dm: async ({ page }, use) => use(new DealsModule(page)),
});
export { expect };

/** Note used on a test when observed behaviour is recorded rather than asserted (unconfirmed rules). */
export function observe(description: string) {
  test.info().annotations.push({ type: 'observed', description });
}

/** Deletes (soft) every deal this track created and has not yet deleted. Safe to call repeatedly. */
export async function cleanupPendingDeals(dm: DealsModule) {
  const list: { type: string; identifier: string; note: string; deleted?: boolean }[] =
    fs.existsSync(DEALS_ENTITIES_FILE) ? JSON.parse(fs.readFileSync(DEALS_ENTITIES_FILE, 'utf-8')) : [];
  for (const e of list.filter((x) => x.type === 'deal' && !x.deleted)) {
    const name = 'ZZ';
    try {
      await dm.deleteDeal(e.identifier, name);
    } catch (err) {
      // Already deleted / forgotten / name changed: leave the record, report in the run notes.
      recordDeal({ type: 'deal', identifier: e.identifier, url: '', note: `${e.note} [cleanup failed: ${(err as Error).message.split('\n')[0]}]`, deleted: false });
    }
  }
}
export { pendingDeals };
