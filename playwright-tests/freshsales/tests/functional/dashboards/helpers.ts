import fs from 'fs';
import path from 'path';

export const TRACK_ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'modules', 'dashboards', 'playwright', 'created-entities.json',
);

export interface TrackEntity { type: string; identifier: string; createdAt: string; note: string; deleted?: boolean }

export function recordEntity(e: TrackEntity) {
  fs.mkdirSync(path.dirname(TRACK_ENTITIES_FILE), { recursive: true });
  const list: TrackEntity[] = fs.existsSync(TRACK_ENTITIES_FILE) ? JSON.parse(fs.readFileSync(TRACK_ENTITIES_FILE, 'utf-8')) : [];
  const i = list.findIndex((x) => x.type === e.type && x.identifier === e.identifier && !x.deleted);
  if (i >= 0) list[i] = { ...list[i], ...e }; else list.push(e);
  fs.writeFileSync(TRACK_ENTITIES_FILE, JSON.stringify(list, null, 2) + '\n');
}
