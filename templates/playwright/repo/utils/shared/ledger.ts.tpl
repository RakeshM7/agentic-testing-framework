// Every entity a test creates is recorded in the framework's ledger right after it is created, and deleted only when
// owns() says the CURRENT run created it (docs/playwright-conventions.md, "Safety in code"). The ledger is written
// only through the framework's scripts/ledger.mjs, found through ATF_REPO_ROOT. In full-run a failed ledger call
// throws: an entity the ledger does not know could never be cleaned up.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { env, isFullRun } from './env';

export type Entity = { type: string; ref: string; module: string; label?: string; stage?: string };

function ledger(args: string[]): string {
  const root = env.repoRoot();
  if (!root) throw new Error('ATF_REPO_ROOT is not set: the ledger (scripts/ledger.mjs) cannot be reached');
  return execFileSync(process.execPath, [path.join(root, 'scripts', 'ledger.mjs'), ...args], { encoding: 'utf8', stdio: 'pipe' });
}

const stageOf = (e: Entity): string => e.stage ?? process.env.ATF_STAGE ?? 'playwright';

export function recordCreated(e: Entity): void {
  const args = ['add', env.product(), '--type', e.type, '--ref', e.ref, '--module', e.module, '--stage', stageOf(e), '--agent', 'playwright'];
  if (e.label) args.push('--label', e.label);
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
