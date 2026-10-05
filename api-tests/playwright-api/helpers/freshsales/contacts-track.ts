import fs from 'fs';
import path from 'path';
import { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { guardRequest, MUTATIONS_ALLOWED } from '../../fixtures/mutationGuard';

// Contacts track helpers (track-local; shared fixtures untouched).
//  - created-entities log at <trackRoot>/api/created-entities.json; DELETE helpers refuse any id not in it.
//  - session-backed, mutation-guarded APIRequestContext that fetches the Rails CSRF token
//    (<meta name="csrf-token"> from an HTML page) -- without X-CSRF-Token every mutation returns 422
//    (feedback/api-testing-agent/2026-10-05-freshsales-csrf-required-for-mutations.md).

const LOG = path.resolve(__dirname, '../../../../artifacts/rakesh-freshsales-ind-sep21/modules/contacts/api/created-entities.json');
const TENANT = 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';

export type Entity = { id: number; resource: string; endpoint: string; createdAt: string; deleted?: boolean };

export function readLog(): Entity[] { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch { return []; } }
function write(a: Entity[]) { fs.writeFileSync(LOG, JSON.stringify(a, null, 2)); }
// Workers share one JSON file: serialize read-modify-write with an mkdir lock (mkdir is atomic).
function locked<T>(fn: () => T): T {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const lock = `${LOG}.lock`;
  const t0 = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch {
      if (Date.now() - t0 > 10_000) { try { fs.rmdirSync(lock); } catch { /* stale */ } }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* ignore */ } }
}
export function recordCreated(resource: string, endpoint: string, id: number) {
  locked(() => { const a = readLog(); a.push({ id, resource, endpoint, createdAt: new Date().toISOString() }); write(a); });
}
export function markDeleted(resource: string, id: number) {
  locked(() => { const a = readLog(); for (const e of a) if (e.id === id && e.resource === resource) e.deleted = true; write(a); });
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
  const m = html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/) || html.match(/<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/);
  const csrf = m ? m[1] : '';
  const ctx = MUTATIONS_ALLOWED ? raw : guardRequest(raw);
  return { ctx, csrf, hdr: { 'X-CSRF-Token': csrf, Origin: TENANT, Referer: `${TENANT}/crm/sales/`, 'Content-Type': 'application/json' } };
}

export const sfx = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

/** Create a ZZ/TCContacts-prefixed contact, log it immediately. Throws if the API did not return an id. */
export async function createContact(m: Mut, over: Record<string, unknown> = {}) {
  const s = sfx();
  const body = { first_name: 'TCContacts', last_name: `Api${s}`, email: `zz-tccontacts-api${s}@example.com`, ...over };
  const r = await m.ctx.post('/crm/sales/contacts', { headers: m.hdr, data: { contact: body } });
  const json = await r.json().catch(() => ({}));
  const id = json?.contact?.id;
  if (id) recordCreated('contact', '/crm/sales/contacts', id);
  return { r, json, id: id as number | undefined, body };
}

/** DELETE, only for ids this suite created. */
export async function deleteContact(m: Mut, id: number) {
  if (!isOurs('contact', id)) throw new Error(`refusing to delete contact ${id}: not created by this suite`);
  const r = await m.ctx.delete(`/crm/sales/contacts/${id}`, { headers: m.hdr });
  if (r.status() === 200 || r.status() === 404) markDeleted('contact', id);
  return r;
}

/** Best-effort sweep of ids created (and still live) by this worker. */
export async function sweep(m: Mut | undefined, ids: number[]) {
  if (!m) return;
  for (const id of ids) {
    if (!readLog().some((e) => e.id === id && !e.deleted)) continue;
    try { await deleteContact(m, id); } catch { /* keep logged as not-deleted so the leak is visible */ }
  }
}
