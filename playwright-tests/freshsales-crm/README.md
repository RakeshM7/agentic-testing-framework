# freshsales-crm -- Playwright tests

UI and API tests for **freshsales-crm**, generated and maintained by the agentic testing framework.
Code rules and ownership: `docs/playwright-conventions.md` in the framework repo.

## Setup

```sh
npm install
npx playwright install chromium
cp .env.example .env      # then fill in the values below
```

### `.env`

All configuration comes from `.env` (or the runner's environment, which takes precedence). Nothing is hard-coded.
Never commit `.env` or anything under `.auth/` -- both are git-ignored.

| Name | Purpose |
|---|---|
| `BASE_URL` | Target application URL (UI `baseURL`). |
| `API_BASE_URL` | Target API URL (`baseURL` of the `setup-api` / `api` projects; falls back to `BASE_URL`). |
| `STORAGE_STATE` | Optional path to a human-produced Playwright storage state (e.g. `.auth/state.json`); relative paths resolve from this folder. Applied to every project when set. |
| `ATF_MODE` | `readonly` (default when empty) or `full-run`. Set by the runner from the framework's `state/run.json`. |
| `ATF_PRODUCT` | Product slug (`freshsales-crm`), used for ledger calls. |
| `ATF_RUN_ID` | Current run id; embedded in test data by `uniqueName()` and used to trace created entities. |
| `ATF_REPO_ROOT` | Absolute path to the framework repo root (for `scripts/ledger.mjs`). |
| `ATF_STAGE`, `ATF_AGENT` | Optional ledger metadata overrides (defaults `playwright`, `playwright-test`). |

Credentials, if a test needs them, are read only from the `.env` file the run-config's `credentials_file` points to,
via `required(name)` / `optional(name)` in `utils/shared/env.ts`.

## Running

```sh
npm run test:ui       # setup-ui -> ui        (tests/ui)
npm run test:api      # setup-api -> api      (tests/api)
npm run typecheck     # tsc --noEmit
```

Inside the pipeline the runner-triager agents run a single module with a JSON report, e.g.:

```sh
ATF_MODE=<mode> ATF_PRODUCT=freshsales-crm ATF_RUN_ID=<run> ATF_REPO_ROOT=<framework repo> \
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/ui/<module>-report.json \
npx playwright test --project=ui tests/ui/<module> --reporter=list,json
```

## What `ATF_MODE` does

- **`readonly`** (default, also when unset): the config sets `grepInvert: /@mutates/`, so any test that creates,
  changes or deletes data is skipped. UI fixtures abort non-GET/HEAD/OPTIONS requests to the product host and API
  fixtures make non-GET calls throw (auth setup files excepted). An unknown value is rejected with an error.
- **`full-run`**: must be set explicitly by a human authorized to test the target. `@mutates` tests run; every
  created entity is recorded with `recordCreated()` (`utils/shared/ledger.ts`), deleted only when `owns()` is true,
  then recorded with `recordDeleted()`. A failed ledger call throws in this mode.

## Layout

```
playwright.config.ts, package.json, tsconfig.json, .env.example, utils/shared/   shared (pw-repo-owner)
config/ui/  fixtures/ui/  helpers/ui/  pages/<m>/    tests/ui/<m>/              UI side
config/api/ fixtures/api/ helpers/api/ clients/<m>/  tests/api/<m>/             API side
.auth/  test-results/{ui,api}/  playwright-report/                              git-ignored
```
