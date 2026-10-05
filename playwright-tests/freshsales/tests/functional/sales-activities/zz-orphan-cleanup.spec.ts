import { test } from '@playwright/test';
import { ActivitiesPage } from '../../../pages/sales-activities/ActivitiesPage';
import { pendingSA } from '../../../pages/sales-activities/tracker';

// Deletes ZZ SA tasks that THIS track created in an earlier (failed/cut-off) run and never deleted.
// Only identifiers recorded in this track's created-entities.json are eligible (guard inside deleteTask).
test('CLEANUP orphaned ZZ SA tasks recorded by this suite', async ({ page }) => {
  const orphans = pendingSA('task').filter((t) => t.startsWith('ZZ SA Task'));
  test.skip(orphans.length === 0, 'no orphaned tasks recorded');
  test.setTimeout(120_000 + orphans.length * 30_000);
  const a = new ActivitiesPage(page);
  await a.gotoDashboard();
  await a.filterDue('Tomorrow');
  await page.getByRole('row').filter({ hasText: 'ZZ SA Task' }).first().waitFor({ timeout: 20_000 }).catch(() => {});
  for (const t of orphans) {
    await page.waitForTimeout(1000); // list re-renders after each delete
    if (await a.taskRow(t).count()) await a.deleteTask(t);
  }
});
