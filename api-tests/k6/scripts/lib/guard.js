// Refuses to run a load test against an implicit or non-allowlisted host.
// BASE_URL must be set explicitly, and its hostname must appear in K6_ALLOWED_HOSTS
// (comma-separated; localhost/127.0.0.1 are always allowed). k6 itself has no safe default:
// a third-party public host must never be hammered because someone forgot a flag.
//
//   K6_ALLOWED_HOSTS=my-staging.example.com BASE_URL=https://my-staging.example.com/api k6 run ...
export function requireBaseUrl(baseUrl) {
  if (!baseUrl) {
    throw new Error('BASE_URL is required (no default): set it to a host you own or are authorized to load-test.');
  }
  const host = baseUrl.replace(/^[a-z]+:\/\//i, '').split(/[/:?#]/)[0].toLowerCase();
  const allowed = (__ENV.K6_ALLOWED_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean)
    .concat(['localhost', '127.0.0.1']);
  if (!allowed.includes(host)) {
    throw new Error(`Host '${host}' is not in K6_ALLOWED_HOSTS (${allowed.join(', ')}); refusing to run.`);
  }
  return baseUrl;
}
