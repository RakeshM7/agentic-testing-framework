// Synthetic data unique per VU and iteration, and the record of the entities a mutating scenario created and deleted.
import { check } from 'k6';

// The check-name prefixes that carry a created, a deleted and an untracked entity to handleSummary (lib/summary.js):
// k6 shares no state between VUs and handleSummary, but every check's name reaches the summary.
export const LEFTOVER_PREFIX = 'ATF_LEFTOVER ';
export const DELETED_PREFIX = 'ATF_DELETED ';
export const UNTRACKED_PREFIX = 'ATF_UNTRACKED ';

export function uniqueName(prefix) {
  return `${prefix || 'ATF'}-${__VU}-${__ITER}-${Date.now().toString(36)}`;
}

export function uniqueEmail(prefix) {
  return `${uniqueName(prefix || 'atf').toLowerCase()}@example.test`;
}

// A random element of an array (undefined for an empty one or a non-array), e.g. one of the setup data's ids.
export function pick(array) {
  return Array.isArray(array) && array.length ? array[Math.floor(Math.random() * array.length)] : undefined;
}

// Records an entity this iteration created, right after the create (safe when the iteration aborts later); the summary
// writes every one not later deleted to results/<script>.created.json ([{type, ref}]) for the runner to put in the ledger.
export function trackLeftover(type, ref) {
  check(null, { [`${LEFTOVER_PREFIX}${JSON.stringify({ type: String(type), ref: String(ref) })}`]: () => true });
}

// Records that this iteration deleted an entity it created (call it only after a 2xx delete), so the summary drops it
// from the leftovers.
export function trackDeleted(type, ref) {
  check(null, { [`${DELETED_PREFIX}${JSON.stringify({ type: String(type), ref: String(ref) })}`]: () => true });
}

// The identity-shaped values of a create's response: id, _id, uuid or <type>Id / <type>_id (type singular) at the top
// level or under data, result, item or the type's own key, and the last segment of a Location header. Never another
// field (ownerId, accountId): that may name pre-existing data.
function idLikeValues(res, type) {
  const one = String(type || '').replace(/s$/, '');
  const keys = ['id', '_id', 'uuid', `${one}Id`, `${one}_id`];
  const out = [];
  let body;
  try {
    body = res.json();
  } catch (e) {
    body = null;
  }
  const scan = (o) => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return;
    for (const k of keys) if (typeof o[k] === 'string' || typeof o[k] === 'number') out.push(String(o[k]));
  };
  scan(body);
  if (body && typeof body === 'object') for (const w of ['data', 'result', 'item', one, String(type || '')]) scan(body[w]);
  const loc = res.headers && (res.headers.Location || res.headers.location);
  if (loc) {
    const last = String(loc).split('?')[0].replace(/\/+$/, '').split('/').pop();
    if (last) {
      try {
        out.push(decodeURIComponent(last));
      } catch (e) {
        out.push(last);
      }
    }
  }
  return out.filter((v, i) => v !== '' && out.indexOf(v) === i);
}

// A create that returned its expected status but no id where the flow reads it: the entity exists and must not be
// lost. Logs the response as evidence, tracks every identity-shaped value it carries (trackLeftover), and when there
// is none records an untracked create, which handleSummary reports for the triager to flag.
export function untrackedCreate(type, res) {
  console.warn(`ATF untracked create of ${type}: status ${res.status}, Location ${(res.headers && (res.headers.Location || res.headers.location)) || '-'}, body ${String(res.body || '').slice(0, 500)}`);
  const ids = idLikeValues(res, type);
  for (const id of ids) trackLeftover(type, id);
  if (!ids.length) check(null, { [`${UNTRACKED_PREFIX}${JSON.stringify({ type: String(type), status: res.status })}`]: () => true });
}
