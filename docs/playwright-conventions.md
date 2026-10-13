# Playwright repo conventions (`playwright-tests/<product>/`)

One repo per product holds both UI and API tests. Every Playwright agent follows this file; reviewers check against it.

## Layout and ownership

```
package.json, package-lock.json, playwright.config.ts, tsconfig.json,
.env.example, .gitignore, README.md, utils/shared/          pw-repo-owner (only)
config/ui/   fixtures/ui/   helpers/ui/   pages/<m>/   tests/ui/<m>/        UI agents
config/api/  fixtures/api/  helpers/api/  clients/<m>/ tests/api/<m>/       API agents
.auth/ (git-ignored storage state)   test-results/{ui,api}/ (git-ignored)
```
A change to a file you don't own is a request in your report to your orchestrator — never an edit.

## Projects (`playwright.config.ts`)

`setup-ui` (testMatch `fixtures/ui/*.setup.ts`) → `ui` (testDir `tests/ui`, depends on `setup-ui`), `setup-api` (`fixtures/api/*.setup.ts`) → `api` (testDir `tests/api`). TypeScript, `fullyParallel: false` by default, retries `1`, trace `retain-on-failure`, reporter `list` (the runner adds `json`).

## Environment (`utils/shared/env.ts`; values from `.env`, never hard-coded)

`BASE_URL`, `API_BASE_URL`, `STORAGE_STATE` (path to a human-produced storage state, optional), `ATF_MODE` (`readonly` | `full-run`, set by the runner from `state/run.json`), `ATF_PRODUCT`, `ATF_RUN_ID`, `ATF_REPO_ROOT` (framework repo root, for the ledger). Credentials only via the `.env` file the run-config's `credentials_file` points to. `.env.example` lists names with empty values.

## Safety in code

- A test that creates, changes or deletes data has `@mutates` in its title. The config sets `grepInvert: /@mutates/` unless `ATF_MODE === 'full-run'`.
- UI fixtures install a mutation guard: when `ATF_MODE !== 'full-run'`, requests to the product's host with a method other than GET/HEAD/OPTIONS are aborted. API fixtures wrap `request` so non-GET calls throw outside full-run. Auth setup files are the only exemption (they must log in).
- Every entity a test creates is recorded immediately with `recordCreated({ type, ref, module, label })` from `utils/shared/ledger.ts` (it runs `node $ATF_REPO_ROOT/scripts/ledger.mjs add …`), deleted only after `owns(type, ref)` is true, and recorded with `recordDeleted`. Clean up in `afterEach`/`afterAll`.
- Test data is unique per run: `uniqueName(prefix)` from `utils/shared/data.ts` (includes `ATF_RUN_ID`).

## Code rules

- Test titles start with the test case id: `test('TC-contacts-3 creates a contact with required fields @mutates', …)`. One `describe` per test case group; tags in titles mirror the test case tags (`@p1`, `@negative`, …).
- Locators: `getByRole` / `getByLabel` / `getByPlaceholder` / `getByTestId` first; text copied verbatim from `explore/pages/<slug>/dom-snapshot.md`; CSS/XPath only when nothing else exists, with a comment why.
- No `waitForTimeout`, no fixed sleeps; web-first assertions (`await expect(locator).toBeVisible()`).
- Page objects (`pages/<m>/<page>.page.ts`): class per page, constructor `(page: Page)`, locators as readonly properties, actions as async methods, **no assertions**.
- API clients (`clients/<m>/<resource>.client.ts`): class per resource wrapping `APIRequestContext`, typed request/response, **no assertions**.
- Helpers (`helpers/<side>/`): pure functions (builders, formatters, parsers); no Playwright fixtures inside.
- Fixtures (`fixtures/<side>/index.ts`): `export const test = base.extend<…>()` providing page objects/clients, the mutation guard and auth; `export { expect }`.
- Visual checks (`@visual` cases): `toHaveScreenshot()` with masks for dynamic regions; baselines are created by the runner with `--update-snapshots` only when none exist.
- `npx tsc --noEmit` must pass before handing back.

## Running (runner-triagers only)

```
ATF_MODE=<run mode> ATF_PRODUCT=<p> ATF_RUN_ID=<run> ATF_REPO_ROOT=<repo> \
PLAYWRIGHT_JSON_OUTPUT_NAME=test-results/<side>/<m>-report.json \
npx playwright test --project=<side> tests/<side>/<m> --reporter=list,json
node $ATF_REPO_ROOT/scripts/results.mjs playwright <p> <m> <side> playwright-tests/<p>/test-results/<side>/<m>-report.json
```
