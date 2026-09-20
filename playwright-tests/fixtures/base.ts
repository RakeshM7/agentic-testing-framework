import { test as base } from '@playwright/test';
import { EventsListingPage } from '../pages/EventsListingPage';
import { EventDetailPage } from '../pages/EventDetailPage';

type Fixtures = {
  eventsListingPage: EventsListingPage;
  eventDetailPage: EventDetailPage;
};

/**
 * Extends the base Playwright test with EventHub page-object fixtures.
 * Runs against the shared authenticated `page` (storageState is applied at
 * the project level in playwright.config.ts via the `setup` project).
 */
export const test = base.extend<Fixtures>({
  eventsListingPage: async ({ page }, use) => {
    await use(new EventsListingPage(page));
  },
  eventDetailPage: async ({ page }, use) => {
    await use(new EventDetailPage(page));
  },
});

export const expect = base.expect;

/** Ground-truth event fixtures, per artifacts/eventhub/clarifications/event-booking-clarifications.md. */
export const EVENTS = {
  DILLI_DIWALI_MELA: { id: 285, title: 'Dilli Diwali Mela', price: 300 },
  HOLLYWOOD_MONSOON_NIGHT: { id: 284, title: 'Hollywood Monsoon Night — Los Angeles', price: 2500 },
  WORLD_TECH_SUMMIT: { id: 283, title: 'World Tech Summit', price: 1500 },
} as const;
