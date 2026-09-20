import { test, expect, EVENTS } from '../../fixtures/base';

// TC-event-booking-001 — Navigate to event detail via event card click (P0)
test('card click navigates to event detail and renders event info', async ({
  page,
  eventsListingPage,
  eventDetailPage,
}) => {
  await eventsListingPage.goto();
  await eventsListingPage.clickEventCard(EVENTS.DILLI_DIWALI_MELA.id);

  await expect(page).toHaveURL(`/events/${EVENTS.DILLI_DIWALI_MELA.id}`);
  await expect(eventDetailPage.heading()).toHaveText('Dilli Diwali Mela');
  await expect(page.getByText('Festival', { exact: true })).toBeVisible();
  await expect(page.getByText('Featured', { exact: true })).toBeVisible();
  await expect(page.getByText('Pragati Maidan Exhibition Grounds')).toBeVisible();
  await expect(page.getByText('Delhi', { exact: true })).toBeVisible();
  await expect(page.getByText(/AVAILABLE:\s*[\d,]+\s*\/\s*10,?000\s*seats/i)).toBeVisible();
  await expect(page.getByText('PRICE PER TICKET: $300')).toBeVisible();
  await expect(page.getByText('Book Tickets', { exact: false }).first()).toBeVisible();
});

// TC-event-booking-002 — Navigate to event detail via standalone "Book Now" button (P0)
test('"Book Now" button navigates to event detail and renders event info', async ({
  page,
  eventsListingPage,
  eventDetailPage,
}) => {
  await eventsListingPage.goto();
  await eventsListingPage.clickBookNow(EVENTS.HOLLYWOOD_MONSOON_NIGHT.id);

  await expect(page).toHaveURL(`/events/${EVENTS.HOLLYWOOD_MONSOON_NIGHT.id}`);
  await expect(eventDetailPage.heading()).toHaveText(EVENTS.HOLLYWOOD_MONSOON_NIGHT.title);
  await expect(page.getByText('Concert', { exact: true })).toBeVisible();
  await expect(page.getByText('Dome, NSCI SVP Stadium')).toBeVisible();
  await expect(page.getByText('PRICE PER TICKET: $2,500')).toBeVisible();
  await expect(page.getByText('Book Tickets', { exact: false }).first()).toBeVisible();
});

// TC-event-booking-017 — Both entry points render the identical booking widget (P2)
test('card click and "Book Now" both land on the same event detail with identical widget', async ({
  page,
  eventsListingPage,
  eventDetailPage,
}) => {
  const { id, price } = EVENTS.WORLD_TECH_SUMMIT;

  await eventsListingPage.goto();
  await eventsListingPage.clickEventCard(id);
  await expect(page).toHaveURL(`/events/${id}`);
  const viaCard = await eventDetailPage.getOrderSummary();
  await eventDetailPage.expectBookingWidgetVisible(price);

  await eventsListingPage.goto();
  await eventsListingPage.clickBookNow(id);
  await expect(page).toHaveURL(`/events/${id}`);
  const viaBookNow = await eventDetailPage.getOrderSummary();
  await eventDetailPage.expectBookingWidgetVisible(price);

  expect(viaBookNow).toEqual(viaCard);
});
