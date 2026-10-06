import fs from 'fs';
import path from 'path';

export interface DealEntity { type: string; identifier: string; url: string; createdAt: string; note: string; deleted?: boolean }

/** Track-local created-entities file (trackRoot/playwright/created-entities.json). */
export const DEALS_ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'deals', 'playwright', 'created-entities.json',
);

function read(): DealEntity[] {
  return fs.existsSync(DEALS_ENTITIES_FILE) ? JSON.parse(fs.readFileSync(DEALS_ENTITIES_FILE, 'utf-8')) : [];
}

export function recordDeal(e: Omit<DealEntity, 'createdAt'> & { createdAt?: string }) {
  fs.mkdirSync(path.dirname(DEALS_ENTITIES_FILE), { recursive: true });
  const list = read();
  const i = list.findIndex((x) => x.type === e.type && x.identifier === e.identifier);
  const rec = { createdAt: new Date().toISOString(), deleted: false, ...e } as DealEntity;
  if (i >= 0) list[i] = { ...list[i], ...rec, createdAt: list[i].createdAt };
  else list.push(rec);
  fs.writeFileSync(DEALS_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}

/** Delete guard: only entities this track recorded as created (and not yet deleted) may be deleted. */
export function isDealCreated(type: string, identifier: string): boolean {
  return read().some((x) => x.type === type && x.identifier === identifier && !x.deleted);
}

/** Run id: fixed per run via DEALS_RUN (workers restart after a failure and must agree on entity names). */
export const RUN = process.env.DEALS_RUN || `${Date.now()}`.slice(-8);

/** Id of the entity this track recorded under a given deal name (note starts with '<name> ('); latest wins. */
export function idOf(name: string, type = 'deal'): string {
  const hit = read().filter((x) => x.type === type && x.note.startsWith(`${name} (`));
  return hit.length ? hit[hit.length - 1].identifier : '';
}

/** Entities of a type this track created and has not yet deleted (used for orphan cleanup after a cut-off run). */
export function pendingDeals(type: string): string[] {
  return read().filter((x) => x.type === type && !x.deleted).map((x) => x.identifier);
}

/** Flips the deleted flag of an already-recorded entity without touching its note. */
export function markDeleted(identifier: string, deleted: boolean, type = 'deal') {
  const list = read();
  const e = list.find((x) => x.type === type && x.identifier === identifier);
  if (!e) return;
  e.deleted = deleted;
  fs.writeFileSync(DEALS_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}
