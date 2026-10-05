import { test, expect } from '../../fixtures/base';
import { recordCreatedEntity, RUN_ID } from '../../utils/createdEntities';

// TC-009..TC-013: validation-only negatives. They run live (clarification Q7b) and must not create records,
// except where the app accepts the input (then the created record is tracked and flagged).
test.describe('Form validation (live)', () => {
  test('TC-009 contact creation blocked when required field (email) missing', async ({ page, contactsPage }) => {
    await contactsPage.goto();
    await contactsPage.openAddContact();
    await contactsPage.fill({ first: 'AgentTest', last: `NoEmail${RUN_ID}` });
    await contactsPage.drawerSave.click();
    await expect(contactsPage.emailError('You need to fill this field')).toBeVisible();
    await expect(contactsPage.email).toBeVisible(); // drawer stays open: nothing was saved
    await expect(page).toHaveURL(/\/crm\/sales\/contacts\/view\//);
  });

  test('TC-010 contact with invalid email is rejected', async ({ page, contactsPage }) => {
    await contactsPage.goto();
    await contactsPage.openAddContact();
    await contactsPage.fill({ first: 'AgentTest', last: `BadEmail${RUN_ID}`, email: 'not-an-email' });
    await contactsPage.drawerSave.click();
    await expect(contactsPage.emailError('Enter a valid email address')).toBeVisible();
    await expect(page).toHaveURL(/\/crm\/sales\/contacts\/view\//);
  });

  test('TC-011 contact with invalid phone: observed behaviour recorded', async ({ page, contactsPage, contactDetail }) => {
    await contactsPage.goto();
    await contactsPage.openAddContact();
    const last = `BadPhone${RUN_ID}`;
    await contactsPage.fill({ first: 'AgentTest', last, email: `agenttest.phone.${RUN_ID}@example.com`, mobile: 'abc!!' });
    await contactsPage.drawerSave.click();
    // OBSERVED (flagged, not asserted as a defect): the app does NOT block 'abc!!'. It creates the contact and
    // silently drops the invalid mobile value (Mobile stays 'Click to add'). Track the created record.
    await expect(page).toHaveURL(/\/crm\/sales\/contacts\/\d+$/);
    recordCreatedEntity({
      type: 'contact', identifier: contactDetail.idFromUrl(), url: page.url(),
      createdAt: new Date().toISOString(), note: `AgentTest ${last} (TC-011; invalid phone accepted, value discarded)`,
    });
    await expect(page.getByText('abc!!')).toHaveCount(0);
  });

  test('TC-012 deal with empty name is blocked', async ({ page, dealsPage }) => {
    await dealsPage.goto();
    await dealsPage.openAddDeal();
    await dealsPage.dealName.fill('');
    await dealsPage.dealValue.fill('100');
    await dealsPage.drawerSave.click();
    await expect(page.getByText("Can't be empty")).toBeVisible();
    await expect(dealsPage.dealName).toBeVisible(); // drawer stays open: no deal saved
    await expect(page).toHaveURL(/\/crm\/sales\/deals\/view\//);
  });

  test('TC-013 deal with non-numeric amount is blocked or rejected', async ({ page, dealsPage }) => {
    await dealsPage.goto();
    await dealsPage.openAddDeal();
    await dealsPage.dealName.fill(`AgentTest BadAmount ${RUN_ID}`);
    await dealsPage.dealValue.fill('abc');
    // OBSERVED: the amount input filters out non-numeric characters (typing 'abc' leaves it empty), so the
    // submission is then blocked by the required Deal value rule.
    await expect(dealsPage.dealValue).toHaveValue('');
    await dealsPage.drawerSave.click();
    await expect(page.getByText("Can't be empty")).toBeVisible();
    await expect(page).toHaveURL(/\/crm\/sales\/deals\/view\//);
  });
});
