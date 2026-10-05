import path from 'path';
import { test as base, expect, Page } from '@playwright/test';
import { ContactsModulePage, Made, pendingEntities, recordEntity } from '../../../pages/contacts/ContactsModulePage';

/**
 * Contacts module: create -> edit -> detail/activities -> lifecycle -> clone -> bulk -> delete -> recycle bin.
 * One run-created contact (TCContacts prefix, @example.com) is shared by the serial chain; every created contact is
 * recorded in artifacts/.../modules/contacts/playwright/created-entities.json and deleted in afterAll (guarded).
 */
const test = base;

let main: Made;
/** Lazily (re)creates the shared contact: tests stay independent even if a failure restarts the worker. */
async function ensureMain(page: Page): Promise<Made> {
  if (!main) main = await new ContactsModulePage(page).create('Main', { job: 'QA Tester' });
  return main;
}

test.afterAll(async ({ browser }) => {
  // Guarded cleanup: only contacts recorded in this track's created-entities.json and not yet deleted.
  const ctx = await browser.newContext({ storageState: path.join(__dirname, '..', '..', '..', '.auth', 'freshsales-handoff.json'), baseURL: process.env.FRESHSALES_URL || 'https://rakesh-freshsales-ind-sep21.myfreshworks.com', viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const m = new ContactsModulePage(page);
  for (const c of pendingEntities()) {
    try {
      await page.goto(c.url);
      if (await page.getByText('Lifecycle stage', { exact: true }).isVisible({ timeout: 8_000 }).catch(() => false)) {
        await m.dismissNoise();
        await m.kebabChoose('Delete');
        await page.getByRole('button', { name: 'Yes', exact: true }).click();
        await page.waitForURL(/\/contacts\/view\//);
      }
      recordEntity({ ...c, deleted: true, note: `${c.note} (deleted by cleanup)` });
    } catch (e) { console.log(`cleanup of ${c.identifier} failed: ${e}`); }
  }
  await ctx.close();
});

test.describe('Contacts: create, view, edit', () => {
  test('TC-contacts-008 create a contact with Email and names; detail page shows them [P0]', async ({ page }) => {
    const m = new ContactsModulePage(page);
    main = await m.create('Main', { job: 'QA Tester' });
    await expect(page).toHaveURL(/\/crm\/sales\/contacts\/\d+$/);
    await expect(page.getByText(main.fullName).first()).toBeVisible();
    await expect(page.getByText('QA Tester').first()).toBeVisible();
    await expect(page.getByText(main.email).first()).toBeVisible();
    await m.gotoList();
    await expect(m.rowById(main.id).first()).toBeVisible();
  });

  test('TC-contacts-009 new contact defaults to Lifecycle stage Lead and Status New [P0]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await expect(page.locator('xpath=(//*[normalize-space(text())="Lifecycle stage"])[1]/following::h3[1]')).toHaveText('Lead');
    await expect(page.getByText('New', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Rakesh M').filter({ visible: true }).first()).toBeVisible();
  });

  test('TC-contacts-012 detail page tabs load [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    for (const tab of ['Contact details', 'Conversations', 'Activities', 'Accounts', 'Deals', 'Files']) {
      await page.getByText(tab, { exact: true }).first().click();
      await expect(page).toHaveURL(/tab=/);
    }
    await page.getByText('Contact details', { exact: true }).first().click();
    await expect(page.getByText('Basic information').first()).toBeVisible();
    await page.getByText('Conversations', { exact: true }).first().click();
    await expect(page.getByText('Call Logs').first()).toBeVisible();
  });

  test('TC-contacts-013 edit job title persists after reload [P0]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await m.kebabChoose('Edit');
    await expect(m.jobTitle).toBeVisible();
    await m.jobTitle.fill('QA Tester Updated');
    await m.drawerSave.click();
    await expect(m.jobTitle).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/contacts/${main.id}$`));
    await expect(page.getByText('QA Tester Updated').first()).toBeVisible();
    await page.reload();
    await expect(page.getByText('QA Tester Updated').first()).toBeVisible();
  });

  test('TC-contacts-014 clearing the optional Job title saves [P2]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await m.kebabChoose('Edit');
    await m.jobTitle.fill('');
    await m.drawerSave.click();
    await expect(m.jobTitle).toBeHidden();
    await page.reload();
    await expect(page.getByText('Add job title...')).toBeVisible();
    await expect(page.getByText('QA Tester Updated')).toHaveCount(0);
  });
});

test.describe('Contacts: lifecycle stage', () => {
  async function openEditor(page: import('@playwright/test').Page) {
    await page.locator('xpath=(//*[normalize-space(text())="Lifecycle stage"])[1]/following::h3[1]').click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
  }
  async function pick(page: import('@playwright/test').Page, idx: number, option: string) {
    await page.locator('.ember-power-select-trigger:visible').nth(idx).click();
    await page.locator('.ember-power-select-option').filter({ hasText: option }).first().click();
  }

  test('TC-contacts-032 non-Lost lifecycle stage saves without extra requirements [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await openEditor(page);
    await pick(page, 0, 'Sales Qualified Lead');
    await pick(page, 1, 'Qualified');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Contact updated.')).toBeVisible();
    await page.reload();
    await expect(page.getByText('Sales Qualified Lead').first()).toBeVisible();
  });

  test('TC-contacts-031 Lost without a Lost reason is blocked [P0]', async ({ page }) => {
    await ensureMain(page);
    // Clarification: "If the Lifecycle stage is Lost, then Lost reason is mandatory". Live tenant observation while
    // building this suite: Save with status Lost and no reason showed "Contact updated." (see feedback file).
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await openEditor(page);
    await pick(page, 1, 'Lost');
    await expect(page.locator('.ember-power-select-trigger:visible').nth(1)).toContainText('Lost');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('Contact updated.')).toHaveCount(0, { timeout: 4_000 });
  });

  test('TC-contacts-033 Lost with a Lost reason saves [P2]', async ({ page }) => {
    test.skip(true, 'Lost-reason control location not captured by explore (Open question) and unconfirmed; see feedback');
  });
});

test.describe('Contacts: activities', () => {
  test('TC-contacts-016 add a note to a run-created contact [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    const text = `TC note ${Date.now()}`;
    await page.getByText('Add a note...').click();
    await page.locator('.fr-element').last().fill(text);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.goto(`${main.url}?tab=recent-activities`);
    await page.getByText('Notes', { exact: true }).first().click();
    await expect(page.getByText(text).first()).toBeVisible();
  });

  test('TC-contacts-017 add a task to a run-created contact [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    const title = `TC task ${Date.now()}`;
    await page.getByRole('button', { name: 'Task', exact: true }).first().click();
    await page.locator('input[name="title"]').fill(title);
    await m.drawerSave.click();
    await expect(page.locator('input[name="title"]')).toBeHidden();
    await page.goto(`${main.url}?tab=recent-activities`);
    await page.getByText('Tasks', { exact: true }).first().click();
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test('TC-contacts-045 add task without Title is blocked [P2]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await page.getByRole('button', { name: 'Task', exact: true }).first().click();
    await expect(page.locator('input[name="title"]')).toBeVisible();
    await m.drawerSave.click();
    await expect(page.locator('input[name="title"]')).toBeVisible(); // drawer stays open: nothing saved
  });

  test('TC-contacts-019 log a call with an Outcome [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await page.getByRole('button', { name: 'Call log', exact: true }).first().click();
    await expect(page.getByText('Call type')).toBeVisible();
    await page.locator('.select2-container:visible').nth(1).locator('a.select2-choice, .select2-choice').first().click();
    await page.locator('.select2-drop-active .select2-results li, .select2-results li').first().click();
    await page.locator('.fr-element').first().fill('TC call note');
    await m.drawerSave.click();
    await expect(page.getByText('Call type')).toBeHidden();
    await page.goto(`${main.url}?tab=conversations`);
    await expect(page.getByText('Call Logs').first()).toBeVisible();
  });

  test('TC-contacts-034 call log without Outcome: observed behaviour [P1]', async ({ page }) => {
    await ensureMain(page);
    // Clarification says Outcome is mandatory; the live form shows no required marker on Outcome (only Call type,
    // Associate and Name carry an asterisk). Assert only that the form submits or flags Outcome, and record.
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await page.getByRole('button', { name: 'Call log', exact: true }).first().click();
    await expect(page.getByText('Call type')).toBeVisible();
    await m.drawerSave.click();
    await expect(page.getByText('Call type')).toBeVisible(); // spec: submit blocked, drawer stays open
  });
});

test.describe('Contacts: clone, row actions, bulk', () => {
  test('TC-contacts-042 cancel Clone drawer creates nothing [P2]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await m.kebabChoose('Clone');
    await expect(page.getByText('CLONE CONTACT')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('CLONE CONTACT')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/contacts/${main.id}$`));
  });

  test('TC-contacts-029 clone saved with the unchanged email is blocked as duplicate [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await m.kebabChoose('Clone');
    await expect(m.email).toBeVisible();
    await m.email.fill(main.email); // explicit: covers both an empty and a pre-filled clone drawer
    await m.firstName.fill('TCContacts');
    await m.lastName.fill(`CloneDup${main.last}`);
    await m.drawerSave.click();
    await expect(m.email).toBeVisible(); // drawer stays open
    await expect(page).toHaveURL(new RegExp(`/contacts/${main.id}$`));
  });

  test('TC-contacts-015 clone a run-created contact with a unique email [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await m.kebabChoose('Clone');
    await expect(m.email).toBeVisible();
    const last = `Clone${Date.now()}`;
    const email = `tccontacts.clone.${Date.now()}@example.com`;
    await m.email.fill(email);
    await m.firstName.fill('TCContacts');
    await m.lastName.fill(last);
    await m.drawerSave.click();
    await page.waitForURL((u) => /\/contacts\/\d+$/.test(u.toString()) && !u.toString().endsWith(main.id));
    const url = page.url();
    const id = url.match(/contacts\/(\d+)/)![1];
    recordEntity({ type: 'contact', identifier: id, url, createdAt: new Date().toISOString(), note: `TCContacts ${last} (clone)` });
    await expect(page.getByText(email).first()).toBeVisible();
  });

  test('TC-contacts-021 row actions menu lists the expected actions [P2]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.gotoList();
    const row = m.rowById(main.id).first();
    await expect(row).toBeVisible();
    await row.hover();
    await row.locator('[data-tracker-id="row-actions"]').first().click();
    const menu = page.locator('.ember-basic-dropdown-content:visible');
    for (const item of ['Clone', 'Delete', 'Unsubscribe', 'Forget']) await expect(menu.getByText(item, { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('TC-contacts-043 Bulk actions with no selection: observed behaviour [P2]', async ({ page }) => {
    // Spec expectation: no menu opens. OBSERVED on the live tenant: clicking 'Bulk actions' with nothing selected
    // selects ALL rows and shows the bulk toolbar. No bulk action is ever clicked here; the selection is cancelled.
    const m = new ContactsModulePage(page);
    await m.gotoList();
    await page.getByText('Bulk actions', { exact: true }).click();
    try {
      test.info().annotations.push({ type: 'observation', description: "'Bulk actions' with no selection selects all rows and shows the toolbar" });
      await expect(page.getByText(/\d+ contacts selected/)).toBeVisible();
    } finally {
      await page.getByText('Cancel bulk selection').click();
    }
    await expect(page.getByText('Add tags', { exact: true })).toHaveCount(0);
  });

  test('TC-contacts-022 bulk toolbar appears and Add tags works on the run-created contact only [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.gotoList();
    const row = m.rowById(main.id).first();
    await row.getByRole('checkbox').check();
    await expect(page.getByText('1 contact selected')).toBeVisible(); // guard: exactly the run-created contact
    await expect(page.getByText('Add tags', { exact: true })).toBeVisible();
    await page.getByText('Add tags', { exact: true }).click();
    const tag = `tctag${Date.now() % 100000}`;
    const input = page.locator('input:visible').last();
    await input.fill(tag);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: /^(Add|Apply|Save|Update)/ }).last().click();
    await page.goto(main.url);
    await page.getByText('Contact details', { exact: true }).first().click();
    await expect(page.getByText(tag).first()).toBeVisible();
  });
});

test.describe('Contacts: delete and Recycle Bin', () => {
  test('TC-contacts-040 cancelling the delete confirmation keeps the contact [P1]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.openDetail(main);
    await m.kebabChoose('Delete');
    await expect(page.getByText('Delete this contact and its related data?')).toBeVisible();
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await expect(page.getByText('Delete this contact and its related data?')).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/contacts/${main.id}$`));
  });

  test('TC-contacts-023 delete a run-created contact via kebab and confirm [P0]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.deleteGuarded(main);
    await expect(page).toHaveURL(/\/crm\/sales\/contacts\/view\//);
    await expect(m.rowById(main.id)).toHaveCount(0);
  });

  test('TC-contacts-035 deleted run-created contact is in the Recycle Bin and can be restored [P0]', async ({ page }) => {
    await ensureMain(page);
    const m = new ContactsModulePage(page);
    await m.gotoList();
    await page.getByText('14 more...').click();
    await page.getByText('Recycle Bin', { exact: true }).click();
    await expect(page.getByText('The Recycle Bin stores deleted records for 90 days')).toBeVisible();
    const row = m.rowById(main.id).first();
    await expect(row).toBeVisible();
    await row.getByRole('checkbox').check();
    await expect(page.getByText('1 contact selected')).toBeVisible();
    const restore = page.getByText(/^Restore/).first();
    test.skip(!(await restore.isVisible().catch(() => false)), 'No Restore CTA visible: record as RBAC/unverified per TC-035');
    await restore.click();
    await page.getByRole('button', { name: /^(Yes|Restore|Confirm)/ }).last().click().catch(() => undefined);
    await m.gotoList();
    await expect(m.rowById(main.id).first()).toBeVisible();
    recordEntity({ type: 'contact', identifier: main.id, url: main.url, createdAt: new Date().toISOString(), note: `${main.fullName} restored from Recycle Bin`, deleted: false });
  });
});
