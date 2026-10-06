import fs from 'fs';
import path from 'path';

export interface PqEntity { type: string; identifier: string; url: string; createdAt: string; note: string; deleted?: boolean; deletedAt?: string }

/** Track-local created-entities file (trackRoot/playwright/created-entities.json). */
export const PQ_ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'products-quotes', 'playwright', 'created-entities.json',
);

function read(): PqEntity[] {
  return fs.existsSync(PQ_ENTITIES_FILE) ? JSON.parse(fs.readFileSync(PQ_ENTITIES_FILE, 'utf-8')) : [];
}

/** Records (or updates by type+identifier) an entity the instant it is created. Identifier = the unique ZZ name (products/templates) or the numeric id (deal/contact/quote). */
export function record(e: Omit<PqEntity, 'createdAt'> & { createdAt?: string }) {
  fs.mkdirSync(path.dirname(PQ_ENTITIES_FILE), { recursive: true });
  const list = read();
  const i = list.findIndex((x) => x.type === e.type && x.identifier === e.identifier);
  const rec = { createdAt: new Date().toISOString(), deleted: false, ...e } as PqEntity;
  if (i >= 0) list[i] = { ...list[i], ...rec, createdAt: list[i].createdAt };
  else list.push(rec);
  fs.writeFileSync(PQ_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}

export function markDeleted(type: string, identifier: string, deleted = true) {
  const list = read();
  const e = list.find((x) => x.type === type && x.identifier === identifier);
  if (!e) return;
  e.deleted = deleted;
  e.deletedAt = deleted ? new Date().toISOString() : undefined;
  fs.writeFileSync(PQ_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}

/** Delete guard: only entities this track recorded as created (and not yet deleted) may be deleted. */
export function isCreated(type: string, identifier: string): boolean {
  return read().some((x) => x.type === type && x.identifier === identifier && !x.deleted);
}
export function pending(type?: string): PqEntity[] {
  return read().filter((x) => !x.deleted && (!type || x.type === type));
}
/** Latest recorded entity of a type whose note starts with a label (survives worker restarts). */
export function findByNote(type: string, notePrefix: string): PqEntity | undefined {
  const hit = read().filter((x) => x.type === type && x.note.startsWith(notePrefix));
  return hit[hit.length - 1];
}

/** Run id fixed per run via PQ_RUN (workers restart after a failure and must agree on entity names). */
export const RUN = process.env.PQ_RUN || `${Date.now()}`.slice(-8);
