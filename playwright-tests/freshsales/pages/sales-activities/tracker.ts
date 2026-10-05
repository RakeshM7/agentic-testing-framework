import fs from 'fs';
import path from 'path';

export interface SAEntity { type: string; identifier: string; url: string; createdAt: string; note: string; deleted?: boolean }

/** Track-local created-entities file (trackRoot/playwright/created-entities.json). */
export const SA_ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'sales-activities', 'playwright', 'created-entities.json',
);

function read(): SAEntity[] {
  return fs.existsSync(SA_ENTITIES_FILE) ? JSON.parse(fs.readFileSync(SA_ENTITIES_FILE, 'utf-8')) : [];
}

export function recordSA(e: Omit<SAEntity, 'createdAt'> & { createdAt?: string }) {
  fs.mkdirSync(path.dirname(SA_ENTITIES_FILE), { recursive: true });
  const list = read();
  const i = list.findIndex((x) => x.type === e.type && x.identifier === e.identifier);
  const rec = { createdAt: new Date().toISOString(), deleted: false, ...e } as SAEntity;
  if (i >= 0) list[i] = { ...list[i], ...rec, createdAt: list[i].createdAt };
  else list.push(rec);
  fs.writeFileSync(SA_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}

/** Delete guard: only entities this track recorded as created (and not yet deleted) may be deleted. */
export function isSACreated(type: string, identifier: string): boolean {
  return read().some((x) => x.type === type && x.identifier === identifier && !x.deleted);
}

export const RUN = `${Date.now()}`;

/** Entities of a type this track created and has not yet deleted (used for orphan cleanup after a cut-off run). */
export function pendingSA(type: string): string[] {
  return read().filter((x) => x.type === type && !x.deleted).map((x) => x.identifier);
}
