// Unique, traceable test data per run.
import { optional } from './env';

let counter = 0;

/**
 * `<prefix>-<runId>-<timestamp><counter>`, e.g. `atf-contact-run-20261007-1a2b3c-k9x2f01`.
 * Includes ATF_RUN_ID (or `local` when unset) so every created entity can be traced to its run.
 */
export function uniqueName(prefix: string): string {
  const runId = (optional('ATF_RUN_ID') ?? 'local').replace(/[^A-Za-z0-9-]/g, '-');
  counter += 1;
  const stamp = Date.now().toString(36) + counter.toString(36).padStart(2, '0');
  return `${prefix}-${runId}-${stamp}`;
}
