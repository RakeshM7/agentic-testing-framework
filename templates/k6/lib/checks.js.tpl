// Check helpers every script uses: status, JSON shape (key presence) and latency.
import { check } from 'k6';

export function checkStatus(res, expected, name) {
  const want = Array.isArray(expected) ? expected : [expected];
  return check(res, { [name || `status is ${want.join(' or ')}`]: (r) => want.indexOf(r.status) >= 0 });
}

export function checkJsonKeys(res, keys, name) {
  return check(res, {
    [name || `body has ${keys.join(', ')}`]: (r) => {
      let body;
      try {
        body = r.json();
      } catch (e) {
        return false;
      }
      return body !== null && typeof body === 'object' && keys.every((k) => Object.prototype.hasOwnProperty.call(body, k));
    },
  });
}

export function checkLatency(res, maxMs, name) {
  return check(res, { [name || `latency under ${maxMs} ms`]: (r) => r.timings.duration < maxMs });
}
