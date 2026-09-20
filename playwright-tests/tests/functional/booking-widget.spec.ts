import { test, expect, EVENTS } from '../../fixtures/base';

// TC-event-booking-003 — Booking widget renders required fields and default ticket quantity (P1)
test('booking widget renders required fields, defaults, and Confirm Booking button', async ({
  eventDetailPage,
}) => {
  await eventDetailPage.goto(EVENTS.WORLD_TECH_SUMMIT.id);

  await eventDetailPage.expectBookingWidgetVisible(EVENTS.WORLD_TECH_SUMMIT.price);
  const summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);
  await expect(eventDetailPage.fullNameInput).toHaveValue('');
  await expect(eventDetailPage.emailInput).toHaveValue('');
  await expect(eventDetailPage.phoneInput).toHaveValue('');
});

// TC-event-booking-004 — Order total is correctly calculated at default quantity (P0)
test('order total at default quantity equals price × 1', async ({ eventDetailPage }) => {
  await eventDetailPage.goto(EVENTS.DILLI_DIWALI_MELA.id);

  const summary = await eventDetailPage.getOrderSummary();
  expect(summary.pricePerTicket).toBe(EVENTS.DILLI_DIWALI_MELA.price);
  expect(summary.quantity).toBe(1);
  expect(summary.lineTotal).toBe(EVENTS.DILLI_DIWALI_MELA.price);
  expect(summary.total).toBe(EVENTS.DILLI_DIWALI_MELA.price);
});

// TC-event-booking-006 — Order total recalculates when ticket quantity changes (mid-range) (P1)
test('order total recalculates live as quantity increases from 1 to 5', async ({ eventDetailPage }) => {
  const { price } = EVENTS.WORLD_TECH_SUMMIT;
  await eventDetailPage.goto(EVENTS.WORLD_TECH_SUMMIT.id);

  let summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);
  expect(summary.total).toBe(price * 1);

  await eventDetailPage.incrementQty(4);

  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(5);
  expect(summary.lineTotal).toBe(price * 5);
  expect(summary.total).toBe(price * 5);
});

// TC-event-booking-010 — Ticket stepper at minimum (qty = 1): "−" is blocked (P1)
test('decrement at minimum quantity (1) does not go below 1', async ({ eventDetailPage }) => {
  await eventDetailPage.goto(EVENTS.DILLI_DIWALI_MELA.id);

  let summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);

  await eventDetailPage.decrementQty(1);

  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);
  expect(summary.total).toBe(EVENTS.DILLI_DIWALI_MELA.price);
});

// TC-event-booking-011 — Ticket stepper at maximum (qty = 10): "+" is blocked (P1)
test('increment at maximum quantity (10) does not exceed 10', async ({ eventDetailPage }) => {
  const { price } = EVENTS.DILLI_DIWALI_MELA;
  await eventDetailPage.goto(EVENTS.DILLI_DIWALI_MELA.id);

  await eventDetailPage.incrementQty(9);
  let summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(10);
  expect(summary.total).toBe(price * 10);

  await eventDetailPage.incrementQty(1); // 10th click, attempting to exceed max
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(10);
  expect(summary.total).toBe(price * 10);
});

// TC-event-booking-019 — Order total recalculates correctly across a full stepper sequence,
// including at the max boundary (P1)
test('order total tracks a full sequence of stepper changes up to and back down from the max', async ({
  eventDetailPage,
}) => {
  const { price } = EVENTS.HOLLYWOOD_MONSOON_NIGHT;
  await eventDetailPage.goto(EVENTS.HOLLYWOOD_MONSOON_NIGHT.id);

  let summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(1);
  expect(summary.total).toBe(price * 1);

  await eventDetailPage.incrementQty(2); // -> 3
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(3);
  expect(summary.total).toBe(price * 3);

  await eventDetailPage.incrementQty(7); // -> 10 (max)
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(10);
  expect(summary.total).toBe(price * 10);

  await eventDetailPage.decrementQty(4); // -> 6
  summary = await eventDetailPage.getOrderSummary();
  expect(summary.quantity).toBe(6);
  expect(summary.total).toBe(price * 6);
});
