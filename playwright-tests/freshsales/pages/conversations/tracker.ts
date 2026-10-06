import fs from 'fs';
import path from 'path';

export interface ConvEntity { type: string; identifier: string; url: string; createdAt: string; note: string; deleted?: boolean; deletedAt?: string }

/** Track-local created-entities file (trackRoot/playwright/created-entities.json). */
export const CONV_ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'conversations', 'playwright', 'created-entities.json',
);

function read(): ConvEntity[] {
  return fs.existsSync(CONV_ENTITIES_FILE) ? JSON.parse(fs.readFileSync(CONV_ENTITIES_FILE, 'utf-8')) : [];
}

export function recordConv(e: Omit<ConvEntity, 'createdAt'> & { createdAt?: string }) {
  fs.mkdirSync(path.dirname(CONV_ENTITIES_FILE), { recursive: true });
  const list = read();
  const i = list.findIndex((x) => x.type === e.type && x.identifier === e.identifier);
  const rec = { createdAt: new Date().toISOString(), deleted: false, ...e } as ConvEntity;
  if (i >= 0) list[i] = { ...list[i], ...rec, createdAt: list[i].createdAt };
  else list.push(rec);
  fs.writeFileSync(CONV_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}

export function markDeleted(identifier: string) {
  recordConv({ type: 'email-template', identifier, url: '', note: '', deleted: true, deletedAt: new Date().toISOString() });
}

/** Delete guard: a row name may be deleted only if it is ZZ-prefixed AND starts with an identifier this track recorded. */
export function isConvCreated(rowName: string): boolean {
  return rowName.startsWith('ZZ') && read().some((x) => !x.deleted && rowName.startsWith(x.identifier));
}

export function pendingConv(): ConvEntity[] {
  return read().filter((x) => !x.deleted);
}

export const RUN = `${Date.now()}`;
