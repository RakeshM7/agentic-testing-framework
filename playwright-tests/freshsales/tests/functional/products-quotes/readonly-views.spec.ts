import { test, expect, observe } from '../../../pages/products-quotes/PQ';

/**
 * Non-mutating Products / CPQ Settings / Document Templates / Quotes list coverage
 * (TC-products-quotes-001, 007-011, 027-030, 042). Nothing is saved, selected or changed.
 */
test.setTimeout(120_000);

test.describe('Products and Quotes: read-only views', () => {
  test('TC-products-quotes-001 Products list shows columns and sample products', async ({ page, pq }) => {
    await pq.gotoProducts();
    await expect(page.getByText('Products', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('All Products', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/\(\d+\)/).first()).toBeVisible();
    const head = page.locator('table thead');
    for (const col of [/^\s*name\s*$/i, /^\s*active\s*$/i, /base currency am/i, /^\s*category\s*$/i, /^\s*created at\s*$/i, /^\s*created by\s*$/i]) {
      await expect(head.getByText(col).first()).toBeVisible();
    }
    for (const n of ['Annual maintenance contract (sample)', 'CRM - Gold plan monthly (sample)', 'CRM - Platinum plan monthly (sample)']) {
      await expect(pq.productLink(n)).toBeVisible();
    }
    expect(await pq.rowCells('CRM - Gold plan monthly (sample)')).toContain('$100');
    expect(await pq.rowCells('CRM - Platinum plan monthly (sample)')).toContain('$150');
    expect(await pq.rowCells('Annual maintenance contract (sample)')).toContain('$2,000');
  });

  test('TC-products-quotes-007 toolbar menus: Add product arrow, gear, row kebab', async ({ page, pq }) => {
    await pq.gotoProducts();
    const bb = (await pq.addProductButton.boundingBox())!;
    await page.mouse.click(bb.x + bb.width + 14, bb.y + bb.height / 2);
    await expect(pq.dropdown.getByText('Import products', { exact: true })).toBeVisible();
    await expect(pq.dropdown.getByText('Import history', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.click(500, 700);
    await expect(pq.dropdown).toBeHidden();
    await page.mouse.click(1310, 124);
    await expect(pq.dropdown.getByText('Pricing settings', { exact: true })).toBeVisible();
    await expect(pq.dropdown.getByText('Customize Product fields', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.click(500, 700);
    await expect(pq.dropdown).toBeHidden();
    // Row kebab of a sample product (opened only to read the items, closed without choosing).
    const row = pq.productLink('CRM - Gold plan monthly (sample)');
    const rb = (await row.boundingBox())!;
    await page.mouse.move(rb.x + 600, rb.y + rb.height / 2);
    await page.mouse.click(1406, rb.y + rb.height / 2);
    await expect(pq.dropdown.getByText('Clone', { exact: true })).toBeVisible();
    await expect(pq.dropdown.getByText('Delete', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.mouse.click(500, 700);
    await expect(pq.productLink('CRM - Gold plan monthly (sample)')).toBeVisible();
  });

  test('TC-products-quotes-008 Filters panel opens with empty state', async ({ page, pq }) => {
    await pq.gotoProducts();
    await page.getByRole('button', { name: 'Filters' }).click();
    await expect(page.getByText('Add filter', { exact: true })).toBeVisible();
    await expect(page.getByText('Add filters to narrow down the products you want to see.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply', exact: true })).toBeDisabled();
  });

  test('TC-products-quotes-009 Products list filtered by Category', async ({ page, pq }) => {
    // The Filters panel offers only an empty 'Add filter' state in the explore capture; the category narrowing is the
    // 'All categories' toolbar dropdown (UNCONFIRMED which control the case intended), so that is what is exercised.
    await pq.gotoProducts();
    await page.getByRole('button', { name: 'All categories' }).click();
    for (const c of ['Consumables', 'Hardware', 'Software', 'Maintenance', 'Setup', 'Training', 'Unassigned']) {
      await expect(pq.dropdown.getByText(c, { exact: true })).toBeVisible();
    }
    await pq.dropdown.getByText('Software', { exact: true }).click();
    await expect(pq.productLink('CRM - Gold plan monthly (sample)')).toBeVisible();
    await expect(pq.productLink('CRM - Platinum plan monthly (sample)')).toBeVisible();
    await expect(pq.productLinks('Annual maintenance contract (sample)')).toHaveCount(0);
    // Restore so the persisted toolbar state is not left narrowed.
    await page.getByRole('button', { name: 'Software' }).first().click();
    await pq.dropdown.getByText('All categories', { exact: true }).click();
    await expect(pq.productLink('Annual maintenance contract (sample)')).toBeVisible();
  });

  test('TC-products-quotes-010 CPQ Settings opens from the gear menu and is read-only reviewed', async ({ page, pq }) => {
    await pq.gotoProducts();
    await page.mouse.click(1310, 124);
    await pq.dropdown.getByText('Pricing settings', { exact: true }).click();
    await expect(page).toHaveURL(/\/crm\/sales\/settings\/cpq$/);
    await expect(page.getByRole('heading', { name: 'CPQ Settings' })).toBeVisible();
    for (const h of ['Products', 'Taxes', 'Quotes', 'Pricing settings', 'Add products to deals', 'Include tax in deal value', 'Quote types']) {
      await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('radio', { name: 'Both' })).toBeChecked();
    await expect(page.getByText('Sales tax', { exact: true })).toBeVisible();
    for (const t of ['Quote', 'Proposal', 'Non-disclosure agreement', 'Master service agreement']) {
      await expect(page.locator('input').evaluateAll((els, v) => els.some((e) => (e as HTMLInputElement).value === v), t)).resolves.toBe(true);
    }
    await expect(page.getByText('Add Quote type')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
  });

  test('TC-products-quotes-042 CPQ Settings pricing radios are disabled', async ({ page }) => {
    await page.goto('/crm/sales/settings/cpq');
    await expect(page.getByRole('heading', { name: 'CPQ Settings' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'One-time pricing' })).toBeDisabled();
    await expect(page.getByRole('radio', { name: 'Subscription pricing' })).toBeDisabled();
    const both = page.getByRole('radio', { name: 'Both' });
    await expect(both).toBeChecked();
    await expect(both).toBeDisabled();
    // Attempting to click a disabled radio must not change anything; force avoids waiting for enabled state.
    await page.getByRole('radio', { name: 'One-time pricing' }).click({ force: true, trial: true }).catch(() => undefined);
    await expect(both).toBeChecked();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    observe('Reason the radios are disabled (plan or permission) is UNCONFIRMED; only the disabled state is asserted.');
  });

  test('TC-products-quotes-011 Document Templates list shows the sample templates', async ({ page, pq }) => {
    await pq.gotoTemplates();
    await expect(page.getByRole('heading', { name: 'Document Templates' })).toBeVisible();
    for (const col of ['Name', 'Quote type', 'Created by', 'Updated by']) {
      await expect(page.getByText(col, { exact: true }).first()).toBeVisible();
    }
    const sample = page.getByRole('row').filter({ hasText: 'Sample Template' });
    await expect(sample.first()).toContainText('Quote');
    await expect(page.getByRole('row').filter({ hasText: 'Sample Signature Template' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'All Quote types' })).toBeVisible();
  });

  test('TC-products-quotes-027 Quotes list shows header, columns and pre-existing drafts', async ({ page, pq }) => {
    await pq.gotoQuotes();
    await expect(page.getByText('My Quotes', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add quote', exact: true })).toBeVisible();
    for (const col of [/quote name/i, /primary contact/i, /quote stage/i, /created at/i]) {
      await expect(page.locator('table thead').getByText(col).first()).toBeVisible();
    }
    await expect(page.getByText(/Quote for Widgetz/).first()).toBeVisible();
    await expect(page.getByText(/Quote for Techcave/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Filters/ })).toBeVisible();
    await expect(page.getByText('Draft').first()).toBeVisible();
  });

  test('TC-products-quotes-028 Quotes has no left-nav entry; reachable via + menu and URL', async ({ page, pq }) => {
    await page.goto('/crm/sales/deals');
    await pq.dismissNoise();
    const nav = page.locator('nav, .navbar-left, [class*="sidebar"]').first();
    for (const item of ['Dashboards', 'Contacts', 'Accounts', 'Deals', 'Conversations', 'Analytics', 'Admin Settings']) {
      await expect(page.locator(`li[title="${item}"], [aria-label="${item}"], li:has(> a[href*="${item === 'Admin Settings' ? 'settings' : item.toLowerCase()}"])`).first()).toBeAttached();
    }
    await expect(page.locator('a[href*="cpq_documents"]').filter({ visible: true })).toHaveCount(0);
    void nav;
    await pq.openPlusMenu();
    await expect(page.getByText('Add Quote', { exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await pq.gotoQuotes();
    await expect(page).toHaveURL(/cpq_documents\/view\/402015942782/);
  });

  test('TC-products-quotes-029 Quotes list Filters, Edit columns and sorting open without data changes', async ({ page, pq }) => {
    await pq.gotoQuotes();
    await page.getByRole('button', { name: /Filters/ }).click();
    await expect(page.getByText('Filters', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Edit columns' }).click();
    await expect(page.getByText('Choose your columns')).toBeVisible();
    await expect(page.getByText('Visible columns')).toBeVisible();
    // Toggle one optional column and Cancel: nothing is saved.
    await page.getByText('Quote number', { exact: true }).click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Choose your columns')).toBeHidden();
    observe('Edit columns toggle and column-header sort behaviour are UNVERIFIED; only that the controls open is asserted.');
  });

  test('TC-products-quotes-030 Quotes list gear: Manage Quote types, templates, Customize fields', async ({ page, pq }) => {
    await pq.gotoQuotes();
    const gear = page.locator('button.fsa-icon-button').filter({ visible: true }).nth(1);
    await gear.click();
    for (const item of ['Manage Quote templates', 'Manage Quote types', 'Customize Quote fields']) {
      await expect(pq.dropdown.getByText(item, { exact: true })).toBeVisible();
    }
    await pq.dropdown.getByText('Manage Quote types', { exact: true }).click();
    await expect(page).toHaveURL(/\/crm\/sales\/settings\//);
    observe(`Manage Quote types destination: ${new URL(page.url()).pathname}`);
    await pq.gotoQuotes();
    await page.locator('button.fsa-icon-button').filter({ visible: true }).nth(1).click();
    await pq.dropdown.getByText('Customize Quote fields', { exact: true }).click();
    await expect(page).toHaveURL(/\/crm\/sales\/settings\//);
    observe(`Customize Quote fields destination: ${new URL(page.url()).pathname}`);
  });
});
