import fs from 'fs';
import path from 'path';
import { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { guardRequest, MUTATIONS_ALLOWED } from '../../fixtures/mutationGuard';

// deals track helpers (track-local; shared fixtures untouched).
// Only deals named "ZZ API Deal*" created by this suite are ever mutated/deleted, and only ids present in the log.
const LOG = path.resolve(__dirname, '../../../../artifacts/rakesh-freshsales-ind-sep21/modules/deals/api/created-entities.json');
export const TENANT = 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';
export const PREFIX = 'ZZ API Deal';
export const SEGMENT_ALL_DEALS = 402015942744;
export const SAMPLE_DEAL_ID = 402011904108; // pre-existing: READ ONLY
export const PIPELINE_ID = 402000272682;
export const STAGE_NEW = 402001912038;
export const STAGE_QUALIFICATION = 402001912039;

export type Entity = { id: number; resource: string; endpoint: string; name: string; createdAt: string; deleted?: boolean };
export function readLog(): Entity[] { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch { return []; } }
// Read-modify-write under a mkdir lock so parallel workers do not lose entries.
function withLock<T>(fn: () => T): T {
  const lock = LOG + '.lock';
  for (let i = 0; i < 400; i++) {
    try { fs.mkdirSync(lock); break; } catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25); if (i === 399) { try { fs.rmdirSync(lock); } catch {} } }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch {} }
}
function write(a: Entity[]) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, JSON.stringify(a, null, 2)); }
export function recordCreated(id: number, name: string) {
  withLock(() => { const a = readLog(); a.push({ id, resource: 'deals', endpoint: 'POST /crm/sales/deals', name, createdAt: new Date().toISOString() }); write(a); });
}
export function markDeleted(id: number) {
  withLock(() => { const a = readLog(); for (const e of a) if (e.id === id) e.deleted = true; write(a); });
}
export function isOurs(id: number) { return readLog().some((e) => e.id === id && e.name.startsWith(PREFIX)); }

export function stateFile() {
  return process.env.FRESHSALES_SESSION_STATE_FILE ||
    path.resolve(__dirname, '../../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
}
export function hasStateFile() { try { return fs.statSync(stateFile()).size > 0; } catch { return false; } }
export const sfx = () => `${Date.now() % 1e8}${Math.floor(Math.random() * 1000)}`;

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

/** Create a ZZ API Deal (logged immediately). Returns the response body's deal. */
export async function createDeal(m: Mut, body: Record<string, unknown>) {
  const r = await m.ctx.post('/crm/sales/deals', { headers: m.hdr, data: { deal: { name: `${PREFIX} ${sfx()}`, ...body } } });
  const j = await r.json().catch(() => ({}));
  if (j?.deal?.id) recordCreated(j.deal.id, j.deal.name);
  return { r, deal: j?.deal };
}
/** Delete only if id is in our log with the ZZ API Deal prefix. */
export async function deleteDeal(m: Mut, id: number) {
  if (!isOurs(id)) throw new Error(`refusing to delete deal ${id}: not in this track's created-entities log`);
  const r = await m.ctx.delete(`/crm/sales/deals/${id}`, { headers: m.hdr });
  if (r.status() === 200 || r.status() === 404) markDeleted(id);
  return r;
}
