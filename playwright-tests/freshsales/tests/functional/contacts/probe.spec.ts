import { test } from '../../../fixtures/base';
test.use({ actionTimeout: 6000 });
test('probe', async ({ page, contactsPage }) => {
  test.setTimeout(90000);
  await page.goto('/crm/sales/contacts/402221039668'); await page.waitForTimeout(3000);
  await contactsPage.dismissNoise();
  await page.getByText('Add a note...').click();
  await page.keyboard.type('hello note');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: '/private/tmp/claude-501/p2.png' });
  console.log(await page.evaluate(() => [...document.querySelectorAll('button,[contenteditable=true],textarea')].filter((e:any)=>e.offsetParent).map((e:any)=>e.tagName+':'+e.innerText.trim().slice(0,30)+':'+e.className.toString().slice(0,40)).slice(-8)));
  await contactsPage.goto();
  await page.waitForSelector('.ag-row[row-id="402221039668"]');
  const row = page.locator('.ag-row[row-id="402221039668"]');
  console.log('rows', await row.count());
  for (const r of await row.all()) console.log(await r.evaluate(e=>[...e.querySelectorAll('[role=button],button,[data-tracker-id]')].map((x:any)=>x.tagName+'|'+x.getAttribute('data-tracker-id')+'|'+x.getAttribute('aria-label')+'|'+x.className.toString().slice(0,20))));
});
