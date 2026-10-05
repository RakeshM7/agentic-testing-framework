import { test, expect } from '../../../fixtures/base';
import { AccountsPage, ZZ_RUN, recordAccount } from '../../../pages/accounts/AccountsPage';

// Every account is ZZ-prefixed, unique per run, recorded in created-entities.json, and deleted by the test that created it.
test.describe('Accounts - mutating lifecycle (full-run)', () => {
  test('TC-accounts-007 Create account with only Name, then delete @P0', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Create Acct ${ZZ_RUN}`;
    const id = await a.create({ name });
    try {
      await expect(page).toHaveURL(new RegExp(`/accounts/${id}`));
    } finally {
      await a.safeDelete(id, name);
    }
  });

  test('TC-accounts-008 Create account with Website and Phone @P0', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Full Acct ${ZZ_RUN}`;
    const id = await a.create({ name, website: 'www.zzfull-acct.com', phone: '+18557476767' });
    try {
      await expect(page.getByText('www.zzfull-acct.com').first()).toBeVisible();
    } finally {
      await a.safeDelete(id, name);
    }
  });

  test('TC-accounts-010 Edit account name from kebab @P0', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Edit Acct ${ZZ_RUN}`;
    const edited = `${name} Edited`;
    const id = await a.create({ name });
    let current = name;
    try {
      await a.openKebabItem('Edit');
      await expect(a.nameInput).toBeVisible();
      await a.nameInput.fill(edited);
      await a.save();
      recordAccount({ identifier: edited, url: page.url() });
      current = edited;
      await expect(page.locator('h3').first()).toContainText(edited);
    } finally {
      await a.safeDelete(id, current);
    }
  });

  test('TC-accounts-014 Delete a run-created account to the Recycle Bin @P0', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Delete Acct ${ZZ_RUN}`;
    const id = await a.create({ name });
    await a.deleteRunCreated(id, name);
    await a.goto();
    await a.openView('Recycle Bin');
    await expect(page.getByText('The Recycle Bin stores deleted records for 90 days before deleting them forever')).toBeVisible();
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('TC-accounts-037 Duplicate Name is rejected @P0', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Dup Acct ${ZZ_RUN}`;
    const id = await a.create({ name });
    let dupId: string | null = null;
    try {
      await a.goto();
      await a.openAdd();
      await a.nameInput.fill(name);
      await a.save();
      await page.waitForTimeout(4_000); // no known error text; give the app time to either navigate or toast
      dupId = /\/accounts\/\d+/.test(page.url()) ? a.accountIdFromUrl() : null;
      if (dupId) recordAccount({ identifier: name, url: page.url(), note: 'DUPLICATE created by TC-037 (bug)' });
      expect(dupId, 'duplicate account was saved - expected rejection').toBeNull();
    } finally {
      await a.safeDelete(id, name);
      if (dupId && dupId !== id) await a.safeDelete(dupId, name);
    }
  });

  test('TC-accounts-043 Edit to empty Name is blocked @P1', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ EditEmpty Acct ${ZZ_RUN}`;
    const id = await a.create({ name });
    try {
      await a.openKebabItem('Edit');
      await a.nameInput.fill('');
      await a.save();
      await expect(a.dialog.getByText("can't be empty")).toBeVisible();
    } finally {
      await a.safeDelete(id, name);
    }
  });

  test('TC-accounts-047 Website www.<domain>.<random text> is accepted @P1', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Tld Acct ${ZZ_RUN}`;
    const id = await a.create({ name, website: 'www.zztld-acct.xyzabc' });
    await a.safeDelete(id, name);
  });

  // KNOWN BUG (clarification answer 1): Phone 'abc' is accepted. Expected-fail test documents it.
  test('TC-accounts-036 Non-numeric Phone is rejected (KNOWN BUG) @P0', async ({ page }) => {
    test.fail(true, 'Known bug: Phone "abc" is accepted by the app (explore + clarification answer 1)');
    const a = new AccountsPage(page);
    const name = `ZZ BadPhone Acct ${ZZ_RUN}`;
    await a.goto();
    await a.openAdd(true);
    await a.nameInput.fill(name);
    await a.phoneInput.fill('abc');
    await a.save();
    await page.waitForTimeout(4_000);
    const id = /\/accounts\/\d+/.test(page.url()) ? a.accountIdFromUrl() : null;
    if (id) recordAccount({ identifier: name, url: page.url(), note: 'created by known-bug TC-036' });
    try {
      expect(id, 'account with Phone "abc" was saved; expected a validation rejection').toBeNull();
    } finally {
      await a.safeDelete(id, name);
    }
  });
});
