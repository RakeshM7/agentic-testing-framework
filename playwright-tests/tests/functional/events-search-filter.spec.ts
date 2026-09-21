import { test, expect, EVENTS } from '../../fixtures/base';

/**
 * /events search & filter coverage from artifacts/eventhub/testcases/app-wide-testcases.md.
 * Card-click / "Book Now" navigation itself is out of scope here (owned by the event-booking
 * suite's tests/functional/navigation.spec.ts). Runs authenticated (default storageState).
 *
 * Every visible-titles assertion below uses `expect(locator).toHaveText([...])` (an auto-retrying
 * web-first assertion) rather than a one-shot `allTextContents()` snapshot compared with a plain
 * `expect().toEqual()`. The app re-filters the card grid asynchronously after a select/search
 * change; a one-shot snapshot taken immediately after triggering the filter can race ahead of
 * that re-render and read stale DOM (confirmed live during development — this exact race caused
 * spurious failures until switched to the retrying form).
 */

// TC-app-wide-005 — Events listing renders search box, Category filter, and City filter with
// correct option sets (P2)
test('Validate if Events Listing page - loading the search box and filter dropdowns - renders the correct option sets with all 3 events shown unfiltered', async ({
  eventsListingPage,
}) => {
  // Step 1: Navigate to the /events listing page.
  await eventsListingPage.goto();

  // Step 2: Verify the search input is visible.
  await expect(eventsListingPage.searchInput).toBeVisible();
  // Step 3: Verify the Category dropdown lists all expected options.
  await expect(eventsListingPage.categorySelect.locator('option')).toHaveText([
    'All Categories',
    '🎙 Conference',
    '🎵 Concert',
    '⚽ Sports',
    '🛠 Workshop',
    '🎉 Festival',
  ]);
  // Step 4: Verify the City dropdown lists all expected options.
  await expect(eventsListingPage.citySelect.locator('option')).toHaveText([
    'All Cities',
    'Mumbai',
    'Bangalore',
    'Delhi',
    'Hyderabad',
    'Chennai',
    'Pune',
  ]);

  // Step 5: Verify all 3 seeded events are visible with no filter applied.
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([
    EVENTS.DILLI_DIWALI_MELA.title,
    EVENTS.HOLLYWOOD_MONSOON_NIGHT.title,
    EVENTS.WORLD_TECH_SUMMIT.title,
  ]);
});

// TC-app-wide-006 / TC-app-wide-025 — Category filter alone narrows the listing to matching
// events only ("Festival" -> Dilli Diwali Mela only) (P1)
test('Validate if Events Listing page - applying the Category filter "Festival" - narrows the listing to Dilli Diwali Mela only', async ({
  eventsListingPage,
}) => {
  // Step 1: Navigate to the /events listing page and verify all 3 events are visible.
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  // Step 2: Select "Festival" from the Category filter.
  await eventsListingPage.selectCategory('Festival');

  // Step 3: Verify only Dilli Diwali Mela remains visible.
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.DILLI_DIWALI_MELA.title]);
});

// TC-app-wide-007 / TC-app-wide-026 — City filter alone narrows the listing to matching events
// only ("Delhi" -> Dilli Diwali Mela only) (P1)
test('Validate if Events Listing page - applying the City filter "Delhi" - narrows the listing to Dilli Diwali Mela only', async ({ eventsListingPage }) => {
  // Step 1: Navigate to the /events listing page and verify all 3 events are visible.
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  // Step 2: Select "Delhi" from the City filter.
  await eventsListingPage.selectCity('Delhi');

  // Step 3: Verify only Dilli Diwali Mela remains visible.
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.DILLI_DIWALI_MELA.title]);
});

// TC-app-wide-016 — Events search with a query that matches no events shows an empty/no-results
// state (P2)
test('Validate if Events Listing page - searching with a query that matches no events - shows the "No events found" empty state', async ({
  eventsListingPage,
}) => {
  // Step 1: Navigate to the /events listing page and verify all 3 events are visible.
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  // Step 2: Search for a query that matches no events.
  await eventsListingPage.search('zzz-no-match-zzz');

  // Step 3: Verify no event cards remain and the empty-state heading/body are shown.
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(0);
  await expect(eventsListingPage.noEventsFoundHeading).toBeVisible();
  await expect(eventsListingPage.noEventsFoundBody).toBeVisible();
});

// TC-app-wide-024 — Free-text search on /events by title, venue, or city substring (P1)
test('Validate if Events Listing page - free-text searching by title substring and by venue/city substring - matches case-insensitively', async ({
  eventsListingPage,
}) => {
  // Step 1: Navigate to the /events listing page and verify all 3 events are visible.
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  // Step 2: Search "diwali" (lowercase, title substring) and verify only Dilli Diwali Mela matches.
  await eventsListingPage.search('diwali');
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.DILLI_DIWALI_MELA.title]);

  // Step 3: Clear the search and verify all 3 events are visible again.
  await eventsListingPage.clearSearch();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);
  // Step 4: Search "Hyderabad" (city substring) and verify only World Tech Summit matches.
  await eventsListingPage.search('Hyderabad');
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.WORLD_TECH_SUMMIT.title]);
});

// TC-app-wide-027 — Category + City filter combined use AND/intersection semantics (P1)
test('Validate if Events Listing page - combining the Category and City filters (Concert + Delhi) - applies AND semantics and matches zero events', async ({
  eventsListingPage,
}) => {
  // Step 1: Navigate to the /events listing page and verify all 3 events are visible.
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  // Step 2: Select "Concert" from the Category filter and verify only Hollywood Monsoon Night matches.
  // Verified live: selecting Concert alone correctly narrows to Hollywood Monsoon Night; ALSO
  // selecting Delhi (a city no Concert event has) then narrows to zero, confirming intersection
  // (not union) semantics — Hollywood Monsoon Night's own city is Los Angeles, not Delhi.
  await eventsListingPage.selectCategory('Concert');
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.HOLLYWOOD_MONSOON_NIGHT.title]);

  // Step 3: Also select "Delhi" from the City filter and verify the listing narrows to zero events.
  await eventsListingPage.selectCity('Delhi');
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(0);
});

// TC-app-wide-028 — City filter dropdown cannot select "Los Angeles" — likely data/UI bug (P1)
test('Validate if Events Listing page - checking the City filter dropdown options - confirms "Los Angeles" is missing (documented likely bug)', async ({
  eventsListingPage,
}) => {
  // Step 1: Navigate to the /events listing page.
  await eventsListingPage.goto();
  // Step 2: Wait for the listing (and therefore the rest of the page, including the filter
  // dropdowns) to have actually finished its initial render before reading option text.
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  // Step 3: Read the City dropdown's option list and verify the expected 7 options.
  const cityOptions = eventsListingPage.citySelect.locator('option');
  await expect(cityOptions).toHaveText(['All Cities', 'Mumbai', 'Bangalore', 'Delhi', 'Hyderabad', 'Chennai', 'Pune']);

  // Step 4: Confirm "Los Angeles" is not among the option texts, flagging it as a likely bug.
  const cityOptionTexts = await cityOptions.allTextContents();
  expect(
    cityOptionTexts,
    'Documented likely bug (see clarifications doc): "Hollywood Monsoon Night" has city = ' +
      'Los Angeles, but the City filter has no "Los Angeles" option, so that event can never be ' +
      'isolated via the City filter alone. Flagged for human/product-owner follow-up, not asserted ' +
      'as intended behavior.'
  ).not.toContain('Los Angeles');
});
