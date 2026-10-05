import fs from 'fs';
import path from 'path';

export interface CreatedEntity {
  type: 'contact' | 'account' | 'deal' | 'task' | 'call' | 'note';
  identifier: string;
  url: string;
  createdAt: string;
  note: string;
  deleted?: boolean;
}

export const CREATED_ENTITIES_FILE = path.join(
  __dirname, '..', '..', '..', 'artifacts', 'rakesh-freshsales-ind-sep21', 'playwright', 'created-entities.json',
);

/** Appends (or updates by type+identifier) a record of an entity this suite created. */
export function recordCreatedEntity(e: CreatedEntity) {
  fs.mkdirSync(path.dirname(CREATED_ENTITIES_FILE), { recursive: true });
  const existing: CreatedEntity[] = fs.existsSync(CREATED_ENTITIES_FILE)
    ? JSON.parse(fs.readFileSync(CREATED_ENTITIES_FILE, 'utf-8'))
    : [];
  const i = existing.findIndex((x) => x.type === e.type && x.identifier === e.identifier);
  if (i >= 0) existing[i] = { ...existing[i], ...e };
  else existing.push(e);
  fs.writeFileSync(CREATED_ENTITIES_FILE, JSON.stringify(existing, null, 2) + '\n');
}

export function isRunCreated(type: CreatedEntity['type'], identifier: string): boolean {
  if (!fs.existsSync(CREATED_ENTITIES_FILE)) return false;
  const list: CreatedEntity[] = JSON.parse(fs.readFileSync(CREATED_ENTITIES_FILE, 'utf-8'));
  return list.some((x) => x.type === type && x.identifier === identifier);
}

/** Unique, prefixed run id used in every entity name (clarification Q10). */
export const RUN_ID = `${Date.now()}`;
