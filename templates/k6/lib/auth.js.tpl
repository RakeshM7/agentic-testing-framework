// Request headers for the configured auth scheme, from K6_USER / K6_PASSWORD / K6_TOKEN only; never literals, and
// never logged.
import encoding from 'k6/encoding';
import { settings } from './settings.js';

export function authHeaders() {
  const auth = settings.auth;
  const token = __ENV.K6_TOKEN;
  switch (auth.scheme) {
    case 'bearer':
    case 'oauth2':
      return token ? { [auth.header || 'Authorization']: `${auth.prefix}${token}` } : {};
    case 'api-key':
      return token && auth.header ? { [auth.header]: `${auth.prefix}${token}` } : {};
    case 'basic':
      return __ENV.K6_USER && __ENV.K6_PASSWORD ? { Authorization: `Basic ${encoding.b64encode(`${__ENV.K6_USER}:${__ENV.K6_PASSWORD}`)}` } : {};
    case 'session':
      return token ? { Cookie: `${auth.cookie || 'session'}=${token}` } : {};
    default:
      return {};
  }
}

// Request params with the default headers, the auth headers and any extra headers or tags.
export function params(extra) {
  const e = extra || {};
  return { headers: Object.assign({}, settings.defaultHeaders, authHeaders(), e.headers || {}), tags: e.tags || {} };
}
