import { test } from '@playwright/test';
import { ConversationsPage } from '../../../pages/conversations/ConversationsPage';
import { pendingConv } from '../../../pages/conversations/tracker';

// Orphan sweep: deletes templates this track recorded but did not manage to delete (cut-off run). Guarded per row.
test('conversations orphan cleanup (run-created ZZ templates only)', async ({ page }) => {
  test.setTimeout(300_000);
  const pending = pendingConv().map((e) => e.identifier);
  test.skip(pending.length === 0, 'nothing pending');
  await new ConversationsPage(page).cleanupPending(pending);
});
