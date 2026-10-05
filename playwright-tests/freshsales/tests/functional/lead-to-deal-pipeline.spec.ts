import { test, expect } from '../../fixtures/base';
import { OPEN_STAGES } from '../../pages/DealsPage';
import { recordCreatedEntity, RUN_ID } from '../../utils/createdEntities';

/**
 * Lead-to-deal pipeline (TC-001..008, TC-014) plus cleanup. mode: full-run, live against the trial tenant.
 * Serial chain: each test builds on the entities created by the previous ones. Every entity gets a unique
 * AgentTest-prefixed name (clarification Q10) and is recorded in created-entities.json; the final cleanup
 * tests delete only entities this very run created.
 * TC-015 / TC-016 are placeholders for unconfirmed behaviour (Q9) and are deliberately not automated.
 */
test.describe.serial('Lead-to-deal pipeline (full-run, live)', () => {
  const first = 'AgentTest';
  const last = `Lead${RUN_ID}`;
  const accountName = `AgentTest Co ${RUN_ID}`;
  const dealName = `AgentTest Deal ${RUN_ID}`;
  const taskTitle = `AgentTest Task ${RUN_ID}`;
  const callNote = `AgentTest call note ${RUN_ID}`;
  const noteText = `AgentTest note ${RUN_ID}`;
  const email = `agenttest.${RUN_ID}@example.com`;
  let contactId = '';
  let accountId = '';
  let dealId = '';

  const contactUrl = () => `/crm/sales/contacts/${contactId}`;
  const dealUrl = () => `/crm/sales/deals/${dealId}`;

  test('TC-001 create contact with default Status New / Lifecycle Lead', async ({ page, contactsPage, contactDetail }) => {
    await contactsPage.goto();
    await contactsPage.openAddContact();
    await contactsPage.fill({ email, first, last });
    await contactsPage.drawerSave.click();
    await expect(page).toHaveURL(/\/crm\/sales\/contacts\/\d+$/);
    contactId = contactDetail.idFromUrl();
    recordCreatedEntity({
      type: 'contact', identifier: contactId, url: page.url(),
      createdAt: new Date().toISOString(), note: `${first} ${last} (TC-001)`,
    });
    await expect(page.getByText(`${first} ${last}`).first()).toBeVisible();
    await expect(contactDetail.lifecycleValue).toHaveText('Lead');
    await expect(contactDetail.statusNewStage).toBeVisible();
    // The contact appears in the Contacts list.
    await page.goto('/crm/sales/contacts');
    await expect(page.locator(`a[href$="/crm/sales/contacts/${contactId}"]`).first()).toBeVisible();
  });

  test('TC-002 qualify contact: Status Qualified promotes Lifecycle to Sales Qualified Lead', async ({ page, contactDetail }) => {
    await contactDetail.goto(contactUrl());
    await contactDetail.setStatusQualified();
    await page.reload();
    await contactDetail.dismissNoise();
    await expect(contactDetail.lifecycleValue).toHaveText('Sales Qualified Lead');
    await expect(contactDetail.statusQualifiedStage).toBeVisible();
  });

  test('TC-003 link contact to a new account', async ({ page, contactDetail }) => {
    await contactDetail.goto(contactUrl());
    await contactDetail.openAccountEditor();
    const options = await contactDetail.searchAccount(accountName);
    // Observed: the editor searches existing accounts and also offers an 'Add new "<name>"...' entry.
    await expect(options.first()).toHaveText(`Add new "${accountName}"...`);
    await options.first().click();
    await expect(page.getByText(`${accountName} added.`)).toBeVisible();
    // Observed: 'Add new' only creates the account; it must then be selected in the editor and saved. The new
    // account becomes searchable only after a short indexing delay, so re-open the editor and retry the search.
    await expect(async () => {
      await page.keyboard.press('Escape');
      await contactDetail.openAccountEditor();
      const found = await contactDetail.searchAccount(accountName);
      // The option list first shows 'Loading options...'; wait for the real match, not the 'Add new' entry.
      const existing = found.filter({ hasText: accountName }).filter({ hasNotText: 'Add new' }).first();
      await expect(existing).toBeVisible({ timeout: 4_000 });
      await existing.click();
    }).toPass({ timeout: 60_000, intervals: [3_000] });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(contactDetail.toast('Contact updated.')).toBeVisible();
    await page.reload();
    await contactDetail.dismissNoise();
    const accountLink = page.locator('a[href*="/crm/sales/accounts/"]').filter({ hasText: accountName }).first();
    await expect(accountLink).toBeVisible();
    accountId = (await accountLink.getAttribute('href'))!.match(/accounts\/(\d+)/)![1];
    recordCreatedEntity({
      type: 'account', identifier: accountId, url: new URL(`/crm/sales/accounts/${accountId}`, page.url()).toString(),
      createdAt: new Date().toISOString(), note: `${accountName} (TC-003)`,
    });
    // Account detail lists the contact.
    await page.goto(`/crm/sales/accounts/${accountId}`);
    await expect(page.getByText(`${accountName}'s contacts`)).toBeVisible();
    await expect(page.getByText(`${first} ${last}`).first()).toBeVisible();
  });

  test('TC-004 create deal via Add deal with contact and account linked', async ({ page, dealsPage }) => {
    await dealsPage.goto();
    await dealsPage.openAddDeal();
    await dealsPage.pickRelated('Related contact', last);
    await dealsPage.pickRelated('Related account', accountName);
    await dealsPage.dealName.fill(dealName);
    await dealsPage.dealValue.fill('1500');
    await dealsPage.drawerSave.click();
    await expect(page).toHaveURL(/\/crm\/sales\/deals\/\d+$/);
    dealId = page.url().match(/deals\/(\d+)/)![1];
    recordCreatedEntity({
      type: 'deal', identifier: dealId, url: page.url(),
      createdAt: new Date().toISOString(), note: `${dealName} (TC-004)`,
    });
    await expect(page.getByText('Deal added.')).toBeVisible();
    await expect(page.getByText(dealName).first()).toBeVisible();
    await expect(page.getByText('$1,500').first()).toBeVisible();
    // Linked account is shown on the deal (observed to render as a link under 'Related account').
    await expect(page.locator('a[href*="/crm/sales/accounts/"]').filter({ hasText: accountName }).first()).toBeVisible();
    // New deals land in the first stage of the default pipeline.
    await dealsPage.goto();
    await expect.poll(() => dealsPage.columnIndexOf(dealName), { timeout: 20_000 }).toBe(0);
  });

  test('TC-005 move deal through every open pipeline stage, first to last', async ({ page, dealsPage }) => {
    await dealsPage.goto();
    // Observed: 7 columns = 5 open stages + Won + Lost; Won/Lost are never targeted (clarification Q9).
    await expect(dealsPage.columns).toHaveCount(OPEN_STAGES.length + 2);
    await expect.poll(() => dealsPage.columnIndexOf(dealName), { timeout: 20_000 }).toBe(0);
    for (let i = 1; i < OPEN_STAGES.length; i++) {
      await dealsPage.dragCardToColumn(dealName, i);
      await expect
        .poll(() => dealsPage.columnIndexOf(dealName), { message: `card in ${OPEN_STAGES[i]}`, timeout: 20_000 })
        .toBe(i);
      await page.reload();
      await dealsPage.dismissNoise();
      await expect
        .poll(() => dealsPage.columnIndexOf(dealName), { message: `card persists in ${OPEN_STAGES[i]}`, timeout: 20_000 })
        .toBe(i);
    }
  });

  test('TC-006 log a task against the deal', async ({ page, dealDetail }) => {
    await dealDetail.goto(dealUrl());
    await dealDetail.openTaskForm();
    await dealDetail.taskTitle.fill(taskTitle);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('You added a task.')).toBeVisible();
    // Observed: after saving, the app lands on Activities > Tasks; the row's title link holds the full title.
    await expect(page.getByText(taskTitle).first()).toBeVisible();
    recordCreatedEntity({
      type: 'task', identifier: taskTitle, url: new URL(dealUrl(), page.url()).toString(),
      createdAt: new Date().toISOString(), note: `Task on deal ${dealName} (TC-006)`,
    });
  });

  test('TC-007 log a call against the deal', async ({ page, dealDetail }) => {
    await dealDetail.goto(dealUrl());
    await dealDetail.openCallLogForm();
    await dealDetail.callNotes.fill(callNote);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // Observed: after saving, the app lands on Conversations; logged calls are listed under 'Call Logs'.
    await page.getByText('Call Logs', { exact: true }).click();
    await expect(page.getByText(callNote).first()).toBeVisible();
    recordCreatedEntity({
      type: 'call', identifier: callNote, url: new URL(dealUrl(), page.url()).toString(),
      createdAt: new Date().toISOString(), note: `Call log on deal ${dealName} (TC-007)`,
    });
  });

  test('TC-008 add a note against the deal', async ({ page, dealDetail }) => {
    await dealDetail.goto(dealUrl());
    // The summary note box does not persist on blur (observed); use Activities > Notes > Add note > Done.
    await page.getByText('Activities', { exact: true }).first().click();
    await page.getByText('Notes', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Add note' }).last().click();
    const composer = page
      .locator('div')
      .filter({ hasText: 'Related to:' })
      .filter({ has: page.getByRole('button', { name: 'Done', exact: true }) })
      .last();
    await composer.locator('[contenteditable="true"]').fill(noteText);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(page.getByText('You added a note.')).toBeVisible();
    await expect(page.getByText('Related to:')).toBeHidden();
    // Saved note text lives in the list, not in an editable box (the summary editor can also echo text).
    await expect(page.locator(`:not([contenteditable="true"] *):text-is("${noteText}")`).first()).toBeVisible();
    recordCreatedEntity({
      type: 'note', identifier: noteText, url: new URL(dealUrl(), page.url()).toString(),
      createdAt: new Date().toISOString(), note: `Note on deal ${dealName} (TC-008)`,
    });
  });

  test('TC-014 task with no title is blocked', async ({ page, dealDetail }) => {
    await dealDetail.goto(dealUrl());
    await dealDetail.openTaskForm();
    await dealDetail.taskTitle.fill('');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText("Can't be empty")).toBeVisible();
    await expect(dealDetail.taskTitle).toBeVisible(); // form stays open: no task saved
  });

  // ---- Cleanup: delete ONLY entities this run created (guarded by created-entities.json) ----
  test('CLEANUP delete the deal created by this run', async ({ page, dealDetail }) => {
    await dealDetail.deleteViaMenu('deal', dealId, dealUrl(), dealName);
    await expect(page).toHaveURL(/\/crm\/sales\/deals/);
    await page.goto(dealUrl());
    await expect(page.getByText(dealName)).toHaveCount(0);
  });

  test('CLEANUP delete the contact created by this run', async ({ page, dealDetail }) => {
    await dealDetail.deleteViaMenu('contact', contactId, contactUrl(), `${first} ${last}`);
    await expect(page).toHaveURL(/\/crm\/sales\/contacts/);
  });

  test('CLEANUP delete the account created by this run', async ({ page, dealDetail }) => {
    await dealDetail.deleteViaMenu('account', accountId, `/crm/sales/accounts/${accountId}`, accountName);
    await expect(page).toHaveURL(/\/crm\/sales\/accounts/);
  });
});
