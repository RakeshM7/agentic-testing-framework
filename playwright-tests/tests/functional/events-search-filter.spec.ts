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
test('search box and filter dropdowns render with the correct option sets, all 3 events unfiltered', async ({
  eventsListingPage,
}) => {
  await eventsListingPage.goto();

  await expect(eventsListingPage.searchInput).toBeVisible();
  await expect(eventsListingPage.categorySelect.locator('option')).toHaveText([
    'All Categories',
    '🎙 Conference',
    '🎵 Concert',
    '⚽ Sports',
    '🛠 Workshop',
    '🎉 Festival',
  ]);
  await expect(eventsListingPage.citySelect.locator('option')).toHaveText([
    'All Cities',
    'Mumbai',
    'Bangalore',
    'Delhi',
    'Hyderabad',
    'Chennai',
    'Pune',
  ]);

  await expect(eventsListingPage.visibleEventTitles()).toHaveText([
    EVENTS.DILLI_DIWALI_MELA.title,
    EVENTS.HOLLYWOOD_MONSOON_NIGHT.title,
    EVENTS.WORLD_TECH_SUMMIT.title,
  ]);
});

// TC-app-wide-006 / TC-app-wide-025 — Category filter alone narrows the listing to matching
// events only ("Festival" -> Dilli Diwali Mela only) (P1)
test('category filter "Festival" narrows the listing to Dilli Diwali Mela only', async ({
  eventsListingPage,
}) => {
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  await eventsListingPage.selectCategory('Festival');

  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.DILLI_DIWALI_MELA.title]);
});

// TC-app-wide-007 / TC-app-wide-026 — City filter alone narrows the listing to matching events
// only ("Delhi" -> Dilli Diwali Mela only) (P1)
test('city filter "Delhi" narrows the listing to Dilli Diwali Mela only', async ({ eventsListingPage }) => {
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  await eventsListingPage.selectCity('Delhi');

  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.DILLI_DIWALI_MELA.title]);
});

// TC-app-wide-016 — Events search with a query that matches no events shows an empty/no-results
// state (P2)
test('search with no matching query shows the "No events found" empty state', async ({
  eventsListingPage,
}) => {
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  await eventsListingPage.search('zzz-no-match-zzz');

  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(0);
  await expect(eventsListingPage.noEventsFoundHeading).toBeVisible();
  await expect(eventsListingPage.noEventsFoundBody).toBeVisible();
});

// TC-app-wide-024 — Free-text search on /events by title, venue, or city substring (P1)
test('free-text search matches by title substring and by venue/city substring, case-insensitively', async ({
  eventsListingPage,
}) => {
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  await eventsListingPage.search('diwali');
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.DILLI_DIWALI_MELA.title]);

  await eventsListingPage.clearSearch();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);
  await eventsListingPage.search('Hyderabad');
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.WORLD_TECH_SUMMIT.title]);
});

// TC-app-wide-027 — Category + City filter combined use AND/intersection semantics (P1)
test('category + city filters combine with AND semantics (Concert + Delhi matches zero events)', async ({
  eventsListingPage,
}) => {
  await eventsListingPage.goto();
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  // Verified live: selecting Concert alone correctly narrows to Hollywood Monsoon Night; ALSO
  // selecting Delhi (a city no Concert event has) then narrows to zero, confirming intersection
  // (not union) semantics — Hollywood Monsoon Night's own city is Los Angeles, not Delhi.
  await eventsListingPage.selectCategory('Concert');
  await expect(eventsListingPage.visibleEventTitles()).toHaveText([EVENTS.HOLLYWOOD_MONSOON_NIGHT.title]);

  await eventsListingPage.selectCity('Delhi');
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(0);
});

// TC-app-wide-028 — City filter dropdown cannot select "Los Angeles" — likely data/UI bug (P1)
test('City filter dropdown does not offer "Los Angeles" as an option (documented likely bug)', async ({
  eventsListingPage,
}) => {
  await eventsListingPage.goto();
  // Wait for the listing (and therefore the rest of the page, including the filter dropdowns) to
  // have actually finished its initial render before reading option text.
  await expect(eventsListingPage.visibleEventTitles()).toHaveCount(3);

  const cityOptions = eventsListingPage.citySelect.locator('option');
  await expect(cityOptions).toHaveText(['All Cities', 'Mumbai', 'Bangalore', 'Delhi', 'Hyderabad', 'Chennai', 'Pune']);

  const cityOptionTexts = await cityOptions.allTextContents();
  expect(
    cityOptionTexts,
    'Documented likely bug (see clarifications doc): "Hollywood Monsoon Night" has city = ' +
      'Los Angeles, but the City filter has no "Los Angeles" option, so that event can never be ' +
      'isolated via the City filter alone. Flagged for human/product-owner follow-up, not asserted ' +
      'as intended behavior.'
  ).not.toContain('Los Angeles');
});
