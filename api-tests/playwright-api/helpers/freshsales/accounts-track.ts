import fs from 'fs';
import path from 'path';
import { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { guardRequest, MUTATIONS_ALLOWED } from '../../fixtures/mutationGuard';

// Accounts-track helpers (track-local; shared fixtures untouched).
// - created-entities log scoped to this track; DELETE only ever targets ids present in it.
// - session-backed, mutation-guarded APIRequestContext that fetches the Rails CSRF token
//   (<meta name="csrf-token">) -- mutations without X-CSRF-Token return 422
//   (feedback/api-testing-agent/2026-10-05-freshsales-csrf-required-for-mutations.md).

const LOG = path.resolve(__dirname, '../../../../artifacts/rakesh-freshsales-ind-sep21/modules/accounts/api/created-entities.json');
export const TENANT = 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';
export const B = '/crm/sales/sales_accounts';

export type Entity = { id: number; resource: string; endpoint: string; createdAt: string; deleted?: boolean };

export function readLog(): Entity[] { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch { return []; } }
function write(a: Entity[]) { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.writeFileSync(LOG, JSON.stringify(a, null, 2)); }
export function recordCreated(id: number) { const a = readLog(); a.push({ id, resource: 'sales_account', endpoint: B, createdAt: new Date().toISOString() }); write(a); }
export function markDeleted(id: number) { const a = readLog(); for (const e of a) if (e.id === id) e.deleted = true; write(a); }
export function isOurs(id: number) { return readLog().some((e) => e.id === id); }

export function stateFile() {
  return process.env.FRESHSALES_SESSION_STATE_FILE || path.resolve(__dirname, '../../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
}
export function hasStateFile() { try { return fs.statSync(stateFile()).size > 0; } catch { return false; } }

export type Mut = { ctx: APIRequestContext; hdr: Record<string, string>; created: number[] };

export async function newMutCtx(playwright: PlaywrightWorkerArgs['playwright']): Promise<Mut> {
  const raw = await playwright.request.newContext({ baseURL: TENANT, storageState: stateFile(), extraHTTPHeaders: { Accept: 'application/json' } });
  const page = await raw.get('/crm/sales/dashboard', { headers: { Accept: 'text/html' } });
  const html = await page.text();
  const m = html.match(/<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/) || html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/);
  const csrf = m ? m[1] : '';
  const ctx = MUTATIONS_ALLOWED ? raw : guardRequest(raw);
  return { ctx, created: [], hdr: { 'X-CSRF-Token': csrf, Origin: TENANT, Referer: `${TENANT}/crm/sales/`, 'Content-Type': 'application/json' } };
}

export const sfx = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
export const zzName = (tag: string) => `ZZ ApiAcct ${tag} ${sfx()}`;

/** POST a ZZ account; records it in the log immediately. Returns raw response + id (if created). */
export async function createAccount(m: Mut, body: Record<string, unknown>) {
  const r = await m.ctx.post(B, { headers: m.hdr, data: { sales_account: body } });
  let json: any = null; try { json = await r.json(); } catch { /* non-json */ }
  const id: number | undefined = json?.sales_account?.id;
  if (r.ok() && id) { recordCreated(id); m.created.push(id); }
  return { r, json, id };
}

/** DELETE, only for ids this run created (hard guard). */
export async function deleteAccount(m: Mut, id: number) {
  if (!isOurs(id)) throw new Error(`refusing to delete ${id}: not in this track's created-entities log`);
  const r = await m.ctx.delete(`${B}/${id}`, { headers: m.hdr });
  if (r.ok()) markDeleted(id);
  return r;
}

export async function cleanup(m: Mut) {
  for (const id of m.created) {
    const e = readLog().find((x) => x.id === id);
    if (e && !e.deleted) { try { await deleteAccount(m, id); } catch { /* best effort */ } }
  }
}
