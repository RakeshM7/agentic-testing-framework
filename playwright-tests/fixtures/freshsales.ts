import { test as base } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { ContactsPage } from '../pages/freshsales/ContactsPage';
import { ContactDetailPage } from '../pages/freshsales/ContactDetailPage';
import { DealDetailPage } from '../pages/freshsales/DealDetailPage';
import { DealsKanbanPage } from '../pages/freshsales/DealsKanbanPage';
import { LoginPage } from '../pages/freshsales/LoginPage';

type Fixtures = {
  loginPage: LoginPage;
  contactsPage: ContactsPage;
  contactDetailPage: ContactDetailPage;
  dealDetailPage: DealDetailPage;
  dealsKanbanPage: DealsKanbanPage;
};

/** Extends the base Playwright test with Freshsales page-object fixtures. */
export const test = base.extend<Fixtures>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  contactsPage: async ({ page }, use) => {
    await use(new ContactsPage(page));
  },
  contactDetailPage: async ({ page }, use) => {
    await use(new ContactDetailPage(page));
  },
  dealDetailPage: async ({ page }, use) => {
    await use(new DealDetailPage(page));
  },
  dealsKanbanPage: async ({ page }, use) => {
    await use(new DealsKanbanPage(page));
  },
});

export const expect = base.expect;

/**
 * created-entities.json tracker for this run's live-mutating Freshsales specs, per the
 * clarifications doc's Q8 instruction: "Every entity created during live execution must be
 * tracked in a created-entities.json file for this run, following the format already established
 * at artifacts/rakesh-freshsales-ind-sep21/explore/created-entities.json (type, identifier, url,
 * createdAt, note)." Appends one entry per call rather than overwriting, so parallel/sequential
 * specs within the same run don't clobber each other's records.
 */
export interface CreatedEntity {
  type: 'account' | 'contact' | 'deal' | 'task' | 'call' | 'note';
  identifier: string;
  url: string;
  createdAt: string;
  note: string;
}

const CREATED_ENTITIES_FILE = path.join(
  __dirname,
  '..',
  '..',
  'artifacts',
  'rakesh-freshsales-ind-sep21',
  'playwright',
  'created-entities.json'
);

export function recordCreatedEntity(entity: CreatedEntity) {
  let existing: CreatedEntity[] = [];
  try {
    existing = JSON.parse(fs.readFileSync(CREATED_ENTITIES_FILE, 'utf-8'));
  } catch {
    existing = [];
  }
  existing.push(entity);
  fs.mkdirSync(path.dirname(CREATED_ENTITIES_FILE), { recursive: true });
  fs.writeFileSync(CREATED_ENTITIES_FILE, JSON.stringify(existing, null, 2) + '\n');
}

/** Ground-truth tenant fixtures, per the clarifications doc's grounding reference section. */
export const FRESHSALES = {
  DEFAULT_PIPELINE: 'Default Pipeline',
  STAGES: ['New', 'Qualification', 'Discovery', 'Demo', 'Negotiation', 'Won', 'Lost'] as const,
} as const;

/** Generates a unique suffix for test-run-scoped entity names/emails, avoiding collisions with
 *  pre-existing tenant data or other runs of this suite. */
export function uniqueSuffix(): string {
  return `${Date.now()}`;
}
