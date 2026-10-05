import fs from 'fs';
import { test, expect } from '../../../fixtures/base';
import { AccountsPage, ENTITIES_FILE, AccountEntity, recordAccount } from '../../../pages/accounts/AccountsPage';

// Safety net: deletes only run-created (recorded, ZZ-prefixed) accounts that an earlier failed test left behind.
test('accounts track cleanup: delete leftover run-created ZZ accounts', async ({ page }) => {
  test.setTimeout(240_000);
  const list: AccountEntity[] = JSON.parse(fs.readFileSync(ENTITIES_FILE, 'utf-8'));
  const deletedIds = new Set(list.filter((e) => e.deleted).map((e) => e.url.match(/(\d{6,})/)?.[1]));
  const pending = new Map<string, string>();
  for (const e of list) {
    const id = e.url.match(/(\d{6,})/)?.[1];
    if (!id || deletedIds.has(id) || !e.identifier.startsWith('ZZ ') || e.note.includes('NOT deleted')) continue;
    pending.set(id, e.identifier);
  }
  console.log('pending:', JSON.stringify([...pending]));
  const a = new AccountsPage(page);
  for (const [id, name] of pending) {
    await page.goto(`/crm/sales/accounts/${id}`);
    await expect(page.locator('h3').or(page.getByText(/not in the CRM/)).first()).toBeVisible({ timeout: 20_000 });
    const gone = await page.getByText(/not in the CRM/).first().isVisible().catch(() => false);
    if (gone) { console.log(`already gone: ${id}`); recordAccount({ identifier: name, url: `/crm/sales/accounts/${id}`, deleted: true }); continue; }
    const heading = (await page.locator('h3').first().textContent({ timeout: 15_000 }).catch(() => '')) ?? '';
    console.log(`${id} heading=${heading}`);
    if (!heading.trim().startsWith('ZZ ')) continue; // never delete something that is not ZZ-prefixed
    await a.deleteRunCreated(id, name);
  }
  expect(true).toBe(true);
});
