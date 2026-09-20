# Playwright Framework Research — EventHub (Greenfield)

Target: `playwright-tests/` (new, standalone Node project) for `https://eventhub.rahulshettyacademy.com`.
No existing Playwright config, dependency, or `/tests`/`/e2e` directory was found in this repo, so
this is a Branch B (greenfield) scaffold. Research below was kept intentionally targeted (a
handful of searches) rather than exhaustive, per this run's efficiency constraint.

## Recommended folder structure

Adopted the widely-recommended layered structure for TypeScript Playwright projects (separates
test specs, page objects, fixtures, and auth/setup state so the suite stays maintainable as it
grows):

```
playwright-tests/
  package.json
  playwright.config.ts
  .env / .env.example
  README.md
  pages/              # Page Object Model classes (one per app page/widget)
  fixtures/           # Custom Playwright test fixtures (auth-aware `test`)
  tests/
    setup/            # Project-dependency auth setup (auth.setup.ts)
    functional/        # Functional specs, grouped by concern
    visual/             # Visual-regression specs (+ committed *-snapshots/ baselines)
  .auth/               # Generated storage-state JSON (gitignored, never committed)
```

Source: BrowserStack "Page Object Model in Playwright" guide, and multiple 2026 Playwright
TypeScript structure guides (qatribe.in, nareshit.com, testrig/medium) converge on
tests/pages/fixtures/utils/config as the standard layered layout for scaling a suite beyond a
handful of specs.

## POM pattern chosen and why

Class-based Page Objects, one class per meaningful page/widget (`LoginPage`, `EventsListingPage`,
`EventDetailPage`), each exposing intention-revealing methods (`goToEventByTitle()`,
`incrementQty()`, `readOrderSummary()`) rather than exposing raw locators to specs. This keeps
selector churn isolated to one file per page and keeps spec files readable as
executable-documentation of the manual test cases they automate. Locators are resolved with
Playwright's recommended user-facing locators (`getByRole`, `getByPlaceholder`, `getByText`) based
on the accessible roles/placeholders captured in `explore-agent`'s DOM snapshots, rather than CSS
classes, since EventHub is a Next.js app whose class names are not guaranteed stable.

## Fixture strategy

A single authenticated session is established once via a `setup` project (Playwright's current
recommended pattern — "project dependencies" — superseding the older `globalSetup` script
approach): `tests/setup/auth.setup.ts` logs in through the real `/login` UI using
`EVENTHUB_EMAIL`/`EVENTHUB_PASSWORD` from `.env`, then saves `storageState` to
`playwright-tests/.auth/user.json`. All functional/visual projects declare
`dependencies: ['setup']` and load that storage state, so every spec starts already authenticated
without re-submitting the login form per test (fewer live requests against the demo site, less
flake, faster suite). `fixtures/base.ts` extends Playwright's `test` with typed `eventsPage` /
`eventDetailPage` fixtures that construct the relevant Page Object against the shared `page`.

## Config strategy

- `baseURL: https://eventhub.rahulshettyacademy.com`, so specs use relative paths.
- `testDir: ./tests`, with a `setup` project (`tests/setup/*.setup.ts`) that a `chromium` project
  depends on.
- `retries: 2` on CI / `0` locally (`process.env.CI` gate), matching Playwright's own scaffold
  default and 2026 best-practice write-ups on reliability under a flaky third-party demo backend
  (this app is independently known to intermittently 503 on RSC prefetches).
- `reporter: [['list'], ['html', { open: 'never' }]]`.
- `use: { trace: 'on-first-retry', screenshot: 'only-on-failure', video: 'retain-on-failure' }`.
- `dotenv` (`dotenv/config` import) loads `.env` for credentials; nothing is hardcoded.

## Visual-regression approach

Playwright's own built-in `toHaveScreenshot()` (pixelmatch-based) is used rather than a
third-party snapshot library — it's natively integrated with retries/trace viewer and is the
2026 community-consensus default (Argos CI, Bug0, TestQuality, ScrollTest guides all converge on
this as the baseline tool before reaching for a paid visual-diff service).

Per this agent's standing design nuance: `explore-agent`'s crawl screenshots
(`artifacts/eventhub/explore/pages/*/screenshot.png`) are **not** used as pixel baselines — they
were captured by a different render pipeline (MCP browser tool) than Playwright's own headless
Chromium, so pixel-for-pixel comparison against them would be meaningless. They were used only to
decide *which* pages deserve visual coverage: the events listing (`/events`, rich card grid, most
likely to visually regress) and the login page (`/login`, always-available unauthenticated
surface). The actual golden baselines are generated fresh inside this project on first run via
`npx playwright test tests/visual --update-snapshots`, and those generated PNGs under
`tests/visual/*-snapshots/` are the true baseline going forward.

Dynamic per-load content (none observed as clock/random on these two pages) would be masked via
locator-based `mask: [...]` per the CI-reliability guidance found; not needed here since both
pages render deterministic seeded-fixture content.

## CI recommendation

Run functional and visual specs as separate CI stages/jobs: functional specs (`--grep-invert
@visual`) on every push; visual specs (`--grep @visual`) as a distinct job that always runs in the
same container/OS/browser version Playwright ships (`mcr.microsoft.com/playwright:<version>` Docker
image) to keep font/GPU rendering consistent, and whose snapshot updates are a reviewed, deliberate
step (`--update-snapshots` run locally/in a maintenance job, never auto-applied in CI) rather than
silently accepted. `npx playwright install --with-deps` before either job.

## Sources

- [Page Object Model in Playwright — BrowserStack (2026 Guide)](https://www.browserstack.com/guide/page-object-model-with-playwright)
- [Playwright TypeScript Project Structure & Folder Guide (2026) — qatribe.in](https://qatribe.in/playwright-typescript-project-structure-2026/)
- [Best Playwright TypeScript Structure Project Setup 2026 — nareshit.com](https://nareshit.com/blogs/best-playwright-typescript-structure-setup-guide-2026)
- [Playwright testing framework from scratch: folder structure, config and best practices — testrig/Medium](https://testrig.medium.com/playwright-testing-framework-from-scratch-folder-structure-config-and-best-practices-a8f8b3623938)
- [Playwright Visual Regression Testing in CI: Complete Guide — Argos CI](https://argos-ci.com/blog/playwright-visual-regression-testing-ci)
- [Playwright Visual Regression Testing: Built-In Guide 2026 — Bug0](https://bug0.com/knowledge-base/playwright-visual-regression-testing)
- [Playwright Visual Regression: Baselines, Flake & CI Guide 2026 — TestQuality](https://testquality.com/playwright-visual-regression-guide/)
