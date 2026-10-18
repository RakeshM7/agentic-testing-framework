// Synthetic data unique per VU and iteration, and the record of entities a mutating scenario could not delete.
import { check } from 'k6';

// The check-name prefix that carries a leftover to handleSummary (lib/summary.js): k6 shares no state between VUs and
// handleSummary, but every check's name reaches the summary.
export const LEFTOVER_PREFIX = 'ATF_LEFTOVER ';

export function uniqueName(prefix) {
  return `${prefix || 'ATF'}-${__VU}-${__ITER}-${Date.now().toString(36)}`;
}

export function uniqueEmail(prefix) {
  return `${uniqueName(prefix || 'atf').toLowerCase()}@example.test`;
}

// Records an entity this iteration created but could not delete; the summary writes it to
// results/<script>.created.json ([{type, ref}]) for the runner to put in the ledger.
export function trackLeftover(type, ref) {
  check(null, { [`${LEFTOVER_PREFIX}${JSON.stringify({ type: String(type), ref: String(ref) })}`]: () => true });
}
