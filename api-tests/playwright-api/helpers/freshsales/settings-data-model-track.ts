import fs from 'fs';
import path from 'path';
import { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { guardRequest, MUTATIONS_ALLOWED } from '../../fixtures/mutationGuard';

// settings-data-model track helpers (track-local; shared fixtures untouched).
// Tenant-wide admin config: only ZZ-API-prefixed tags created by this suite are ever mutated/deleted.
const LOG = path.resolve(
  __dirname,
  '../../../../artifacts/rakesh-freshsales-ind-sep21/modules/settings-data-model/api/created-entities.json'
);
export const TENANT = 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';
export const PREFIX = 'ZZ-API';

export type Entity = { id: number; resource: string; endpoint: string; name: string; createdAt: string; deleted?: boolean };
export function readLog(): Entity[] { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch { return []; } }
function write(a: Entity[]) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, JSON.stringify(a, null, 2)); }
export function recordCreated(resource: string, endpoint: string, id: number, name: string) {
  const a = readLog(); a.push({ id, resource, endpoint, name, createdAt: new Date().toISOString() }); write(a);
}
export function markDeleted(resource: string, id: number) {
  const a = readLog(); for (const e of a) if (e.id === id && e.resource === resource) e.deleted = true; write(a);
}
export function isOurs(resource: string, id: number) { return readLog().some((e) => e.id === id && e.resource === resource); }

export function stateFile() {
  return process.env.FRESHSALES_SESSION_STATE_FILE ||
    path.resolve(__dirname, '../../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
}
export function hasStateFile() { try { return fs.statSync(stateFile()).size > 0; } catch { return false; } }

export type Mut = { ctx: APIRequestContext; csrf: string; hdr: Record<string, string> };
export async function newMutCtx(playwright: PlaywrightWorkerArgs['playwright']): Promise<Mut> {
  const raw = await playwright.request.newContext({ baseURL: TENANT, storageState: stateFile(), extraHTTPHeaders: { Accept: 'application/json' } });
  const page = await raw.get('/crm/sales/dashboard', { headers: { Accept: 'text/html' } });
  const html = await page.text();
  const m = html.match(/<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/) || html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/);
  const csrf = m ? m[1] : '';
  const ctx = MUTATIONS_ALLOWED ? raw : guardRequest(raw);
  return { ctx, csrf, hdr: { 'X-CSRF-Token': csrf, Origin: TENANT, Referer: `${TENANT}/crm/sales/`, 'Content-Type': 'application/json' } };
}
