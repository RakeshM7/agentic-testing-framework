import { test, expect, observe } from '../../../pages/deals/fixture';
import { RUN, idOf } from '../../../pages/deals/tracker';
import type { DealsModule } from '../../../pages/deals/DealsModule';

/**
 * Deals validation, negative and boundary cases (TC-deals-031, 032, 033, 035, 037, 041, 042, 043).
 * Every deal created (even by a case expected to be rejected) is recorded the moment the app lands on it.
 */

/** Saves the open Add deal form and reports whether the app accepted it (landed on a new detail page). */
async function saveAndReport(dm: DealsModule, name: string, note: string): Promise<{ saved: boolean; id: string }> {
  await dm.saveButton.click();
  const accepted = await dm.page.waitForURL(/\/crm\/sales\/deals\/\d+$/, { timeout: 8_000 }).then(() => true, () => false);
  if (!accepted) return { saved: false, id: '' };
  return { saved: true, id: await dm.captureCreated(name, note) };
}
async function closeAddForm(dm: DealsModule) {
  const cancel = dm.modal.getByRole('button', { name: 'Cancel' });
  if (await cancel.count()) await cancel.first().click();
}

test.describe('Deals validation (full-run, live)', () => {
  test('TC-deals-032 create deal with an empty Deal name is blocked', async ({ page, dm }) => {
    await dm.gotoLayout('Pipeline');
    await dm.openAddDeal();
    await dm.saveButton.click();
    // Explore saw a 'Review 1 field for errors' banner; live it did not render here, so only the inline error is asserted.
    await expect(dm.modal.getByText("Can't be empty")).toBeVisible();
    await expect(page).not.toHaveURL(/\/crm\/sales\/deals\/\d+$/);
    await closeAddForm(dm);
  });

  // Defect candidate (C1): spec says a negative Deal value must be rejected; the tenant accepts it ("$-5").
  test('TC-deals-031 negative Deal value is rejected on create (defect candidate C1)', async ({ dm }) => {
    test.fail(true, 'Defect candidate C1: tenant accepts Deal value -5 although the human-confirmed rule (B1) says it must be rejected');
    await dm.gotoLayout('Pipeline');
    await dm.openAddDeal();
    await dm.nameInput.fill(`ZZ Deal neg ${RUN}`);
    await dm.valueInput.fill('-5');
    const r = await saveAndReport(dm, `ZZ Deal neg ${RUN}`, 'TC-031 negative value');
    if (r.saved) observe(`Negative value accepted (deal ${r.id}) - contradicts B1`);
    else await closeAddForm(dm);
    expect(r.saved, 'a negative Deal value must not create a deal').toBe(false);
  });

  test('TC-deals-033 Lost with an empty Lost reason (config-dependent)', async ({ page, dm }) => {
    const name = `ZZ Deal 033 ${RUN}`;
    const id = idOf(name) || (await dm.createDeal(name, '10', 'TC-033'));
    await dm.gotoDetail(id);
    await dm.chooseWonLost('Lost');
    await dm.modal.getByRole('button', { name: 'Save', exact: true }).click();
    const saved = await expect(dm.toast('Deal updated.')).toBeVisible({ timeout: 6_000 }).then(() => true, () => false);
    if (saved) {
      // Lost reason is optional in this tenant's Deal forms (C2): case is not applicable, rule not asserted.
      test.info().annotations.push({ type: 'not-applicable', description: 'Lost reason is optional in this tenant (explore observation confirmed); mandatory-rule check not applicable' });
      await expect(page.getByText('Closed today').first()).toBeVisible();
    } else {
      await expect(dm.modal).toBeVisible();
      await expect(dm.modal.getByText(/lost reason/i).first()).toBeVisible();
    }
  });

  test('TC-deals-035 add task with an empty title is blocked', async ({ page, dm }) => {
    const name = `ZZ Deal 035 ${RUN}`;
    const id = idOf(name) || (await dm.createDeal(name, '10', 'TC-035'));
    await dm.gotoDetail(id);
    await page.getByRole('button', { name: 'Task', exact: true }).first().click();
    await expect(page.locator('input[name="title"]')).toBeVisible();
    await dm.saveButton.click();
    await expect(dm.modal.getByText("Can't be empty")).toBeVisible();
    await expect(page).not.toHaveURL(/tab=recent-activities\.tasks/);
  });

  test('TC-deals-037 commit a deal with no Expected close date (unconfirmed, observed)', async ({ page, dm }) => {
    const name = `ZZ Deal 037 ${RUN}`;
    const id = idOf(name) || (await dm.createDeal(name, '10', 'TC-037'));
    await dm.gotoDetail(id);
    await expect(page.getByText('Expected close date').first()).toBeVisible();
    await dm.openCommit();
    // Live behaviour differs from the case: the modal pre-selects a date, so a deal with no Expected close date
    // cannot be committed "without a date"; Commit with the default selection succeeds.
    const radios = dm.modal.locator('input[name="contextualDatePicker"]');
    const checked = await radios.evaluateAll((els) => (els as HTMLInputElement[]).map((e) => e.checked));
    observe(`commit modal radios checked by default: ${JSON.stringify(checked)}`);
    await dm.modal.getByRole('button', { name: 'Commit', exact: true }).click();
    const committed = await expect(dm.toast('You committed the deal.')).toBeVisible({ timeout: 6_000 }).then(() => true, () => false);
    observe(committed ? 'Commit succeeded with the pre-selected date (case expectation "blocked" does not hold; O3 unconfirmed)' : 'Commit blocked');
    if (committed) await expect(page.getByText('Committed').first()).toBeVisible();
  });

  test('TC-deals-041 deal name length boundary probe (observed)', async ({ dm }) => {
    for (const [label, name] of [['3 chars', 'ZZx'], ['255 chars', 'ZZ' + 'a'.repeat(253)], ['256 chars', 'ZZ' + 'a'.repeat(254)]] as const) {
      await dm.gotoLayout('Pipeline');
      await dm.openAddDeal();
      await dm.nameInput.fill(name);
      await dm.valueInput.fill('1');
      const r = await saveAndReport(dm, name.length > 20 ? `ZZ long name ${label}` : name, `TC-041 ${label}`);
      observe(`name ${label}: ${r.saved ? 'accepted' : 'rejected / not saved'}`);
      if (!r.saved) await closeAddForm(dm);
    }
  });

  test('TC-deals-042 deal value boundary probe (observed)', async ({ page, dm }) => {
    expect(RUN).toBeTruthy();
    for (const [name, value] of [[`ZZ Value 0 ${RUN}`, '0'], [`ZZ Value dec ${RUN}`, '99.99'], [`ZZ Value big ${RUN}`, '999999999999']] as const) {
      await dm.gotoLayout('Pipeline');
      await dm.openAddDeal();
      await dm.nameInput.fill(name);
      await dm.valueInput.fill(value);
      const r = await saveAndReport(dm, name, `TC-042 value ${value}`);
      if (r.saved) {
        const header = await page.locator('h1, h2, .deal-name, [class*=title]').filter({ hasText: name }).first().locator('xpath=ancestor::*[3]').innerText().catch(() => '');
        observe(`value ${value}: accepted; header text: ${header.replace(/\s+/g, ' ').slice(0, 120)}`);
      } else {
        observe(`value ${value}: rejected / not saved`);
        await closeAddForm(dm);
      }
      if (value === '0') expect(r.saved, 'value 0 (the default) must save').toBe(true);
    }
  });

  test('TC-deals-043 probability range probe: field absent from the Edit deal form (observed)', async ({ page, dm }) => {
    const name = `ZZ Deal 043 ${RUN}`;
    const id = idOf(name) || (await dm.createDeal(name, '10', 'TC-043'));
    await dm.gotoDetail(id);
    await dm.kebabAction('Edit');
    await expect(dm.nameInput).toBeVisible();
    // Probability is not on this tenant's Edit deal layout (field search finds nothing); exposing it needs an
    // admin Deal forms change, which is out of scope. The range cannot be probed through the UI.
    const searchBox = page.getByPlaceholder('Search for a field');
    if (await searchBox.count()) {
      await searchBox.fill('Probab');
      await expect(page.getByText('No results found.')).toBeVisible();
    }
    await expect(dm.probabilityInput).toBeHidden();
    observe('Probability field not present on Edit deal form; range (0-100, O7) not probed');
    await closeAddForm(dm);
  });
});
