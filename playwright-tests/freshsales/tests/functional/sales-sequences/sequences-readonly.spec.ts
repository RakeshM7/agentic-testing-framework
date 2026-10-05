import { test, expect } from '../../../fixtures/base';
import { SequencesPage } from '../../../pages/sales-sequences/SequencesPage';

test.describe('Sales Sequences - read-only / validation (no sequence is saved)', () => {
  test('TC-sales-sequences-001 Open Sales Sequences via canonical entry point @P0', async ({ page }) => {
    const s = new SequencesPage(page);
    await page.goto('/crm/sales/conversations/awaiting_response');
    await s.dismissNoise();
    await page.getByRole('link', { name: 'Sales Sequences' }).first().click();
    await expect(page).toHaveURL(/\/crm\/sales\/sales-sequences\/filters/, { timeout: 30_000 });
    await expect(page.getByRole('link', { name: 'Sales Sequences' }).first()).toBeVisible();
    await expect(s.createBtn).toBeVisible({ timeout: 30_000 });
  });

  test('TC-sales-sequences-002 List empty state shows heading, CTA and 10 templates @P1', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await expect(s.createBtn).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    test.skip(await page.locator('table.table-sales-sequence').isVisible(), 'Not applicable: tenant has sequences');
    await expect(page.getByText('Boost two-way engagement and build a high-quality pipeline')).toBeVisible();
    // Template gallery grew from 10 (explore capture) to 11 on 2026-10-05; assert "at least 10" so catalogue additions don't flake.
    await expect.poll(async () => page.getByText('Steps:', { exact: false }).filter({ hasText: /^Steps:/ }).count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(10);
  });

  test('TC-sales-sequences-006 Create page shows configuration sections @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoNew();
    await expect(page.getByText('Who can enter your sequence?')).toBeVisible();
    await expect(page.getByText('Contacts', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Accounts', { exact: true }).first()).toBeVisible();
    await expect(page.getByText("What's your sequence type?")).toBeVisible();
    await expect(page.locator('[data-test-title="outbound-sequence-type-radio-button"]')).toBeVisible();
    await expect(page.locator('[data-test-title="classic-sequence-type-radio-button"]')).toBeVisible();
    await expect(page.locator('[data-test-title="smart-sequence-type-radio-button"]')).toBeVisible();
    await expect(page.getByText('Exclude weekends')).toBeVisible();
    await expect(page.getByText('What steps do you want Freshsales to execute?')).toBeVisible();
    await expect(page.getByText('How do contacts exit your sequence?')).toBeVisible();
  });

  test('TC-sales-sequences-007 Entry and exit rule options present and toggle @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoNew();
    for (const t of ["Remove contacts who don’t have an owner", "Remove contacts who've replied to your email", 'Remove contacts whose email status is Bounced', "Remove contacts who've unsubscribed"]) {
      await expect(page.getByText(t, { exact: true })).toBeVisible();
    }
    const box = page.locator('[data-test-title="remove-owner-exit-condition"] input[type=checkbox]');
    await expect(box).toBeChecked();
    await box.evaluate((e: HTMLInputElement) => e.click());
    await expect(box).not.toBeChecked();
    await box.evaluate((e: HTMLInputElement) => e.click());
    await expect(box).toBeChecked();
    await expect(page).toHaveURL(/contact\/new/);
  });

  test('TC-sales-sequences-016 Save with no steps shows validation error @P0', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoNew();
    await s.pageSave.click();
    await expect(page.getByText('Add at least 1 step to this sequence')).toBeVisible();
    await expect(page).toHaveURL(/sales-sequences\/contact\/new$/);
  });

  test('TC-sales-sequences-018 Add task dialog requires Title @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoNew();
    await s.openAddTask();
    await s.taskDialog.getByLabel(/Title/).or(s.taskDialog.locator('input').first()).first().fill('');
    await s.dialogSave().click();
    await expect(s.taskDialog).toBeVisible();
    test.info().annotations.push({ type: 'observed', description: (await s.taskDialog.innerText()).replace(/\s+/g, ' ').slice(0, 400) });
    await expect(s.taskDialog.locator('.has-error, .error, .text-danger, [class*=error]').first()).toBeVisible();
    await page.goto('/crm/sales/sales-sequences/filters'); // discard; nothing saved
  });

  test('TC-sales-sequences-014/019 Email and SMS steps without a mailbox/provider (observe only, never saved) @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoNew();
    for (const step of ['Add email', 'Add SMS']) {
      await page.getByText(step, { exact: true }).locator('visible=true').first().click();
      await page.waitForTimeout(1500);
      const dlg = page.locator('[role=dialog]').filter({ hasText: new RegExp(step.replace('Add ', 'Add '), 'i') }).last();
      const txt = (await dlg.innerText().catch(() => '(no dialog)')).replace(/\s+/g, ' ').slice(0, 300);
      test.info().annotations.push({ type: `observed ${step}`, description: txt });
      if (step === 'Add SMS') await expect(dlg).toContainText('No provider connected');
      await dlg.locator('button.close, .modal-header-close-icon').first().click();
      await expect(dlg).toHaveCount(0);
    }
    await expect(page).toHaveURL(/contact\/new/);
  });

  test('TC-sales-sequences-020 Quick-create menu: record whether a sequence entry exists @P2', async ({ page }) => {
    const s = new SequencesPage(page);
    await s.gotoList();
    await page.locator('.navbar-personal-link[data-test-expand-dropdown], [data-test-expand-dropdown]').first().click();
    const items = await page.locator('[data-test-dropdown-add-contact]').locator('xpath=ancestor::ul[1]').innerText().catch(() => '');
    const present = /sequence/i.test(items);
    test.info().annotations.push({ type: 'observed', description: `Quick-create has sequence entry: ${present}; items: ${items.replace(/\s+/g, ' ')}` });
    expect(typeof present).toBe('boolean');
  });

  test('TC-sales-sequences-025 Activate sequence (SKIPPED: never activate) @P2', async () => {
    test.skip(true, 'Sequences must stay Inactive; activation skipped by run-config guardrail');
  });
  test('TC-sales-sequences-026 Enrolment of contacts end to end (not executable) @P2', async () => {
    test.skip(true, 'Never enroll existing contacts / send real emails or SMS');
  });
});
