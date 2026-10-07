import { test, expect, EVENTS } from '../../fixtures/base';

// TC-event-booking-001 — Navigate to event detail via event card click (P0)
test('Validate if Events Listing page - clicking an event card - navigates to the event detail page and renders its info', async ({
  page,
  eventsListingPage,
  eventDetailPage,
}) => {
  // Step 1: Navigate to /events and click the Dilli Diwali Mela event card.
  await eventsListingPage.goto();
  await eventsListingPage.clickEventCard(EVENTS.DILLI_DIWALI_MELA.id);

  // Step 2: Verify the URL and rendered event details (heading, category, badge, venue, city,
  // availability, price, and "Book Tickets").
  await expect(page).toHaveURL(`/events/${EVENTS.DILLI_DIWALI_MELA.id}`);
  await expect(eventDetailPage.heading()).toHaveText('Dilli Diwali Mela');
  await expect(page.getByText('Festival', { exact: true })).toBeVisible();
  await expect(page.getByText('Featured', { exact: true })).toBeVisible();
  await expect(page.getByText('Pragati Maidan Exhibition Grounds')).toBeVisible();
  await expect(page.getByText('Delhi', { exact: true })).toBeVisible();
  // "Available" (label) and "n / 10000 seats" (value) are separate sibling text
  // nodes in the DOM — no "AVAILABLE:" prefix joins them into one node.
  const availableLabel = page.getByText('Available', { exact: true });
  await expect(availableLabel).toBeVisible();
  await expect(availableLabel.locator('xpath=following-sibling::p[1]')).toHaveText(
    /[\d,]+\s*\/\s*10,?000\s*seats/i
  );
  // "Price per ticket" (label) and "$300" (value) are likewise separate
  // sibling text nodes — no ":" joins them into one node.
  const priceLabel = page.getByText('Price per ticket', { exact: true });
  await expect(priceLabel).toBeVisible();
  await expect(priceLabel.locator('xpath=following-sibling::p[1]')).toHaveText('$300');
  await expect(page.getByText('Book Tickets', { exact: false }).first()).toBeVisible();
});

// TC-event-booking-002 — Navigate to event detail via standalone "Book Now" button (P0)
test('Validate if Events Listing page - clicking the standalone "Book Now" button - navigates to the event detail page and renders its info', async ({
  page,
  eventsListingPage,
  eventDetailPage,
}) => {
  // Step 1: Navigate to /events and click the "Book Now" button for Hollywood Monsoon Night.
  await eventsListingPage.goto();
  await eventsListingPage.clickBookNow(EVENTS.HOLLYWOOD_MONSOON_NIGHT.id);

  // Step 2: Verify the URL and rendered event details.
  await expect(page).toHaveURL(`/events/${EVENTS.HOLLYWOOD_MONSOON_NIGHT.id}`);
  await expect(eventDetailPage.heading()).toHaveText(EVENTS.HOLLYWOOD_MONSOON_NIGHT.title);
  await expect(page.getByText('Concert', { exact: true })).toBeVisible();
  await expect(page.getByText('Dome, NSCI SVP Stadium')).toBeVisible();
  // See comment in the previous test: label and value are separate DOM nodes.
  const priceLabel = page.getByText('Price per ticket', { exact: true });
  await expect(priceLabel).toBeVisible();
  await expect(priceLabel.locator('xpath=following-sibling::p[1]')).toHaveText('$2,500');
  await expect(page.getByText('Book Tickets', { exact: false }).first()).toBeVisible();
});

// TC-event-booking-017 — Both entry points render the identical booking widget (P2)
test('Validate if Events Listing page - reaching event detail via card click versus the "Book Now" button - lands on the same page with an identical booking widget', async ({
  page,
  eventsListingPage,
  eventDetailPage,
}) => {
  const { id, price } = EVENTS.WORLD_TECH_SUMMIT;

  // Step 1: Navigate to /events, click the event card, and capture the order summary.
  await eventsListingPage.goto();
  await eventsListingPage.clickEventCard(id);
  await expect(page).toHaveURL(`/events/${id}`);
  const viaCard = await eventDetailPage.getOrderSummary();
  await eventDetailPage.expectBookingWidgetVisible(price);

  // Step 2: Navigate back to /events, click "Book Now" instead, and capture the order summary.
  await eventsListingPage.goto();
  await eventsListingPage.clickBookNow(id);
  await expect(page).toHaveURL(`/events/${id}`);
  const viaBookNow = await eventDetailPage.getOrderSummary();
  await eventDetailPage.expectBookingWidgetVisible(price);

  // Step 3: Verify both entry points produced an identical order summary.
  expect(viaBookNow).toEqual(viaCard);
});
