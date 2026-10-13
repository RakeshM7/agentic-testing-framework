# k6 conventions (`k6-tests/<product>/`)

## Layout and ownership

```
lib/          k6-lib-writer      config.js, auth.js, checks.js, data.js, summary.js
scripts/      k6-script-writer   <m>-<scenario>.js, one workload entry (K6-<m>-<n>) per file
results/      k6-runner-triager  <script>.summary.json (git-ignored)
README.md     k6-lib-writer      how to run, env vars
```

## Safety in code

- `lib/config.js` reads `BASE_URL` and `K6_ALLOWED_HOSTS` (comma-separated) from `__ENV` and **aborts in `setup()`** unless `BASE_URL`'s host is in the list. There is no default `BASE_URL`.
- A script whose workload entry has `mutates: true` aborts unless `__ENV.ATF_MODE === 'full-run'`. k6 cannot call the ledger, so a mutating scenario deletes everything it creates within the same iteration, and appends the ref of anything it could not delete to `results/<script>.created.json` (`[{type, ref}]`); the runner-triager records those in the ledger (`ledger.mjs add`) so they appear on the run's cleanup list.
- Live runs happen only in full-run runs (the guard enforces `load: run`); in readonly runs scripts are validated with `k6 inspect` only and results are recorded as `not-run`.

## Code rules

- Every script: `export const options = { scenarios, thresholds }` taken exactly from `workload.json`; `export { handleSummary } from '../lib/summary.js'`.
- `lib/summary.js` `handleSummary(data)` writes `results/<script>.summary.json` (the raw `data` object) and a short text summary to stdout.
- Checks via `lib/checks.js` helpers (status, JSON shape, latency); no `sleep()` without a think-time reason in a comment.
- Auth via `lib/auth.js` using env values only (`K6_USER`, `K6_PASSWORD`, or `K6_TOKEN`); never literals.
- `k6 inspect scripts/<file>.js` must succeed before handing back.

## Running (k6-runner-triager only)

```
ATF_MODE=full-run BASE_URL=<target> K6_ALLOWED_HOSTS=<target host> k6 run scripts/<m>-<scenario>.js
node <repo>/scripts/results.mjs k6 <p> <m> k6-tests/<p>/results/<m>-*.summary.json
```
Readonly run: `node <repo>/scripts/results.mjs not-run <p> <m> k6 --reason "readonly run: load tests only run in full-run"`.
