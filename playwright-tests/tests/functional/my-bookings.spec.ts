import { test, expect } from '../../fixtures/base';

/**
 * /bookings ("My Bookings") coverage from artifacts/eventhub/testcases/app-wide-testcases.md.
 * Runs authenticated (default storageState) as the suite's fixture account, which has zero
 * existing bookings — the empty state is directly observed and stable for this account.
 */

// TC-app-wide-008 — My Bookings empty state renders for an account with zero bookings (P1)
// TC-app-wide-030 — My Bookings empty state exact copy verification (P2)
test('Validate if My Bookings page - loading the page for an account with zero bookings - renders the empty state with exact heading, body copy, and "Browse Events" button', async ({
  page,
  bookingsPage,
}) => {
  // Step 1: Navigate to /bookings.
  await bookingsPage.goto();

  // Step 2: Verify the page heading, subtitle, and "Clear all bookings" button are visible.
  await expect(bookingsPage.heading).toBeVisible();
  await expect(bookingsPage.subtitle).toBeVisible();
  await expect(bookingsPage.clearAllBookingsButton).toBeVisible();

  // Step 3: Verify the empty-state heading, body, and "Browse Events" button are visible.
  await expect(bookingsPage.emptyStateHeading).toBeVisible();
  await expect(bookingsPage.emptyStateBody).toBeVisible();
  await expect(bookingsPage.browseEventsButton).toBeVisible();

  // Step 4: Click "Browse Events" and verify navigation to /events.
  await bookingsPage.browseEventsButton.click();
  await expect(page).toHaveURL('/events');
});

// TC-app-wide-029 — "Clear all bookings" empties the My Bookings list for that account only (P2)
// DO NOT EXECUTE LIVE — destructive bulk action, out of scope for live execution this run (see
// testcases-summary.md's flag table). Written as test.fixme() rather than omitted.
test.fixme(
  'Validate if My Bookings page - clicking "Clear all bookings" - empties the list, showing the "No bookings yet" empty state afterward',
  async ({ bookingsPage }) => {
    // Step 1: Navigate to /bookings.
    await bookingsPage.goto();
    // Step 2: Click "Clear all bookings".
    await bookingsPage.clearAllBookingsButton.click();
    // Step 3 (not executed): Would confirm any resulting dialog and assert the empty state reappears.
    // NOT EXECUTED: this is a destructive bulk action against the live shared demo site, and this
    // account currently has zero bookings to begin with (its only precondition — a completed
    // booking — itself depends on the event-booking suite's own unexecuted "Confirm Booking" flow).
    // Skipped per this run's no-live-mutation constraint.
  }
);
