// Every entity a test creates is recorded in the framework's ledger right after it is created, and deleted only when
// owns() says the CURRENT run created it (docs/playwright-conventions.md, "Safety in code"). The ledger is written
// only through the framework's scripts/ledger.mjs, found through ATF_REPO_ROOT. In full-run a failed ledger call
// throws: an entity the ledger does not know could never be cleaned up.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { env, isFullRun } from './env';

// `ref` is the id the product itself uses for the entity (what its URLs carry), so the run-time guard below can match it.
// `cleanup` names the catalogue's delete endpoint and the path parameter that takes the ref, for `ledger.mjs sweep` (D-075).
export type Entity = { type: string; ref: string; module: string; label?: string; stage?: string; cleanup?: { endpoint: string; param: string } };

function ledger(args: string[]): string {
  const root = env.repoRoot();
  if (!root) throw new Error('ATF_REPO_ROOT is not set: the ledger (scripts/ledger.mjs) cannot be reached');
  return execFileSync(process.execPath, [path.join(root, 'scripts', 'ledger.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' });
}

const stageOf = (e: Entity): string => e.stage ?? process.env.ATF_STAGE ?? 'playwright';

export function recordCreated(e: Entity): void {
  const args = ['add', env.product(), '--type', e.type, '--ref', e.ref, '--module', e.module, '--stage', stageOf(e), '--agent', 'playwright'];
  if (e.label) args.push('--label', e.label);
  if (e.cleanup) args.push('--cleanup-endpoint', e.cleanup.endpoint, '--cleanup-param', e.cleanup.param);
  try {
    ledger(args);
  } catch (err) {
    if (isFullRun()) throw err;
  }
}

export function owns(type: string, ref: string): boolean {
  try {
    ledger(['owns', env.product(), '--type', type, '--ref', ref]);
    return true;
  } catch {
    return false;
  }
}

export function recordDeleted(e: Entity): void {
  try {
    ledger(['deleted', env.product(), '--type', e.type, '--ref', e.ref, '--module', e.module, '--stage', stageOf(e), '--agent', 'playwright']);
  } catch (err) {
    if (isFullRun()) throw err;
  }
}

// Whether any of `refs` is a live entity this run created, of any type (the ids in a URL carry no type).
export function ownsAny(refs: string[]): boolean {
  try {
    ledger(['owns', env.product(), ...refs.flatMap((r) => ['--ref', r])]);
    return true;
  } catch {
    return false;
  }
}

// D-074: in a full-run, a destructive request to the product -- any DELETE, or another non-safe method whose path names
// a destructive action -- may reach only an entity this run created and still holds: one of its path segments or query
// values must be the ref of a live entity of this run. An unreachable ledger refuses (fails closed).
// -> null when the request may go, otherwise why it may not
const SAFE = ['GET', 'HEAD', 'OPTIONS'];
const DESTRUCTIVE = new Set(['delete', 'destroy', 'remove', 'purge', 'cancel', 'revoke', 'archive', 'deactivate', 'disable', 'erase', 'trash', 'wipe']);
const words = (s: string): string[] => s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export function destructiveRefusal(method: string, url: string): string | null {
  const m = method.toUpperCase();
  if (SAFE.includes(m)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return `Delete blocked by the ledger guard (D-005): ${m} ${url} is not an absolute URL, so no entity of this run can be read from it`;
  }
  const segments = u.pathname.split('/').filter(Boolean).map(decode);
  if (m !== 'DELETE' && !segments.some((s) => words(s).some((w) => DESTRUCTIVE.has(w)))) return null;
  const refs = [...new Set([...segments, ...u.searchParams.values()])];
  if (refs.length && ownsAny(refs)) return null;
  return `Delete blocked by the ledger guard (D-005): ${m} ${u.pathname} names no entity this run created. Record the product's own id as the ref with recordCreated, and delete only what owns() confirms.`;
}
