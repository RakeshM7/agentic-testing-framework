// Resolve the Freshsales session Cookie header in k6's init context.
// Order: -e FRESHSALES_SESSION_COOKIE, else the storageState hand-off file given by
// -e FRESHSALES_SESSION_STATE_FILE (default playwright-tests/freshsales/.auth/freshsales-handoff.json, relative
// to this lib dir). Values are never logged.
const HOST = 'rakesh-freshsales-ind-sep21.myfreshworks.com';
const DEFAULT_FILE = '../../../playwright-tests/freshsales/.auth/freshsales-handoff.json';

export function loadSessionCookie(openFn) {
  if (__ENV.FRESHSALES_SESSION_COOKIE) return __ENV.FRESHSALES_SESSION_COOKIE;
  try {
    const state = JSON.parse(openFn(__ENV.FRESHSALES_SESSION_STATE_FILE || DEFAULT_FILE));
    return state.cookies
      .filter((c) => c.domain.replace(/^\./, '') === HOST || c.domain.replace(/^\./, '') === 'myfreshworks.com')
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  } catch (e) {
    return '';
  }
}
