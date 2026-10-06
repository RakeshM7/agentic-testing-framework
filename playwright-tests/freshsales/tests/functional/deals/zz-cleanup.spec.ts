import { test, cleanupPendingDeals } from '../../../pages/deals/fixture';

/** Runs last (alphabetical): soft-deletes every deal this track created and has not already deleted. */
test('ZZ cleanup: delete remaining run-created deals (recorded ids only)', async ({ dm }) => {
  test.setTimeout(600_000);
  await cleanupPendingDeals(dm);
});
