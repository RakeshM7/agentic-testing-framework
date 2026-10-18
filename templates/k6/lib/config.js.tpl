// The target and the code-level safety every script calls in setup(): assertAllowedHost() and
// requireFullRun(mutates). There is no default BASE_URL.
import { settings } from './settings.js';

export const BASE_URL = __ENV.BASE_URL;

const ALLOWED_HOSTS = String(__ENV.K6_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim().toLowerCase())
  .filter((h) => h.length > 0);

// The host part of an absolute URL (scheme://host[:port]/...), or null.
export function hostOf(url) {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:]+)/i.exec(String(url || ''));
  return m ? m[1].toLowerCase() : null;
}

// Throws (aborting the test in setup()) unless BASE_URL's host is in K6_ALLOWED_HOSTS.
export function assertAllowedHost() {
  if (!BASE_URL) throw new Error('BASE_URL is not set: pass it with -e BASE_URL=<target>; there is no default');
  const host = hostOf(BASE_URL);
  if (!host || ALLOWED_HOSTS.indexOf(host) < 0)
    throw new Error(`BASE_URL host ${host} is not in K6_ALLOWED_HOSTS (${ALLOWED_HOSTS.join(', ') || 'empty'}): refusing to send load`);
}

// Throws when the scenario changes data and the run is not full-run.
export function requireFullRun(mutates) {
  if (mutates && __ENV.ATF_MODE !== 'full-run') throw new Error('this scenario changes data: it runs only when ATF_MODE=full-run');
}

// BASE_URL + the configured base path + path.
export function url(path) {
  const base = String(BASE_URL || '').replace(/\/+$/, '') + String(settings.basePath || '').replace(/\/+$/, '');
  return `${base}/${String(path).replace(/^\/+/, '')}`;
}
