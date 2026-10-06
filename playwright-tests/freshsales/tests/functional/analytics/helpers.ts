import fs from 'fs';
import path from 'path';

export const TRACK_ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'analytics', 'playwright', 'created-entities.json',
);
export interface TrackEntity { type: string; identifier: string; url?: string; createdAt: string; note: string; deleted?: boolean }

export function readEntities(): TrackEntity[] {
  return fs.existsSync(TRACK_ENTITIES_FILE) ? JSON.parse(fs.readFileSync(TRACK_ENTITIES_FILE, 'utf-8')) : [];
}
/** Upserts by type+identifier+url; written the moment an entity exists so a cut-off cannot orphan it. */
export function recordEntity(e: TrackEntity) {
  fs.mkdirSync(path.dirname(TRACK_ENTITIES_FILE), { recursive: true });
  const list = readEntities();
  const i = list.findIndex((x) => x.type === e.type && x.identifier === e.identifier && x.url === e.url);
  if (i >= 0) list[i] = { ...list[i], ...e }; else list.push(e);
  fs.writeFileSync(TRACK_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}

export const RUN_ID = String(Date.now()).slice(-6);
/** Prefix shared by every report this suite creates; the cleanup sweep only ever touches reports with it. */
export const ZZ_PREFIX = 'ZZ Analytics QA';
