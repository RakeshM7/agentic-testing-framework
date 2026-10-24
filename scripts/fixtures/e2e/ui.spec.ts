// Copied by scripts/e2e.mjs into tests/ui/e2e/ of the demo product (D-084): the rendered UI fixtures, run in a real
// browser against the demo app (scripts/fixtures/demo-app/server.mjs).
import { test, expect } from '../../../fixtures/ui/base';
import { recordCreated, recordDeleted } from '../../../utils/shared/ledger';

test('E2E-UI-1 lists the pre-existing contact', async ({ page }) => {
  await page.goto('/contacts');
  await expect(page.getByRole('cell', { name: 'Pre Existing', exact: true })).toBeVisible();
});

test('E2E-UI-2 readonly: a destructive click reaches nothing', async ({ page }) => {
  test.skip(process.env.ATF_MODE === 'full-run', 'readonly only');
  await page.goto('/contacts');
  const failed = page.waitForEvent('requestfailed', (r) => r.method() === 'DELETE');
  await page.getByRole('button', { name: 'Delete Pre Existing' }).click();
  expect((await failed).failure()?.errorText).toContain('BLOCKED_BY_CLIENT');
  await expect(page.getByRole('status')).toHaveText('Delete failed');
});

test('E2E-UI-3 creates its own contact, records it by its id and deletes it @mutates', async ({ page }) => {
  await page.goto('/contacts');
  await page.getByLabel('Name').fill('Made By E2E');
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/api/contacts'));
  await page.getByRole('button', { name: 'Save' }).click();
  const { id } = await (await created).json();
  const entity = { type: 'contact', ref: String(id), module: 'contacts' };
  recordCreated(entity);
  await expect(page.getByRole('cell', { name: 'Made By E2E', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Made By E2E' }).click();
  await expect(page.getByRole('status')).toHaveText('Deleted');
  await expect(page.getByRole('cell', { name: 'Made By E2E', exact: true })).toHaveCount(0);
  recordDeleted(entity);
});

test('E2E-UI-4 the ledger guard refuses to delete a contact this run did not create @mutates', async ({ page }) => {
  test.fail(true, 'the guard fails this test when it ends (D-074)');
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'Delete Pre Existing' }).click();
  await expect(page.getByRole('status')).toHaveText('Delete failed');
});
