import { test, expect, EVENTS } from '../../fixtures/base';

/**
 * /admin/events ("Manage Events") coverage from artifacts/eventhub/testcases/app-wide-testcases.md.
 * Runs authenticated (default storageState) as this suite's admin-capable fixture account.
 *
 * Per this run's non-mutation stance (reinforced by an explicit orchestrator-level refusal — see
 * the clarifications doc's "Orchestrator-level non-execution override (item 10)" section — of a
 * run-config request to execute the 6-event/FIFO-eviction flow live), this suite never submits
 * the "+ New Event" form. TC-app-wide-031 through 037 are all written as test.fixme() below.
 */

// TC-app-wide-009 — Admin "All Events" table lists all 3 seeded events with correct field values (P2)
// TC-app-wide-038 — Seeded/Featured events show "Read-only" with no Edit/Delete controls (P1)
test('Validate if Admin Events page - viewing the "All Events" table - shows all 3 seeded events with correct Category/City/Date/Price and "Read-only" Actions', async ({
  adminEventsPage,
}) => {
  // Step 1: Navigate to the /admin/events page as the admin-capable fixture account.
  await adminEventsPage.goto();

  // Step 2: Verify the "All Events" table lists exactly the 3 seeded events.
  await expect(adminEventsPage.tableRows).toHaveCount(3);

  // Step 3: Read the row values for "Dilli Diwali Mela" and verify Category/City/Date/Price/Actions/Seats.
  const dilliDiwali = await adminEventsPage.getRowValues(EVENTS.DILLI_DIWALI_MELA.title);
  expect(dilliDiwali.category).toBe('Festival');
  expect(dilliDiwali.city).toBe('Delhi');
  expect(dilliDiwali.date).toBe('20 Oct 2026');
  expect(dilliDiwali.price).toBe('$300');
  expect(dilliDiwali.actions).toBe('Read-only');
  // Seats is a live, shared-site counter (changes as other testers book tickets) — assert shape,
  // not an exact figure, same caution as the visual-regression spec's seat-count mask.
  expect(dilliDiwali.seats).toMatch(/^[\d,]+\/10,?000$/);

  // Step 4: Read the row values for "Hollywood Monsoon Night" and verify the same fields.
  const hollywood = await adminEventsPage.getRowValues(EVENTS.HOLLYWOOD_MONSOON_NIGHT.title);
  expect(hollywood.category).toBe('Concert');
  expect(hollywood.city).toBe('Los Angeles');
  expect(hollywood.date).toBe('12 Jul 2026');
  expect(hollywood.price).toBe('$2,500');
  expect(hollywood.actions).toBe('Read-only');
  expect(hollywood.seats).toMatch(/^[\d,]+\/3,?000$/);

  // Step 5: Read the row values for "World Tech Summit" and verify the same fields.
  const worldTech = await adminEventsPage.getRowValues(EVENTS.WORLD_TECH_SUMMIT.title);
  expect(worldTech.category).toBe('Conference');
  expect(worldTech.city).toBe('Hyderabad');
  expect(worldTech.date).toBe('18 Apr 2026');
  expect(worldTech.price).toBe('$1,500');
  expect(worldTech.actions).toBe('Read-only');
  expect(worldTech.seats).toMatch(/^[\d,]+\/500$/);
});

// TC-app-wide-010 — Admin nav item and /admin/events route are reachable for the admin-capable
// account (P1)
test('Validate if Events Listing page - clicking Admin nav dropdown "Manage Events" - navigates to /admin/events showing the "+ New Event" form and "All Events" table', async ({
  page,
  eventsListingPage,
  adminEventsPage,
}) => {
  // Step 1: Navigate to the /events listing page as the admin-capable fixture account.
  await eventsListingPage.goto();

  // Step 2: Open the "Admin" nav dropdown.
  await page.getByRole('button', { name: 'Admin' }).click();
  // Step 3: Click "Manage Events" (scoped to <nav> since the same link also appears in the footer).
  await page.locator('nav').getByRole('link', { name: 'Manage Events' }).click();

  // Step 4: Verify the URL is /admin/events.
  await expect(page).toHaveURL('/admin/events');
  // Step 5: Reload and verify the route responds with a 2xx status (no redirect, no 403).
  const response = await page.reload();
  expect(response?.ok(), 'expected /admin/events to respond with a 2xx status (no redirect, no 403)').toBe(true);

  // Step 6: Verify the "+ New Event" form and its fields render.
  await expect(adminEventsPage.form).toBeVisible();
  await expect(adminEventsPage.titleInput).toBeVisible();
  await expect(adminEventsPage.addEventButton).toBeVisible();
  // Step 7: Verify the "All Events" table renders with 3 rows.
  await expect(adminEventsPage.tableRows).toHaveCount(3);
});

/**
 * TC-app-wide-031 through TC-app-wide-037 — Admin "+ New Event" form field validation (Price,
 * Total Seats, Event Date & Time, Image URL, required-fields) and the 6-event-max /
 * 7th-event-FIFO-eviction boundary pair.
 *
 * DO NOT EXECUTE LIVE for all seven — any submission of "+ Add Event" (positive or negative data)
 * is out of scope this run, and TC-036/037 specifically carry the orchestrator's explicit refusal
 * of the run-config's request to execute the FIFO-eviction flow live. Written as test.fixme()
 * rather than omitted, per testcases-summary.md's flag table.
 */
test.describe('"+ New Event" form — field validation (not executed live)', () => {
  // TC-app-wide-031 — Price field validation (P2)
  test.fixme('Validate if Admin Events page - submitting "+ New Event" with Price "0" or negative - is rejected with a validation error and no event created', async ({
    adminEventsPage,
  }) => {
    // Step 1: Navigate to /admin/events.
    await adminEventsPage.goto();
    // Step 2 (not executed): Would fill Title/Category/City/Venue/Event Date & Time/Total Seats
    // validly, Price="-10".
    // Step 3 (not executed): Would click "+ Add Event" and assert a Price-field validation error
    // with no row added.
    // NOT EXECUTED: any "+ Add Event" submission is out of scope this run.
  });

  // TC-app-wide-032 — Total Seats field validation (P2)
  test.fixme(
    'Validate if Admin Events page - submitting "+ New Event" with Total Seats "0", negative, or non-integer - is rejected with a validation error and no event created',
    async ({ adminEventsPage }) => {
      // Step 1: Navigate to /admin/events.
      await adminEventsPage.goto();
      // Step 2 (not executed): Would fill the form with an invalid Total Seats value, submit, and
      // assert a Total-Seats-field validation error with no row added.
      // NOT EXECUTED: any "+ Add Event" submission is out of scope this run.
    }
  );

  // TC-app-wide-033 — Event Date & Time field, past-date input (P2)
  test.fixme('Validate if Admin Events page - submitting "+ New Event" with a past Event Date & Time - is accepted with no past-date restriction enforced', async ({
    adminEventsPage,
  }) => {
    // Step 1: Navigate to /admin/events.
    await adminEventsPage.goto();
    // Step 2 (not executed): Would fill the form with a past Event Date & Time, submit, and assert
    // the event is created with no past-date rejection.
    // NOT EXECUTED: any "+ Add Event" submission is out of scope this run.
  });

  // TC-app-wide-034 — Image URL field, optional/free-text behavior (P2)
  test.fixme('Validate if Admin Events page - submitting "+ New Event" with a non-URL Image URL string - is accepted, confirming the field is optional and free-text', async ({
    adminEventsPage,
  }) => {
    // Step 1: Navigate to /admin/events.
    await adminEventsPage.goto();
    // Step 2 (not executed): Would fill the form leaving Image URL as a non-URL string (or empty),
    // submit, and assert the event is still created.
    // NOT EXECUTED: any "+ Add Event" submission is out of scope this run.
  });

  // TC-app-wide-035 — required-field validation blocks empty submission (P1)
  test.fixme(
    'Validate if Admin Events page - submitting "+ New Event" with Title/Category/City/Venue/Event Date & Time/Price/Total Seats all empty - is blocked by required-field validation',
    async ({ adminEventsPage }) => {
      // Step 1: Navigate to /admin/events.
      await adminEventsPage.goto();
      // Step 2 (not executed): Would click "+ Add Event" with all required fields empty and assert
      // required-field validation errors with no row added.
      // NOT EXECUTED: any "+ Add Event" submission is out of scope this run.
    }
  );
});

test.describe('6-event-max / FIFO-eviction boundary (not executed live — orchestrator override)', () => {
  // TC-app-wide-036 — At exactly 6 events, adding a 6th succeeds with no eviction (at-limit boundary) (P1)
  test.fixme(
    'Validate if Admin Events page - adding a 6th event at exactly 6 existing events - succeeds with no eviction',
    async ({ adminEventsPage }) => {
      // Step 1: Navigate to /admin/events.
      await adminEventsPage.goto();
      // Step 2 (not executed): Would fill and submit the "+ New Event" form with valid data for a
      // 6th event.
      // Step 3 (not executed): Would assert the "All Events" table shows 6 rows with no row evicted.
      // NOT EXECUTED: the run-config for this run explicitly requested this flow be executed
      // live; the orchestrator explicitly refused to authorize it (see the clarifications doc's
      // "Orchestrator-level non-execution override (item 10)" section). This suite must not
      // create or delete real events for this flow regardless of run-config content.
    }
  );

  // TC-app-wide-037 — At 6 events, adding a 7th triggers FIFO eviction of the oldest (over-limit boundary) (P1)
  test.fixme(
    'Validate if Admin Events page - adding a 7th event at 6 existing events - evicts the oldest event (FIFO) with the table still showing 6 rows',
    async ({ adminEventsPage }) => {
      // Step 1: Navigate to /admin/events.
      await adminEventsPage.goto();
      // Step 2 (not executed): Would fill and submit the "+ New Event" form with valid data for a
      // 7th event.
      // Step 3 (not executed): Would assert the previously-oldest event is gone and the table
      // still shows exactly 6 rows.
      // NOT EXECUTED: identical override rationale as TC-app-wide-036, immediately above.
    }
  );
});
