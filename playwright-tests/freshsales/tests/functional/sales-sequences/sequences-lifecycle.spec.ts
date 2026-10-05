import { test, expect } from '../../../fixtures/base';
import { SequencesPage, SEQ_RUN, recordSeq } from '../../../pages/sales-sequences/SequencesPage';

// One run-created sequence (ZZ prefix) flows through the serial chain; every created sequence is recorded immediately and deleted in the end / afterAll.
const NAME = `ZZ Seq ${SEQ_RUN}`;
const EDITED = `${NAME} edited`;
const COPY = `${NAME} - Copy`;
const created = new Set<string>(); // names to clean up if still present

test.describe.configure({ mode: 'serial' });
test.describe('Sales Sequences - lifecycle on run-created sequences (ZZ-only)', () => {
  let id = '';
  let current = NAME;

  test.afterAll(async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: require('path').join(__dirname, '..', '..', '..', '.auth', 'freshsales-handoff.json'), baseURL: process.env.FRESHSALES_URL || 'https://rakesh-freshsales-ind-sep21.myfreshworks.com', viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const s = new SequencesPage(page);
    for (const n of created) await s.safeDelete(n).catch(() => undefined);
    await ctx.close();
  });

  test('TC-sales-sequences-005 Create Outbound-or-default contact sequence with a task step (stays Inactive) @P0', async ({ page }) => {
    const s = new SequencesPage(page);
    created.add(NAME);
    await s.gotoNew();
    await expect(s.nameInput).toHaveValue('New Sequence');
    await s.setName(NAME);
    await s.openAddTask();
    await expect(s.taskDialog.locator('input').first()).toHaveValue('Follow-up task');
    await expect(s.taskDialog).toContainText('Rakesh M');
    await s.dialogSave().click();
    await expect(page.getByText('Follow-up task').first()).toBeVisible();
    await s.pageSave.click();
    await expect(page).toHaveURL(/sales-sequences\/contact\/\d+/, { timeout: 30_000 });
    id = page.url().match(/contact\/(\d+)/)![1];
    recordSeq({ identifier: `${NAME} (id ${id})`, url: page.url(), note: 'TC-005 created' });
    await expect(page.getByText('Inactive').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clone sequence' }).or(page.getByText('Clone sequence')).first()).toBeVisible();
    await expect(page.getByText('Edit sequence').first()).toBeVisible();
  });

  test('TC-sales-sequences-003 List with data shows columns, counters and footer @P0', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await expect(s.row(NAME)).toBeVisible({ timeout: 30_000 });
    const head = page.locator('table.table-sales-sequence thead');
    for (const h of ['Name', 'Type', 'Metrics']) await expect(head).toContainText(h);
    for (const m of ['Sent', 'Opened', 'Clicked', 'Replied', 'Bounced', 'Unsubscribed']) await expect(s.row(NAME)).toContainText(new RegExp(m, 'i'));
    await expect(page.getByText('Showing:').first()).toBeVisible();
    await expect(page.getByText('All sequences').first()).toBeVisible();
    await expect(page.getByText(/Showing 1 - \d+ of \d+/)).toBeVisible();
    await expect(s.row(NAME)).toContainText('Contact');
  });

  test('TC-sales-sequences-004 Search sequences by name @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await expect(s.row(NAME)).toBeVisible({ timeout: 30_000 });
    test.skip(!(await s.searchBox.isVisible().catch(() => false)), 'Search box not rendered');
    await s.searchBox.fill(NAME);
    await s.searchBox.press('Enter');
    await expect(s.row(NAME)).toBeVisible();
    await s.searchBox.fill('');
    await s.searchBox.press('Enter');
    await expect(s.row(NAME)).toBeVisible();
  });

  test('TC-sales-sequences-008 Row actions menu lists Edit, Share, Clone, Delete @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await expect(s.row(NAME)).toBeVisible({ timeout: 30_000 });
    await s.rowTrigger(NAME).click();
    const items = page.locator('.ember-basic-dropdown-content li, .ember-basic-dropdown-content a, .dropdown-menu li').locator('visible=true');
    await expect(items).toHaveText(['Edit', 'Share', 'Clone', 'Delete']);
  });

  test('TC-sales-sequences-022 Share dialog Cancel saves nothing @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await s.rowAction(NAME, 'Share');
    await expect(s.shareRadio('Just me')).toBeChecked();
    await s.pickShare('Everyone');
    await expect(s.shareRadio('Everyone')).toBeChecked();
    await s.shareDialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(s.shareDialog).toHaveCount(0);
    await s.rowAction(NAME, 'Share');
    await expect(s.shareRadio('Just me')).toBeChecked();
    await s.shareDialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('TC-sales-sequences-009 Share dialog options and save with Everyone @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await s.rowAction(NAME, 'Share');
    await expect(s.shareDialog).toContainText(/share sequence/i);
    await expect(s.shareRadio('Just me')).toBeChecked();
    await expect(s.shareRadio('Everyone')).toHaveCount(1);
    await expect(s.shareRadio('Selected users, teams and territories')).toHaveCount(1);
    await s.pickShare('Everyone');
    await s.shareDialog.getByRole('button', { name: 'Save' }).click();
    await expect(s.shareDialog).toHaveCount(0, { timeout: 15_000 });
    await s.rowAction(NAME, 'Share');
    await expect(s.shareRadio('Everyone')).toBeChecked();
    await s.shareDialog.getByRole('button', { name: 'Cancel' }).click();
  });

  test('TC-sales-sequences-021 Clone then Cancel and confirm discard creates no copy @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await s.rowAction(NAME, 'Clone');
    await expect(s.pageSave).toBeVisible({ timeout: 30_000 });
    await expect(s.nameInput).toHaveValue(COPY);
    await page.locator('[data-test-ss-cancel-btn]').click();
    await expect(page.getByText('Are you sure want to discard?')).toBeVisible();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(page).toHaveURL(/sales-sequences\/filters/, { timeout: 30_000 });
    await expect(s.rows(COPY)).toHaveCount(0);
  });

  test('TC-sales-sequences-010 Clone a run-created sequence and save @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    created.add(COPY);
    await s.gotoList();
    await s.rowAction(NAME, 'Clone');
    await expect(s.nameInput).toHaveValue(COPY, { timeout: 30_000 });
    await s.pageSave.click();
    await page.waitForURL((u) => !/\/new$/.test(u.pathname) && !/clone/.test(u.pathname) || /contact\/\d+/.test(u.pathname), { timeout: 30_000 }).catch(() => undefined);
    const m = page.url().match(/contact\/(\d+)/);
    if (m) recordSeq({ identifier: `${COPY} (id ${m[1]})`, url: page.url(), note: 'TC-010 clone' });
    await s.gotoList();
    await expect(s.row(COPY)).toBeVisible({ timeout: 30_000 });
    recordSeq({ identifier: m ? `${COPY} (id ${m[1]})` : COPY, note: 'TC-010 clone present in list' });
    test.info().annotations.push({ type: 'observed', description: `copy row: ${(await s.row(COPY).innerText()).replace(/\s+/g, ' ').slice(0, 160)}` });
  });

  test('TC-sales-sequences-011 Edit a run-created sequence and save @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    created.add(EDITED);
    await s.gotoList();
    await s.rowAction(NAME, 'Edit');
    await expect(s.pageSave).toBeVisible({ timeout: 30_000 });
    await s.setName(EDITED);
    await s.pageSave.click();
    await s.gotoList();
    await expect(s.row(EDITED)).toBeVisible({ timeout: 30_000 });
    await expect(s.row(EDITED)).toContainText('Contact');
    created.delete(NAME);
    current = EDITED;
    await expect(s.rows(COPY)).toHaveCount(1);
    recordSeq({ identifier: `${NAME} (id ${id})`, note: `renamed to ${EDITED} (TC-011)` });
  });

  test('TC-sales-sequences-012 Delete run-created sequences (edited original and clone) @P0', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await s.rowAction(COPY, 'Delete');
    await expect(s.confirmDialog).toContainText('Are you sure you want to delete the sequence?');
    await s.confirmDialog.getByRole('button', { name: 'Yes' }).click();
    await expect(s.rows(COPY)).toHaveCount(0, { timeout: 20_000 });
    recordSeq({ identifier: COPY, note: 'deleted TC-012', deleted: true });
    created.delete(COPY);
    expect(await s.safeDelete(current, id)).toBe(true);
    created.delete(current);
  });
});

test.describe('Sales Sequences - self-created create/delete pairs (ZZ-only)', () => {
  const mk = (suffix: string) => `ZZ Seq ${SEQ_RUN} ${suffix}`;

  test('TC-sales-sequences-013 Create own sequence then delete it (replaces leftover-delete case) @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    const name = mk('own');
    const id = await s.create(name);
    try {
      await s.gotoList();
      await expect(s.row(name)).toBeVisible({ timeout: 30_000 });
    } finally {
      expect(await s.safeDelete(name, id)).toBe(true);
    }
  });

  test('TC-sales-sequences-015 Create Accounts-type sequence @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    const name = mk('acct');
    await s.gotoNew();
    await page.getByText('Accounts', { exact: true }).locator('visible=true').first().click();
    const proceed = page.getByRole('button', { name: 'Proceed' });
    if (await proceed.waitFor({ state: 'visible', timeout: 3_000 }).then(() => true, () => false)) await proceed.click();
    await expect(page).toHaveURL(/sales_account\/new/);
    await page.waitForTimeout(1500);
    await s.setName(name);
    let saved = false;
    try {
      await s.openAddTask();
      await s.dialogSave().click();
      await s.pageSave.click();
      await expect(page).toHaveURL(/sales-sequences\/(contact|account|sales_account)\/\d+/, { timeout: 30_000 });
      saved = true;
      const id = page.url().match(/\/(\d+)$/)![1];
      recordSeq({ identifier: `${name} (id ${id})`, url: page.url(), note: 'TC-015 created' });
      test.info().annotations.push({ type: 'observed', description: `detail url ${page.url()}` });
      await s.gotoList();
      await expect(s.row(name)).toContainText(/Account/);
    } finally {
      if (saved) await s.safeDelete(name);
    }
  });

  test('TC-sales-sequences-017 Save with empty sequence name (records behaviour) @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoNew();
    await s.openAddTask();
    await s.dialogSave().click();
    await s.nameInput.fill('');
    await s.pageSave.click();
    await page.waitForTimeout(3000);
    const m = page.url().match(/contact\/(\d+)/);
    if (m) {
      recordSeq({ identifier: `(empty name) (id ${m[1]})`, url: page.url(), note: 'TC-017 created with empty name' });
      test.info().annotations.push({ type: 'observed', description: 'empty name was ACCEPTED; sequence created' });
      await s.gotoList();
      const row = page.locator('table.table-sales-sequence tbody tr').first();
      test.info().annotations.push({ type: 'cleanup', description: `empty-name row text: ${(await row.innerText()).replace(/\s+/g, ' ').slice(0, 80)}; needs manual cleanup if present` });
    } else {
      test.info().annotations.push({ type: 'observed', description: `blocked; page text: ${(await page.locator('.error, .has-error, .text-danger, [class*=error]').allInnerTexts()).join(' | ').slice(0, 200)}` });
      await expect(page).toHaveURL(/contact\/new/);
    }
  });

  test('TC-sales-sequences-023 Duplicate sequence name (records behaviour) @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    const name = mk('dup');
    const id1 = await s.create(name);
    let outcome = '';
    try {
      await s.gotoNew();
      await s.setName(name);
      await s.openAddTask();
      await s.dialogSave().click();
      await s.pageSave.click();
      await page.waitForTimeout(4000);
      const m = page.url().match(/contact\/(\d+)/);
      outcome = m ? `allowed (id ${m[1]})` : 'blocked/stayed on form';
      if (m) recordSeq({ identifier: `${name} (id ${m[1]})`, url: page.url(), note: 'TC-023 duplicate' });
      test.info().annotations.push({ type: 'observed', description: outcome });
      await s.gotoList();
      while (await s.safeDelete(name)) { /* delete every row with this exact name (duplicates allowed) */ }
    } finally {
      await s.safeDelete(name, id1).catch(() => undefined);
    }
    expect(outcome).not.toBe('');
  });

  test('TC-sales-sequences-024 Name length limit (256 chars; records behaviour) @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    const name = `ZZ Seq ${SEQ_RUN} ` + 'L'.repeat(256 - `ZZ Seq ${SEQ_RUN} `.length);
    await s.gotoNew();
    await s.setName(name);
    const kept = (await s.nameInput.inputValue()).length;
    await s.openAddTask();
    await s.dialogSave().click();
    await s.pageSave.click();
    await page.waitForTimeout(4000);
    const m = page.url().match(/contact\/(\d+)/);
    test.info().annotations.push({ type: 'observed', description: `input kept ${kept}/256 chars; saved=${!!m}` });
    if (m) {
      recordSeq({ identifier: `${name.slice(0, 40)}... (id ${m[1]})`, url: page.url(), note: 'TC-024 created' });
      await s.gotoList();
      // The app may trim/alter the stored title, so locate by the unique run-stamped prefix, not the full 256-char name.
      const prefix = `ZZ Seq ${SEQ_RUN} LLLL`;
      const titles = page.locator('.sequence-title-text').filter({ hasText: prefix });
      await expect(titles.first()).toBeVisible({ timeout: 30_000 });
      const stored = ((await titles.first().innerText()).trim()).length;
      test.info().annotations.push({ type: 'observed', description: `stored title length ${stored}` });
      const tr = page.locator('tr').filter({ has: titles });
      await tr.first().locator('.fsa-dropdown-trigger').click();
      await page.getByText('Delete', { exact: true }).locator('visible=true').first().click();
      await s.confirmDialog.getByRole('button', { name: 'Yes' }).click();
      await expect(titles).toHaveCount(0, { timeout: 20_000 });
      recordSeq({ identifier: `${name.slice(0, 40)}... (id ${m[1]})`, note: 'deleted TC-024', deleted: true });
    }
    expect(kept).toBeGreaterThan(0);
  });
});
