import fs from 'fs';
import path from 'path';
import { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test';
import { guardRequest, MUTATIONS_ALLOWED } from '../../fixtures/mutationGuard';

// Sales-sequences track helpers (track-local; shared fixtures untouched).
//  - created-entities log at <trackRoot>/api/created-entities.json (mkdir lock for read-modify-write);
//    DELETE helper refuses any id not in the log AND any sequence whose name does not start with "ZZ Seq API".
//  - Rails CSRF token fetched from an HTML page (see feedback/api-testing-agent/2026-10-05-freshsales-csrf-required-for-mutations.md).
//  - Sequences are only ever created Inactive (status 2); no activation, no enrolment, no email/SMS.

const LOG = path.resolve(__dirname, '../../../../artifacts/rakesh-freshsales-ind-sep21/modules/sales-sequences/api/created-entities.json');
export const TENANT = 'https://rakesh-freshsales-ind-sep21.myfreshworks.com';
export const PREFIX = 'ZZ Seq API';
export const B = '/crm/sales/sales_sequences';

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
  locked(() => { const a = readLog(); a.push({ id, resource: 'sales_sequence', endpoint: B, name, createdAt: new Date().toISOString() }); write(a); });
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

export type Mut = { ctx: APIRequestContext; csrf: string; hdr: Record<string, string>; owner: number };

export async function newMutCtx(playwright: PlaywrightWorkerArgs['playwright']): Promise<Mut> {
  const raw = await playwright.request.newContext({ baseURL: TENANT, storageState: stateFile(), extraHTTPHeaders: { Accept: 'application/json' } });
  const page = await raw.get('/crm/sales/dashboard', { headers: { Accept: 'text/html' } });
  const html = await page.text();
  const m = html.match(/<meta[^>]*name="csrf-token"[^>]*content="([^"]+)"/) || html.match(/<meta[^>]*content="([^"]+)"[^>]*name="csrf-token"/);
  const csrf = m ? m[1] : '';
  const ctx = MUTATIONS_ALLOWED ? raw : guardRequest(raw);
  // Owner id for task steps: the session user (taken from an existing sequence-less source: /crm/sales/api/... is not
  // needed -- the users list in GET /sales_sequences is empty on an empty tenant, so fall back to the selectors endpoint).
  let owner = Number(process.env.FRESHSALES_SEQ_OWNER_ID || 0);
  if (!owner) {
    const s = await raw.get('/crm/sales/selector/owners').catch(() => undefined);
    const j: any = s && s.ok() ? await s.json().catch(() => ({})) : {};
    owner = j?.users?.[0]?.id ?? 402000463933;
  }
  return { ctx, csrf, owner, hdr: { 'X-CSRF-Token': csrf, Origin: TENANT, Referer: `${TENANT}/crm/sales/`, 'Content-Type': 'application/json' } };
}

export const sfx = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;
export const seqName = (tag = '') => `${PREFIX} ${sfx()}${tag ? ' ' + tag : ''}`;

const emptyFilter = (op: string) => ({ filter_options: { logic_type: 'simple', simple_logic_operator: op, logic: '', filter_rules: [] } });

/** Request body shape captured from the live UI (POST /crm/sales/sales_sequences). category 2 = contact, status 2 = Inactive. */
export function seqBody(m: Mut, name: string, over: Record<string, unknown> = {}, steps?: unknown[]) {
  return {
    name, category: 2, sequence_type: 1, status: 2,
    entry_conditions: { ...emptyFilter('AND'), exclude_duplicate: true, include_all_contacts: false, view_id: null, condition_flow: true, throttle_limit: null },
    exit_conditions: { ...emptyFilter('OR'), max_days_in_campaign: 21, remove_unsubscribed: true, remove_email_bounced: true, remove_email_replied: true, remove_without_owner: true },
    template_id: null,
    schedule: { frequency: 6, interval: 1, interval_hour: 11, interval_min: 30, time_zone: 'UTC', run_type: true },
    sales_sequence_steps: steps ?? [taskStep(m)],
    ...over,
  };
}
export function taskStep(m: Mut, over: Record<string, unknown> = {}) {
  return {
    conditions: emptyFilter('AND'), exit_conditions: emptyFilter('AND'),
    position: 1, action_type: 2, execution_day: 1, step_delay: null, delay_type: null,
    entity_params: { model: 'Contact', title: 'Follow-up task', owner: String(m.owner), due_date: { time: '11:30' } },
    _destroy: false, sales_sequence_id: null, ...over,
  };
}

/** Create an Inactive ZZ Seq API sequence and log it immediately. */
export async function createSeq(m: Mut, name = seqName(), over: Record<string, unknown> = {}, steps?: unknown[]) {
  if (!name.startsWith(PREFIX)) throw new Error('refusing to create a sequence without the ZZ Seq API prefix');
  const r = await m.ctx.post(B, { headers: m.hdr, data: { sales_sequence: seqBody(m, name, over, steps) } });
  const json: any = await r.json().catch(() => ({}));
  const id = json?.sales_sequence?.id as number | undefined;
  if (id) recordCreated(id, name);
  return { r, json, id, name };
}

/** DELETE, only for ids this suite created (logged + ZZ Seq API-prefixed). */
export async function deleteSeq(m: Mut, id: number) {
  if (!isOurs(id)) throw new Error(`refusing to delete sequence ${id}: not created by this suite`);
  const r = await m.ctx.delete(`${B}/${id}`, { headers: m.hdr });
  if (r.status() === 200 || r.status() === 204 || r.status() === 404) markDeleted(id);
  return r;
}

export async function sweep(m: Mut | undefined, ids: number[]) {
  if (!m) return;
  for (const id of ids) {
    if (!readLog().some((e) => e.id === id && !e.deleted)) continue;
    try { await deleteSeq(m, id); } catch { /* leave logged as not-deleted so the leak is visible */ }
  }
}
