import { test, expect } from '../../../fixtures/base';
import { AccountsPage, ZZ_RUN, recordAccount } from '../../../pages/accounts/AccountsPage';

// All accounts here are ZZ-prefixed, recorded in created-entities.json and deleted in `finally`.
test.describe('Accounts - extended coverage (full-run)', () => {
  test('TC-accounts-009 Account detail page tabs @P1', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Tabs Acct ${ZZ_RUN}`;
    const id = await a.create({ name });
    try {
      const tabs: Array<[string, string]> = [
        ['Account details', 'entity-card-detail'], ['Conversations', 'conversations'], ['Activities', 'recent-activities'],
        ['Contacts', 'contacts'], ['Deals', 'deals'], ['Files', 'files'],
      ];
      for (const [label, param] of tabs) {
        await page.getByText(label, { exact: true }).first().click();
        await expect(page).toHaveURL(new RegExp(`tab=${param}`));
      }
      await expect(page.getByText('Add file').first()).toBeVisible();
    } finally {
      await a.safeDelete(id, name);
    }
  });

  test('TC-accounts-011 Clone account with a new unique name @P1', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Clone Src ${ZZ_RUN}`;
    const copy = `ZZ Clone Copy ${ZZ_RUN}`;
    const id = await a.create({ name });
    let copyId: string | null = null;
    try {
      await a.openKebabItem('Clone');
      await expect(a.nameInput).toHaveValue(name);
      await a.nameInput.fill(copy);
      await a.save();
      await page.waitForURL((u) => /\/accounts\/\d+/.test(u.pathname) && !u.pathname.endsWith(`/${id}`), { timeout: 20_000 });
      copyId = a.accountIdFromUrl();
      recordAccount({ identifier: copy, url: page.url() });
      await expect(page.locator('h3').first()).toContainText(copy);
    } finally {
      await a.safeDelete(copyId, copy);
      await a.safeDelete(id, name);
    }
  });

  test('TC-accounts-038 Clone-save with unchanged name is rejected as duplicate @P1', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ CloneDup Acct ${ZZ_RUN}`;
    const id = await a.create({ name });
    let dupId: string | null = null;
    try {
      await a.openKebabItem('Clone');
      await expect(a.nameInput).toHaveValue(name);
      await a.save();
      await page.waitForTimeout(4_000);
      dupId = a.accountIdFromUrl() !== id && /\/accounts\/\d+/.test(page.url()) ? a.accountIdFromUrl() : null;
      if (dupId) recordAccount({ identifier: name, url: page.url(), note: 'DUPLICATE created by TC-038 (bug)' });
      expect(dupId, 'clone with unchanged name was saved - expected rejection').toBeNull();
    } finally {
      await a.safeDelete(id, name);
      if (dupId) await a.safeDelete(dupId, name);
    }
  });

  test('TC-accounts-044 Edit to a Name used by another account is rejected @P1', async ({ page }) => {
    const a = new AccountsPage(page);
    const first = `ZZ EditDupA ${ZZ_RUN}`;
    const second = `ZZ EditDupB ${ZZ_RUN}`;
    const idA = await a.create({ name: first });
    const idB = await a.create({ name: second });
    try {
      await a.openKebabItem('Edit');
      await a.nameInput.fill(first);
      await a.save();
      await page.waitForTimeout(4_000);
      await page.goto(`/crm/sales/accounts/${idB}`);
      await expect(page.locator('h3').first()).toContainText(second);
    } finally {
      await a.safeDelete(idB, second);
      await a.safeDelete(idA, first);
    }
  });

  for (const [tc, label, site] of [
    ['040', 'http(s):// prefix', 'https://www.zzsite.com'],
    ['041', 'bare domain without www.', 'zzsite.com'],
    ['042', 'spaces', 'www.zz site.com'],
  ] as const) {
    test(`TC-accounts-${tc} Website with ${label} is rejected @P2`, async ({ page }) => {
      test.fail(true, `Unconfirmed assumption disproved: the app accepts Website "${site}" (only a non-URL like "not a url" is rejected, see TC-035)`);
      const a = new AccountsPage(page);
      const name = `ZZ Site${tc} Acct ${ZZ_RUN}`;
      await a.goto();
      await a.openAdd();
      await a.nameInput.fill(name);
      await a.websiteInput.fill(site);
      await a.save();
      await page.waitForTimeout(3_000);
      const savedId = /\/accounts\/\d+/.test(page.url()) ? a.accountIdFromUrl() : null;
      if (savedId) recordAccount({ identifier: name, url: page.url(), note: `saved by TC-${tc} (assumption not met)` });
      try {
        expect(savedId, `Website "${site}" was accepted; expected rejection`).toBeNull();
      } finally {
        await a.safeDelete(savedId, name);
      }
    });
  }

  test('TC-accounts-048 Create account with empty Website @P2', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ NoSite Acct ${ZZ_RUN}`;
    const id = await a.create({ name });
    try {
      await expect(page.getByText('Add website').first()).toBeVisible();
    } finally {
      await a.safeDelete(id, name);
    }
  });

  test('TC-accounts-049 Name with special characters and padding is accepted @P2', async ({ page }) => {
    const a = new AccountsPage(page);
    const name = `ZZ Spec & Chars #${ZZ_RUN} !`;
    await a.goto();
    await a.openAdd();
    await a.nameInput.fill(`  ${name}  `);
    await a.save();
    await page.waitForURL(/\/crm\/sales\/accounts\/\d+/);
    const id = a.accountIdFromUrl()!;
    recordAccount({ identifier: name, url: page.url() });
    try {
      await expect(page.locator('h3').first()).toContainText(name);
    } finally {
      await a.safeDelete(id, name);
    }
  });

  test('TC-accounts-004 Customize table: add and remove Business type column @P2', async ({ page }) => {
    const a = new AccountsPage(page);
    const header = page.getByRole('columnheader', { name: 'Business type' });
    const toggle = async () => {
      await page.getByText('Customize table', { exact: true }).click();
      await expect(page.getByText('Fields visible in table')).toBeVisible();
      const panel = page.locator('div').filter({ has: page.getByPlaceholder('Search fields') }).filter({ hasText: 'Fields visible in table' }).last();
      await panel.getByText('Business type', { exact: true }).click();
      await page.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page.getByText('Fields visible in table')).toBeHidden();
    };
    await a.goto();
    if (await header.count()) await toggle(); // normalize: start with the column hidden
    await expect(header).toHaveCount(0);
    await toggle();
    await expect(header.first()).toBeVisible();
    await toggle();
    await expect(header).toHaveCount(0);
  });

  test('TC-accounts-031 Sort the list by Name via header caret @P2', async ({ page }) => {
    const a = new AccountsPage(page);
    await a.goto();
    await a.openView('All accounts');
    const firstName = page.locator('[role=row] a').filter({ hasText: /\S/ }).first();
    const header = page.getByRole('columnheader', { name: 'Name', exact: true }).first();
    const sortVia = async (item: string) => {
      await header.hover();
      await header.locator('svg, [class*="caret"], [class*="sort"]').last().click();
      await page.getByText(item).click();
    };
    await sortVia('Sort descending Z → A');
    await expect(firstName).toContainText(/^(ZZ|Synth|Widgetz|Techcave|Pivotal)/);
    await sortVia('Sort ascending A → Z');
    await expect(firstName).toContainText(/^(AgentTest|Acme|Apex|E Corp|Explore)/);
  });
});
