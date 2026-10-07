# Phase 1 Change Log

Scope: the five "quick win" items from the framework review (schemas + validator, pinned MCP version, CI-friendly Playwright config, CI workflow, personal-data scrub).
Total: **72 files changed** (11 new, 61 modified) versus your second upload (`agentic-testing-framework-main__3_.zip`). Sections 1-11 describe the Phase 1 work and the run-readiness follow-up; section 12 describes how it was applied to your evolved tree (IDURAR, freshsales-help, myapp, mysite).

The agent pipeline itself (agents, orchestrator, handoff paths, resume logic, run-config format) is **unchanged**. The only persona file touched is `claude-agents/explore-agent.md`, and only for the MCP version text.

---

## 1. Behaviour changes (read this first)

These are the changes that can alter how an existing local run behaves.

| # | Change | Before | After | How to get the old behaviour back |
|---|---|---|---|---|
| 1 | Browser mode | `headless: false`, `slowMo: 500` | headless, `slowMo: 0` | `HEADED=1 SLOWMO=500` (or `npm run test:debug` in `playwright-tests/`) |
| 2 | Debug artifacts | trace / screenshot / video always `on` | trace `on-first-retry`, screenshot `only-on-failure`, video `retain-on-failure` | Edit `use:` in `playwright.config.ts` |
| 3 | `setup-freshsales` project | had no baseURL, so `goto('/')` inherited the EventHub URL (bug) | has the Freshsales baseURL | none needed (bug fix) |
| 4 | Wrong-credential login fixture | a real personal address | `known-bad-user@example.com` | see "Open risk" below |
| 5 | Playwright MCP | `@playwright/mcp@latest` | `@playwright/mcp@0.0.83` | change the version in `.mcp.json` and `.vscode/mcp.json` |
| 6 | Reporters (CI only, when `CI` is set) | list + html | github + html + junit | not applicable locally |

**Unchanged by default:** target URLs. EventHub and Freshsales still resolve to the same hosts unless you set `EVENTHUB_BASE_URL`, `EVENTHUB_API_URL` or `FRESHSALES_BASE_URL`.

### Open risk
Change 4 was **not verified against the live EventHub**. `login.spec.ts` (UI and API) expects HTTP 400 with the toast "Invalid email or password". A non-registered `example.com` address should behave the same, but this has not been run live. If the live API returns a different status for an unknown email, set the fixture back to a known-bad address of your own.

---

## 2. Schemas and validator (new)

| File | Purpose |
|---|---|
| `schemas/run-config.schema.json` | Run-config YAML. Rejects unknown keys, bad enums, inline `KEY=value` in `credentials_file` / `session_state_file`, `answers[].match` shorter than 3 chars. |
| `schemas/models.schema.json` | `config/models.yaml` |
| `schemas/sitemap.schema.json` | `artifacts/<target>/explore/sitemap.json` |
| `schemas/created-entities.schema.json` | `created-entities.json` ledger (`[]` is valid) |
| `schemas/discovered-endpoints.schema.json` | `artifacts/<target>/api/discovered-endpoints.json` (required core fields only; extras allowed) |
| `scripts/validate-artifacts.mjs` | Discovers and validates all of the above. Flags `--strict` (warnings fail) or explicit file paths. Exit 0 ok / 1 errors / 2 usage. |

Semantic checks beyond the schemas (warnings): sitemap files that point to missing screenshots/snapshots, duplicate slugs (error), duplicate ledger or endpoint entries, single-word `answers[].match`, `authenticated_crawl: true` without `session_state_file`, `full-run` combined with `git.auto_commit: true`.

Current result on the repo: 11 files checked, 0 errors, 4 warnings. The warnings are real findings in existing configs (single-word matchers; `authenticated_crawl` without a session file).

## 3. Quality-gate scripts

| File | Change |
|---|---|
| `scripts/check-pii.mjs` (new) | Fails on non-allowlisted e-mail addresses, private keys, JWTs, AWS key ids, long literal secrets, real `.env*` files, and `.auth/` / storageState files. Warns on watched terms. |
| `scripts/pii-allowlist.json` (new) | Allowed e-mail domains/addresses and watched terms. |
| `scripts/sync-agent-models.mjs` | Added `--check` mode: writes nothing, exits 1 if any agent `model:` line drifted from `config/models.yaml`. Default behaviour unchanged. |
| `scripts/package.json`, `package-lock.json` | Added `ajv` and `ajv-formats`; added scripts `validate`, `check:pii`, `check:models`, `check`. |

Run everything: `cd scripts && npm ci && npm run check`.

## 4. Playwright configuration

`playwright-tests/playwright.config.ts`
- baseURLs read from `EVENTHUB_BASE_URL` / `FRESHSALES_BASE_URL` (old URLs remain the defaults).
- `HEADED` and `SLOWMO` env switches; headless by default.
- `trace: 'on-first-retry'`, `screenshot: 'only-on-failure'`, `video: 'retain-on-failure'` (matches `docs/playwright-framework-research.md`).
- CI reporters: github + html + junit.
- `setup-freshsales` now carries the Freshsales baseURL (bug fix).

`api-tests/playwright-api/playwright.config.ts`
- baseURLs read from `EVENTHUB_API_URL` / `FRESHSALES_BASE_URL`; CI reporters as above.

`package.json` (both projects): added `typecheck` and `test:list`; `playwright-tests` also gets `test:debug`.
`playwright-tests/.env.example`: documents the optional overrides.

Visual baselines are still macOS-only (`*-darwin.png`). They cannot pass on a Linux runner until Linux baselines are generated and committed (see the visual-baselines workflow below).

## 5. CI workflows (new)

`.github/workflows/ci.yml`
- `contracts`: `npm run validate`, `npm run check:pii`, `npm run check:models`.
- `typecheck` (matrix over both Playwright projects): `tsc --noEmit` and `playwright test --list`. Touches no live target.
- `e2e-eventhub`: live EventHub functional suite. Manual only (`workflow_dispatch` with `run_e2e: true`), needs the `EVENTHUB_EMAIL` / `EVENTHUB_PASSWORD` repository secrets. Visual specs excluded.

`.github/workflows/visual-baselines.yml`
- Manual. Generates Linux visual baselines and uploads them as an artifact. It never pushes; you review and commit them.

Status: YAML parses and each command was run locally. The workflows have **not** run on a real GitHub runner yet.

## 6. Pinned tooling

`@playwright/mcp@latest` is now `@playwright/mcp@0.0.83` in:
`.mcp.json`, `.vscode/mcp.json`, `README.md`, `claude-agents/explore-agent.md`, `docs/copilot-setup.md`.

## 7. Personal-data scrub

Replaced across code, configs, artifacts, test cases, crawl logs, DOM snapshots and one feedback file:

| Original | Replacement |
|---|---|
| the admin-capable personal Gmail (plus-addressed) | `admin-user@example.com` |
| the wrong-credential personal Gmail | `known-bad-user@example.com` |
| a personal institutional e-mail found in `crawl-log.md` | `org-admin@example.com` |
| a personal display name found in `crawl-log.md` | `Org Admin` |

Plus: `registration.spec.ts` (a skipped `test.fixme`) now uses `process.env.EVENTHUB_EMAIL` for its "already-registered" address instead of a hard-coded one.

Files touched by the scrub: the `artifacts/eventhub/**` text artifacts, two Freshsales artifacts (crawl log, test-case CSV/summary), `config/eventhub-app-wide.yaml`, one feedback file, and the three test/page files listed in section 1.

### Not done (needs your decision)
- **Tenant hostname** appears in about 180 places across 51 files. It is a real hostname, and renaming it would break URLs and artifact paths. `check-pii` prints it as a warning only.
- **16 PNG screenshots** under `artifacts/` cannot be scanned as text. Review them by eye before publishing.
- **Git history** is not touched. If a real password or personal address was ever committed, rewrite history separately.

## 8. Documentation

- `README.md`: new "Quality gates and CI" section; MCP pin.
- `docs/conventions.md`: new "Machine-readable contracts & quality gates" section (schema table, how to run the gates, how to upgrade the pinned MCP).
- `docs/copilot-setup.md`: MCP pin.
- `claude-agents/explore-agent.md`: MCP pin (text only).

## 9. What was verified

| Check | Result |
|---|---|
| `npm run check` from a fresh unzip | pass (0 errors, 0 PII findings, 0 model drift) |
| `tsc --noEmit` in `playwright-tests` and `api-tests/playwright-api` | pass |
| `playwright test --list` | 84 tests (UI project), 113 tests (API project) parse |
| Validator and PII guard against deliberately bad input | all bad cases rejected |
| Env overrides reach the Playwright config | confirmed with a probe |
| Live test runs against EventHub / Freshsales | **not run** |
| GitHub Actions on a real runner | **not run** |

## 10. Complete file list

**New (10)**
`.github/workflows/ci.yml`, `.github/workflows/visual-baselines.yml`, `schemas/created-entities.schema.json`, `schemas/discovered-endpoints.schema.json`, `schemas/models.schema.json`, `schemas/run-config.schema.json`, `schemas/sitemap.schema.json`, `scripts/check-pii.mjs`, `scripts/pii-allowlist.json`, `scripts/validate-artifacts.mjs`

**Modified: tooling, config, tests (19)**
`.mcp.json`, `.vscode/mcp.json`, `README.md`, `docs/conventions.md`, `docs/copilot-setup.md`, `claude-agents/explore-agent.md`, `config/eventhub-app-wide.yaml`, `scripts/package.json`, `scripts/package-lock.json`, `scripts/sync-agent-models.mjs`, `playwright-tests/.env.example`, `playwright-tests/package.json`, `playwright-tests/playwright.config.ts`, `playwright-tests/pages/LoginPage.ts`, `playwright-tests/tests/functional/login.spec.ts`, `playwright-tests/tests/functional/registration.spec.ts`, `api-tests/playwright-api/package.json`, `api-tests/playwright-api/playwright.config.ts`, `api-tests/playwright-api/tests/login.spec.ts`

**Modified: personal-data scrub only (24)**
`artifacts/eventhub/api/api-test-plan.md`, `artifacts/eventhub/clarifications/app-wide-clarifications.md`, `artifacts/eventhub/explore/crawl-log.md`, `artifacts/eventhub/explore/sitemap.json`, `artifacts/eventhub/explore/login-attempt-failed/network-request.json`, `artifacts/eventhub/explore/pages/{admin,event-detail,events,home-authenticated,my-bookings}/{console-log.txt,dom-snapshot.md}` (plus `network-requests.json` for `admin` and `home-authenticated`), `artifacts/eventhub/testcases/{app-wide-testcases,event-booking-testcases,testcases-summary}.md`, `artifacts/rakesh-freshsales-ind-sep21/explore/crawl-log.md`, `artifacts/rakesh-freshsales-ind-sep21/testcases/{lead-to-deal-pipeline-testcases.csv,testcases-summary.md}`, `feedback/playwright-automation-agent/2026-09-20-eventhub-app-wide-suite.md`

Section 11 lists the files added to this set by the run-readiness follow-up.

---

## 11. Run-readiness follow-up (found by actually executing the code)

After Phase 1, the code was exercised (not just type-checked). That surfaced four defects that existed **before** Phase 1 plus two inconsistencies introduced by it. All are fixed.

| # | Finding | Origin | Fix |
|---|---|---|---|
| 1 | EventHub API suite: `baseURL` ends in `/api` but specs call `request.get('/health')`. Playwright resolves a leading-slash path against the host root, so the `/api` segment was dropped and every call went to `<host>/health`, not `<host>/api/health`. The README shows only the Freshsales auth spec ever ran live; the EventHub API suite was never confirmed live. | pre-existing | `baseURL` normalised to end with `/`; EventHub specs and the auth fixture use relative paths (`get('health')`). Freshsales specs untouched (they use host-root `/crm/...` paths on purpose). |
| 2 | `scripts/generate-k6-report.mjs` crashed on a fresh clone (results dir is gitignored, so it does not exist). | pre-existing | Creates the output directory. |
| 3 | Visual specs fail on any OS without baselines (only `*-darwin.png` are committed). | pre-existing | Skipped automatically unless on macOS or `RUN_VISUAL=1`. |
| 4 | `npx playwright test` includes `setup-freshsales`, which throws by design without a Freshsales account and a human-supplied session (reCAPTCHA). A full run therefore always reports failures. | pre-existing, by design | New `npm run test:eventhub` in both projects runs EventHub only. |
| 5 | `EVENTHUB_API_URL` / `FRESHSALES_BASE_URL` overrides were ignored by four hard-coded URLs (`api-fixtures.ts`, Freshsales `auth.spec.ts`, two ledger URLs in `lead-to-deal-pipeline.spec.ts`). | introduced by Phase 1 (half-applied override) | All four now honour the env vars. |
| 6 | `npm run test:debug` used POSIX env syntax and breaks on Windows. | introduced by Phase 1 | Uses `cross-env` (new devDependency in `playwright-tests`). |

Also corrected: two comments claimed the 400 for `known-bad-user@example.com` was "directly observed". That was true for the original real address, not the placeholder. Wording now says to re-verify.

### Files added to the change set by this follow-up
`api-tests/playwright-api/fixtures/api-fixtures.ts`, `api-tests/playwright-api/tests/*.spec.ts` (9 EventHub specs, path style only), `api-tests/playwright-api/tests/freshsales/auth.spec.ts`, `playwright-tests/tests/functional/freshsales/lead-to-deal-pipeline.spec.ts`, `playwright-tests/tests/visual/visual.spec.ts`, `playwright-tests/tests/visual/freshsales/login-page.unauth.spec.ts`, `scripts/generate-k6-report.mjs`, `playwright-tests/package-lock.json`, `artifacts/eventhub/api/api-test-plan.md` (wording).

### What was actually executed (and what was not)

| Check | Result |
|---|---|
| `npm ci` for `scripts`, `playwright-tests`, `api-tests/playwright-api` from a fresh unzip | pass |
| `npm run check` (schemas, PII guard, model drift) | pass: 0 errors, 0 findings |
| `tsc --noEmit` both Playwright projects | pass |
| `playwright test --list` | 84 UI tests, 113 API tests; EventHub-only scope: 68 UI tests, 0 Freshsales entries |
| k6 scripts ESM syntax (8 files) | pass (`k6` itself is not installed here, so `k6 run` was not executed) |
| `generate-k6-report.mjs` on an empty tree | pass |
| `cross-env` | pass |
| Visual specs on Linux | 5 skipped, 0 failed |
| **Real Playwright execution** of `health`, `config`, `login` API specs against a **local mock** server | 13 passed, 0 failed |
| Whole EventHub API project against the mock | every request went to `/api/...` (path fix confirmed); 40 specs failed only because the mock has no events/bookings data |
| UI tests in a real browser | **not run** (no browser could be installed in the verification environment) |
| EventHub / Freshsales live runs | **not run** (no access to the live targets) |
| GitHub Actions on a real runner | **not run** |

Bottom line: everything that can run offline runs cleanly. Whether the live EventHub suite is fully green depends on the live site, your credentials and your machine, which could not be tested here.

---

## 12. Applied to your second upload (IDURAR / freshsales-help / myapp / mysite)

Your second zip had moved on from the first: new run-configs, new artifacts, a new Playwright project, local session files and your own `.git`. Everything in sections 1-11 was applied to it. 55 files were byte-identical to the first upload and simply received the Phase 1 version. Three files you had changed yourself were **merged by hand** so your edits were kept:

| File | What you had | What was merged |
|---|---|---|
| `playwright-tests/playwright.config.ts` | a new `freshsales-help` project (baseURL `https://support.freshsales.io`, headless, no storage state) | Phase 1 config plus your project, verbatim. Its baseURL now reads `FRESHSALES_HELP_URL` (default unchanged). |
| `.vscode/mcp.json` | `--isolated` and `--storage-state=playwright-tests/.auth/idurar-session.json` flags | Your flags kept; version pinned to `0.0.83`. Checked: `0.0.83` supports both flags. |
| `config/eventhub-app-wide.yaml` | Windows (CRLF) line endings and a small edit | CRLF and your edit kept; only the personal e-mail was replaced. |

### Your new content, checked
- **Run-configs** `freshsale-app.yaml`, `idurarapp.yaml`, `myapp.yaml`, `mysite.yaml`: all pass the schema (0 errors).
- **Artifacts** `idurar/`, `myapp/`, `freshsales-help/`: sitemaps validate; DOM snapshots scanned for personal data.
- **Tests**: `freshsales-help` has no hard-coded URLs (it uses the project baseURL). 9 tests are discovered. New script: `npm run test:freshsales-help` in `playwright-tests/`.
- `playwright test --list`: 93 UI tests (84 + your 9), 113 API tests. The EventHub-only scope (`npm run test:eventhub`) is still 68 tests and does not include `freshsales-help`.

### New findings in your tree
| # | Finding | Action |
|---|---|---|
| 1 | Repo-root `.auth/` (3 session files with cookies) and `.playwright-mcp/` were **not** git-ignored. A `git add -A` would have committed them. Only `playwright-tests/.auth/` was ignored. | Added `.auth/` and `.playwright-mcp/` to `.gitignore`. |
| 2 | One personal e-mail address in `artifacts/idurar/explore/pages/settings/dom-snapshot.md` (the account's Email field). | Replaced with `idurar-user@example.com`. |
| 3 | Public vendor support addresses in scraped help-center pages (`support@freshsales.io`, `support@freshworks.com`). Not personal data. | Added to `scripts/pii-allowlist.json` so the guard stays strict for everything else. |
| 4 | `config/mysite.yaml` is the example config with only the URL changed, so it has `mode: full-run` aimed at `https://support.freshsales.io`, a third-party public site you do not own. | **Not changed** (it is your file). Recommended: set `mode: readonly`. |
| 5 | `.claude/agents-off/explore-agent.md` still said `@playwright/mcp@latest`; if renamed back to `agents` it would have un-pinned the version. | Pin text updated (it is now identical to `claude-agents/explore-agent.md`). |

### Your git history (scanned, read-only)
- 26 commits. **No session, `.auth` or `.env` file was ever committed.** No real credential literal found in tracked files (only obvious test fixtures such as `clearly-wrong-password...`).
- The two personal addresses from the first upload appear in history: one in 2 commits, the other in 1 commit. The working tree is now clean, but history is not rewritten. If this repo is public or shared, use `git filter-repo` (or BFG) to remove them.

### What is NOT in the zip (on purpose)
`.git/`, repo-root `.auth/`, `playwright-tests/.auth/`, `.playwright-mcp/`, `playwright-report/`, `test-results/` and `node_modules/`. The session files contain cookies and must not travel in a shared zip. **Your local copies are untouched**: extract the zip over your folder and they stay where they are. If those sessions were ever shared with anyone, log out of those apps to invalidate them.

### Windows note
Your tree has mixed line endings (`config/eventhub-app-wide.yaml` is CRLF). The validator, PII guard and model-sync check all pass on it. `npm run test:debug` now works in PowerShell (`cross-env`).

### Verified on the merged tree
| Check | Result |
|---|---|
| `npm ci` (3 projects), `npm run check` | pass: 18 files, 0 errors, 0 PII findings, 0 model drift |
| `tsc --noEmit` (both projects) | pass |
| `playwright test --list` | 93 UI, 113 API, 9 `freshsales-help` |
| Real Playwright run of health/config/login API specs against a local mock | 13 passed |
| Visual specs on Linux | 5 skipped, 0 failed |
| k6 report script on a clean tree | pass |
| UI tests in a real browser, live runs (EventHub, Freshsales, IDURAR, help center), GitHub Actions | **not run** (no browser or live access in the verification environment) |
