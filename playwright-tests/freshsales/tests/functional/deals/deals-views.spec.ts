import { test, expect, observe } from '../../../pages/deals/fixture';
import { RUN } from '../../../pages/deals/tracker';

/**
 * Read-only navigation of the Deals module (TC-deals-001..006, 026, 029, 030).
 * Layout, density, page size and filters persist tenant-side, so every test sets what it needs and restores
 * Pipeline layout / the default filter state at the end.
 */
test.describe('Deals views and navigation (read-only)', () => {
  test.afterEach(async ({ dm }) => {
    // Leave the tenant in the layout the other specs expect.
    await dm.gotoList().catch(() => undefined);
    await dm.setLayout('Pipeline').catch(() => undefined);
  });

  test('TC-deals-001 open the Deals pipeline (kanban) view', async ({ page, dm }) => {
    await page.goto('/crm/sales/deals');
    await expect(page).toHaveURL(/\/crm\/sales\/deals\/view\/\d+/);
    await dm.dismissNoise();
    await dm.ensureAllDeals();
    await dm.setLayout('Pipeline');
    await expect(dm.columns).toHaveCount(7);
    for (const stage of ['New', 'Qualification', 'Discovery', 'Demo']) {
      await expect(page.getByText(stage, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByText('Weighted value').first()).toBeVisible();
  });

  test('TC-deals-002 switch between Table, Pipeline, Forecast and Group by', async ({ page, dm }) => {
    await dm.gotoList();
    await dm.setLayout('Pipeline');
    await dm.openLayoutMenu();
    for (const item of ['Table', 'Pipeline', 'Forecast', 'Group by']) await expect(dm.layoutMenuItem(item)).toBeVisible();
    await dm.layoutMenuItem('Table').click();
    await expect(dm.layoutButton).toHaveText('Table');
    for (const col of ['Deal name', 'Products', 'Deal value', 'Deal stage', 'Expected close', 'Sales owner', 'Pipeline', 'Related account', 'Next activity']) {
      await expect(page.getByText(col).first()).toBeVisible();
    }
    await dm.openLayoutMenu();
    await dm.layoutMenuItem('Forecast').click();
    await expect(dm.layoutButton).toHaveText('Forecast');
    await expect(page.getByText('By month', { exact: true })).toBeVisible();
    await expect(page.getByText('By quarter', { exact: true })).toBeVisible();
    await dm.openLayoutMenu();
    await dm.layoutMenuItem('Group by').hover();
    for (const f of ['Forecast category', 'Territory', 'Deal type', 'Sales owner', 'Payment status']) {
      await expect(page.getByText(f, { exact: true }).first()).toBeVisible();
    }
    await page.keyboard.press('Escape');
  });

  test('TC-deals-003 select a saved deal view from the views list', async ({ page, dm }) => {
    await dm.gotoList();
    await dm.openViewsList();
    for (const t of ['All views', 'Default views', 'My views', 'Other views']) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Add new view')).toBeVisible();
    await page.getByText('Won deals', { exact: true }).first().click();
    await expect(page.getByText('Won deals').first()).toBeVisible();
    await dm.openView('Lost deals');
    await expect(page.getByText('Lost deals').first()).toBeVisible();
    await dm.ensureAllDeals();
  });

  test('TC-deals-004 filter deals by Deal stage and Reset', async ({ page, dm }) => {
    await dm.gotoTableAll();
    await page.getByText(/filters? applied/).first().click();
    await expect(page.getByText('Deal stage').first()).toBeVisible();
    for (const s of ['New', 'Qualification', 'Discovery', 'Demo', 'Negotiation']) {
      await expect(page.getByText(s, { exact: true }).first()).toBeVisible();
    }
    await page.getByText('Add filter', { exact: true }).first().click();
    for (const f of ['Deal value', 'Sales owner', 'Forecast category', 'Lost reason', 'Probability']) {
      await expect(page.getByText(f).first()).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await page.getByText('Qualification', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page).toHaveURL(/view\/custom\?.*q/);
    await expect(page.getByText('Reset', { exact: true })).toBeVisible();
    await expect(page.getByText('Save view as')).toBeVisible();
    await page.getByText('Reset', { exact: true }).click();
    await expect(page.getByText('Reset', { exact: true })).toHaveCount(0);
  });

  test('TC-deals-005 closing the filter panel with unapplied changes prompts Apply/Discard', async ({ page, dm }) => {
    await dm.gotoTableAll();
    await page.getByText(/filters? applied/).first().click();
    await page.getByText('Qualification', { exact: true }).first().click();
    await page.getByText(/filters? applied/).first().click();
    await expect(page.getByText("One or more filters have been updated, but they're not applied yet.")).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect(page).not.toHaveURL(/view\/custom/);
  });

  test('TC-deals-006 change table density and rows per page', async ({ page, dm }) => {
    await dm.gotoTableAll();
    const rowHeight = async () => (await dm.gridRows.first().boundingBox())!.height;
    // Density control: the icon-only button left of 'Bulk actions' (no accessible name).
    const bulk = page.getByText('Bulk actions', { exact: true }).first();
    const bb = (await bulk.boundingBox())!;
    const heights: Record<string, number> = {};
    for (const mode of ['Compact', 'Comfortable']) {
      await page.mouse.click(bb.x - 40, bb.y + bb.height / 2);
      await page.getByText(mode, { exact: true }).first().click();
      await page.waitForTimeout(800);
      heights[mode] = await rowHeight();
    }
    observe(`row heights: ${JSON.stringify(heights)}`);
    expect(heights.Compact).toBeLessThan(heights.Comfortable);
    await page.getByText(/^Showing \d+ per page$/).click();
    for (const n of [10, 25, 50, 100]) await expect(page.getByText(`Show ${n} per page`)).toBeVisible();
    await page.getByText('Show 10 per page').click();
    await expect(page.getByText(/Showing 1.10 of \d+/)).toBeVisible();
    // restore the default
    await page.getByText(/^Showing \d+ per page$/).click();
    await page.getByText('Show 25 per page').click();
    await expect(page.getByText(/Showing 1.25 of \d+/)).toBeVisible();
  });

  test('TC-deals-026 open the Deals Settings menu without changing anything', async ({ page, dm }) => {
    await dm.gotoList();
    await page.locator('button:has-text("Settings")').first().click();
    for (const t of ['Set your default pipeline', 'Edit pipeline', 'Create pipeline']) await expect(page.getByText(t)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByText('Create pipeline')).toBeHidden();
  });

  test('TC-deals-029 forecast view totals (observed, unconfirmed O1)', async ({ page, dm }) => {
    await dm.gotoList();
    await dm.setLayout('Forecast');
    await expect(page.getByText('By month', { exact: true })).toBeVisible();
    const header = (await page.locator('body').innerText()).match(/\d+ deals?[^\n]*\$[\d.,]+K?/)?.[0];
    observe(`forecast summary (all deals incl. ZZ ${RUN} deals): ${header ?? 'n/a'}`);
    await page.getByText('By quarter', { exact: true }).click();
    await expect(page.getByText('By quarter', { exact: true })).toBeVisible();
    await page.getByText('By month', { exact: true }).click();
  });

  test('TC-deals-030 group by results (observed)', async ({ page, dm }) => {
    await dm.gotoList();
    for (const field of ['Sales owner', 'Forecast category']) {
      await dm.setLayout('Table');
      await dm.openLayoutMenu();
      await dm.layoutMenuItem('Group by').hover();
      const submenu = page.locator('div')
        .filter({ has: page.getByText('Payment status', { exact: true }) })
        .filter({ has: page.getByText('Territory', { exact: true }) }).last();
      await submenu.getByText(field, { exact: true }).click();
      await expect(dm.addDealButton).toBeVisible();
      await page.waitForTimeout(2_000);
      observe(`group by ${field}: layout button '${await dm.layoutButton.innerText().catch(() => '?')}', ${await page.locator('.ag-row').count()} grid rows`);
      await dm.gotoList();
    }
  });
});
