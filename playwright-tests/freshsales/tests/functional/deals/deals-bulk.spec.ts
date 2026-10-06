import { test, expect, observe } from '../../../pages/deals/fixture';
import { RUN, idOf, markDeleted } from '../../../pages/deals/tracker';
import type { DealsModule } from '../../../pages/deals/DealsModule';

/**
 * Bulk actions on deals (TC-deals-027, 028, 044). Safety: the bulk toolbar's "Bulk actions" button selects EVERY
 * row, so a bulk mutation is only ever issued after verifying that the selected row ids are exactly the ZZ deals
 * this track created (ids resolved from created-entities.json). Anything else aborts the test before the action.
 */
const nameA = `ZZ Bulk A ${RUN}`;
const nameB = `ZZ Bulk B ${RUN}`;

async function ensureDeal(dm: DealsModule, name: string, note: string) {
  return idOf(name) || (await dm.createDeal(name, '5', note));
}
/** Distinct deal ids of the currently selected grid rows (pinned + centre containers repeat a row-id). */
async function selectedIds(dm: DealsModule): Promise<string[]> {
  const ids = await dm.page.locator('.ag-row-selected').evaluateAll((els) => els.map((e) => e.getAttribute('row-id') || ''));
  return [...new Set(ids)].sort();
}
async function tick(dm: DealsModule, id: string) {
  const cb = dm.page.locator(`.ag-row[row-id="${id}"] input[type="checkbox"]`);
  await expect(cb.first()).toHaveCount(1);
  await cb.first().evaluate((e) => (e as HTMLInputElement).click());
}
async function clearSelection(dm: DealsModule) {
  const cancel = dm.page.getByText('Cancel bulk selection', { exact: true });
  if (await cancel.count()) await cancel.first().click();
  await expect.poll(async () => (await selectedIds(dm)).length).toBe(0);
}

test.describe('Deals bulk actions (full-run, ZZ-only selection)', () => {
  test('TC-deals-027 bulk actions offered match the top-bar set for a selected ZZ deal', async ({ page, dm }) => {
    const idA = await ensureDeal(dm, nameA, 'TC-027 bulk A');
    await dm.gotoTableAll();
    await tick(dm, idA);
    expect(await selectedIds(dm)).toEqual([idA]);
    const labels = ['Update field', 'Bulk email', 'Add tags', 'Assign to', 'Delete'];
    await expect(page.getByText('Cancel bulk selection', { exact: true })).toBeVisible();
    for (const l of labels) await expect(page.getByText(l, { exact: true }).first()).toBeVisible();
    observe(`bulk actions shown for 1 selected ZZ deal: ${labels.join(', ')}`);
    await clearSelection(dm);
  });

  test('TC-deals-044 bulk selection must be narrowed to run-created deals', async ({ page, dm }) => {
    const idA = await ensureDeal(dm, nameA, 'TC-044 bulk A');
    const idB = await ensureDeal(dm, nameB, 'TC-044 bulk B');
    await dm.gotoTableAll();
    // Observe only (no action is clicked): the 'Bulk actions' button selects every row on the page.
    await page.getByText('Bulk actions', { exact: true }).first().click();
    const all = await selectedIds(dm);
    observe(`'Bulk actions' button selected ${all.length} rows (unfiltered list)`);
    await expect(page.getByText(/\d+ deals selected\./)).toBeVisible();
    expect(all.length).toBeGreaterThan(2);
    await clearSelection(dm);
    // Narrow to exactly the two ZZ deals by row checkboxes.
    await tick(dm, idA);
    await tick(dm, idB);
    expect(await selectedIds(dm)).toEqual([idA, idB].sort());
    await clearSelection(dm);
  });

  test('TC-deals-028 bulk delete only run-created deals', async ({ page, dm }) => {
    const idA = await ensureDeal(dm, nameA, 'TC-028 bulk A');
    const idB = await ensureDeal(dm, nameB, 'TC-028 bulk B');
    await dm.gotoTableAll();
    await clearSelection(dm);
    await tick(dm, idA);
    await tick(dm, idB);
    const sel = await selectedIds(dm);
    // Hard safety gate: abort unless the selection is exactly the two deals this track created.
    test.skip(JSON.stringify(sel) !== JSON.stringify([idA, idB].sort()), `selection ${JSON.stringify(sel)} is not exactly the two ZZ deals; bulk delete aborted`);
    // Second gate: no 'N deals selected.' select-all banner (that message only appears for select-all).
    await expect(page.getByText(/\d+ deals selected\./)).toHaveCount(0);
    await expect(page.locator('.ag-row-selected')).toHaveCount(4); // 2 rows x (pinned + centre container)
    for (const id of sel) {
      await expect(dm.gridRows.filter({ has: page.locator(`[row-id="${id}"]`) }).or(page.locator(`.ag-row[row-id="${id}"]`)).first()).toContainText('ZZ Bulk');
    }
    await page.getByText('Delete', { exact: true }).first().click();
    await expect(page.getByText(/delete/i).last()).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('bulk-delete-confirm.png') });
    await page.getByRole('button', { name: /^(Yes|Delete|Confirm)/ }).last().click();
    markDeleted(idA, true);
    markDeleted(idB, true);
    await dm.gotoTableAll();
    await expect(page.locator(`.ag-row[row-id="${idA}"]`)).toHaveCount(0);
    await expect(page.locator(`.ag-row[row-id="${idB}"]`)).toHaveCount(0);
    // Pre-existing deals are untouched.
    await expect(dm.gridRows.filter({ hasText: 'Acme Inc (sample)' }).first()).toBeVisible();
  });
});
