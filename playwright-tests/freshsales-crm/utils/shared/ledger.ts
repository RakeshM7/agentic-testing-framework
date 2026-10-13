// Ledger of entities this run created in the target. Thin wrapper over the framework's
// `node $ATF_REPO_ROOT/scripts/ledger.mjs`; the run id is taken by the script from the product's active run.
// Rules: call recordCreated immediately after creating anything; delete only when owns() is true; then
// recordDeleted. In full-run mode a failed ledger call throws (an unrecorded entity must never go unnoticed).
import { execFileSync } from 'child_process';
import path from 'path';
import { atfAgent, atfProduct, atfRepoRoot, atfStage, isFullRun } from './env';

export interface LedgerEntity {
  /** Entity type, e.g. 'contact', 'deal'. */
  type: string;
  /** Stable reference in the target, e.g. the id returned by the API or shown in the URL. */
  ref: string;
  /** Module slug, e.g. 'contacts'. */
  module: string;
  /** Human-readable label (usually the uniqueName used to create it). */
  label?: string;
  url?: string;
  note?: string;
}

function script(): string {
  return path.join(atfRepoRoot(), 'scripts', 'ledger.mjs');
}

function flags(pairs: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(pairs)) if (v !== undefined && v !== '') out.push(`--${k}`, v);
  return out;
}

function run(args: string[]): void {
  execFileSync(process.execPath, [script(), ...args], {
    cwd: atfRepoRoot(),
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
}

function fail(action: string, e: unknown): void {
  const err = e as { message?: string; stderr?: string };
  const detail = (err.stderr || err.message || String(e)).trim();
  const msg = `ledger ${action} failed: ${detail}`;
  if (isFullRun()) throw new Error(msg);
  console.warn(`[ledger] ${msg} (ignored outside full-run)`);
}

/** Record an entity this run just created. */
export function recordCreated(e: LedgerEntity): void {
  try {
    run([
      'add',
      atfProduct(),
      ...flags({ type: e.type, ref: e.ref, module: e.module, stage: atfStage(), agent: atfAgent(), label: e.label, url: e.url, note: e.note }),
    ]);
  } catch (err) {
    fail('add', err);
  }
}

/** Record that an owned entity was deleted. */
export function recordDeleted(e: Pick<LedgerEntity, 'type' | 'ref' | 'module' | 'note'>): void {
  try {
    run(['deleted', atfProduct(), ...flags({ type: e.type, ref: e.ref, module: e.module, stage: atfStage(), agent: atfAgent(), note: e.note })]);
  } catch (err) {
    fail('deleted', err);
  }
}

/**
 * True only if the CURRENT run created the entity and it is still live. Exit code 1 from the script means
 * "not owned" (false); any other failure throws in full-run and returns false otherwise -- never true by default.
 */
export function owns(type: string, ref: string): boolean {
  try {
    run(['owns', atfProduct(), ...flags({ type, ref })]);
    return true;
  } catch (err) {
    if ((err as { status?: number }).status === 1) return false;
    fail('owns', err);
    return false;
  }
}
