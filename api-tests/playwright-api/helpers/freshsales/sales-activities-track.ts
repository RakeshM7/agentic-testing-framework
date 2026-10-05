import fs from 'fs';
import path from 'path';
import { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { guardRequest, MUTATIONS_ALLOWED } from '../../fixtures/mutationGuard';

// Sales-activities track helpers (track-local; shared fixtures are untouched).
// 1) created-entities log scoped to this track; DELETEs may only target ids present in it.
// 2) a session-backed, mutation-guarded APIRequestContext that also fetches the Rails CSRF token
//    (<meta name="csrf-token"> on an HTML page). Without the X-CSRF-Token header every POST/PUT/DELETE
//    returns 422 {"error_code":422} -- see feedback/api-testing-agent/2026-10-05-freshsales-csrf-required-for-mutations.md.

const LOG = path.resolve(
  __dirname,
  '../../../../artifacts/rakesh-freshsales-ind-sep21/modules/sales-activities/api/created-entities.json'
);
const TENANT = 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';

export type Entity = { id: number; resource: string; endpoint: string; createdAt: string; deleted?: boolean };

export function readLog(): Entity[] {
  try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch { return []; }
}
function write(a: Entity[]) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, JSON.stringify(a, null, 2)); }
export function recordCreated(resource: string, endpoint: string, id: number) {
  const a = readLog(); a.push({ id, resource, endpoint, createdAt: new Date().toISOString() }); write(a);
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

/** New guarded context seeded from the storageState hand-off file. Returns csrf=''-less ctx if no token found. */
export async function newMutCtx(playwright: PlaywrightWorkerArgs['playwright']): Promise<Mut> {
  const raw = await playwright.request.newContext({ baseURL: TENANT, storageState: stateFile(), extraHTTPHeaders: { Accept: 'application/json' } });
  const page = await raw.get('/crm/sales/dashboard', { headers: { Accept: 'text/html' } });
  const html = await page.text();
  const m = html.match(/<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/) || html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/);
  const csrf = m ? m[1] : '';
  const ctx = MUTATIONS_ALLOWED ? raw : guardRequest(raw);
  return { ctx, csrf, hdr: { 'X-CSRF-Token': csrf, Origin: TENANT, Referer: `${TENANT}/crm/sales/`, 'Content-Type': 'application/json' } };
}

export function tomorrowIso() { const d = new Date(Date.now() + 86400000); d.setSeconds(0, 0); return d.toISOString().replace('.000Z', 'Z'); }
