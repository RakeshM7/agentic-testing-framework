import fs from 'fs';
import path from 'path';

const FILE = path.resolve(
  __dirname,
  '../../../artifacts/rakesh-freshsales-ind-sep21/api/created-entities.json'
);

export type CreatedEntity = { id: number; resource: string; endpoint: string; createdAt: string };

export function readCreated(): CreatedEntity[] {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return [];
  }
}

/** Log an entity this run created via a mutating call. Any later PUT/DELETE must target a logged id. */
export function recordCreated(resource: string, endpoint: string, id: number) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const all = readCreated();
  all.push({ id, resource, endpoint, createdAt: new Date().toISOString() });
  fs.writeFileSync(FILE, JSON.stringify(all, null, 2));
}

export function isCreatedByThisRun(id: number) {
  return readCreated().some((e) => e.id === id);
}
