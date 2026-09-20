import { test, expect } from '../../fixtures/base';

/**
 * /bookings ("My Bookings") coverage from artifacts/eventhub/testcases/app-wide-testcases.md.
 * Runs authenticated (default storageState) as the suite's fixture account, which has zero
 * existing bookings — the empty state is directly observed and stable for this account.
 */

// TC-app-wide-008 — My Bookings empty state renders for an account with zero bookings (P1)
// TC-app-wide-030 — My Bookings empty state exact copy verification (P2)
test('empty state renders with exact heading, body copy, and "Browse Events" button', async ({
  page,
  bookingsPage,
}) => {
  await bookingsPage.goto();

  await expect(bookingsPage.heading).toBeVisible();
  await expect(bookingsPage.subtitle).toBeVisible();
  await expect(bookingsPage.clearAllBookingsButton).toBeVisible();

  await expect(bookingsPage.emptyStateHeading).toBeVisible();
  await expect(bookingsPage.emptyStateBody).toBeVisible();
  await expect(bookingsPage.browseEventsButton).toBeVisible();

  await bookingsPage.browseEventsButton.click();
  await expect(page).toHaveURL('/events');
});

// TC-app-wide-029 — "Clear all bookings" empties the My Bookings list for that account only (P2)
// DO NOT EXECUTE LIVE — destructive bulk action, out of scope for live execution this run (see
// testcases-summary.md's flag table). Written as test.fixme() rather than omitted.
test.fixme(
  '"Clear all bookings" empties the list, showing the "No bookings yet" empty state afterward',
  async ({ bookingsPage }) => {
    await bookingsPage.goto();
    await bookingsPage.clearAllBookingsButton.click();
    // Would then confirm any resulting dialog and assert the empty state reappears.
    // NOT EXECUTED: this is a destructive bulk action against the live shared demo site, and this
    // account currently has zero bookings to begin with (its only precondition — a completed
    // booking — itself depends on the event-booking suite's own unexecuted "Confirm Booking" flow).
    // Skipped per this run's no-live-mutation constraint.
  }
);
