import fs from 'fs';
import path from 'path';
import { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { guardRequest, MUTATIONS_ALLOWED } from '../../fixtures/mutationGuard';

// Conversations track helpers (track-local; shared fixtures untouched).
//  - created-entities log at <trackRoot>/api/created-entities.json (mkdir lock for read-modify-write).
//    Every email template is recorded the moment it is created; DELETE refuses any id that is not in the log
//    AND any template whose logged name does not start with "ZZ API".
//  - Rails CSRF token from an HTML page (feedback/api-testing-agent/2026-10-05-freshsales-csrf-required-for-mutations.md).
//  - Scope: email templates only. No emails are sent/replied/forwarded/scheduled, no mailbox connect, no SMS create/send.

const LOG = path.resolve(__dirname, '../../../../artifacts/rakesh-freshsales-ind-sep21/modules/conversations/api/created-entities.json');
export const TENANT = 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';
export const PREFIX = 'ZZ API';
export const T = '/crm/sales/settings/email_templates';
export const TL = `${T}/user`;
export const CONV = '/crm/sales/conversations';

export type Entity = { id: number; resource: string; endpoint: string; name?: string; createdAt: string; deleted?: boolean; deletedAt?: string };

export function readLog(): Entity[] { try { return JSON.parse(fs.readFileSync(LOG, 'utf8')); } catch { return []; } }
function write(a: Entity[]) { fs.writeFileSync(LOG, JSON.stringify(a, null, 2) + '\n'); }
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
export function recordCreated(id: number, name: string) {
  locked(() => { const a = readLog(); a.push({ id, resource: 'email_template', endpoint: T, name, createdAt: new Date().toISOString() }); write(a); });
}
export function markDeleted(id: number) {
  locked(() => { const a = readLog(); for (const e of a) if (e.id === id) { e.deleted = true; e.deletedAt = new Date().toISOString(); } write(a); });
}
export function isOurs(id: number) { return readLog().some((e) => e.id === id && (e.name ?? '').startsWith(PREFIX)); }

export function stateFile() {
  return process.env.FRESHSALES_SESSION_STATE_FILE ||
    path.resolve(__dirname, '../../../../playwright-tests/freshsales/.auth/freshsales-handoff.json');
}
export function hasStateFile() { try { return fs.statSync(stateFile()).size > 0; } catch { return false; } }

export type Mut = { ctx: APIRequestContext; raw: APIRequestContext; csrf: string; hdr: Record<string, string> };

export async function newMutCtx(playwright: PlaywrightWorkerArgs['playwright']): Promise<Mut> {
  const raw = await playwright.request.newContext({ baseURL: TENANT, storageState: stateFile(), extraHTTPHeaders: { Accept: 'application/json' } });
  const page = await raw.get('/crm/sales/dashboard', { headers: { Accept: 'text/html' } });
  const html = await page.text();
  const m = html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/) || html.match(/<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/);
  const csrf = m ? m[1] : '';
  const ctx = MUTATIONS_ALLOWED ? raw : guardRequest(raw);
  return { ctx, raw, csrf, hdr: { 'X-CSRF-Token': csrf, Origin: TENANT, Referer: `${TENANT}/crm/sales/`, 'Content-Type': 'application/json' } };
}

export const sfx = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
export const tplName = (tag = '') => `${PREFIX} ${sfx()}${tag ? ' ' + tag : ''}`;

/** Create a template named "ZZ API ..." (private by default) and log it immediately. NOTE: html_content is effectively required (500 without it). */
export async function createTpl(m: Mut, name = tplName(), fields: Record<string, unknown> = { subject: 'ZZ API subject', html_content: '<p>ZZ API body</p>' }) {
  if (!name.startsWith(PREFIX)) throw new Error('refusing to create a template without the ZZ API prefix');
  const r = await m.ctx.post(T, { headers: m.hdr, data: { email_template: { name, ...fields } } });
  const json: any = await r.json().catch(() => ({}));
  const id = json?.email_template?.id as number | undefined; // create returns SINGULAR key; GET detail returns plural
  if (id) recordCreated(id, name);
  return { r, json, id, name };
}

/** DELETE, only for ids this suite created (logged + ZZ API-prefixed). Never touches seeded Public templates. */
export async function deleteTpl(m: Mut, id: number) {
  if (!isOurs(id)) throw new Error(`refusing to delete template ${id}: not created by this suite`);
  const r = await m.ctx.delete(`${T}/${id}`, { headers: m.hdr });
  if (r.status() === 200 || r.status() === 204 || r.status() === 404) markDeleted(id);
  return r;
}

export async function sweep(m: Mut | undefined, ids: number[]) {
  if (!m) return;
  for (const id of ids) {
    if (!readLog().some((e) => e.id === id && !e.deleted)) continue;
    try { await deleteTpl(m, id); } catch { /* leave logged as not-deleted so a leak is visible */ }
  }
}
