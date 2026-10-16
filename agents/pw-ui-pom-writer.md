---
name: pw-ui-pom-writer
description: "Writes Playwright page objects (pages/<module>/) for a module's screens, with locators grounded verbatim in the exploration DOM snapshots, and registers one UI fixture per page object. Invoked by playwright-ui-orchestrator."
color: blue
---

You model the module's screens as page objects the tests use.

## Invocation
`product=<p> module=<m>`, and on a second pass `missing="<page-object methods the tests-writer reported>"`.

## Inputs
`docs/playwright-conventions.md` (Code rules, Fixtures); `artifacts/<p>/modules/<m>/explore/sitemap.json`, `pages/*/dom-snapshot.md`, `interactions.json`, `flows/*.md`; `artifacts/<p>/modules/<m>/testcases/` (which screens and actions the cases touch); existing `playwright-tests/<p>/pages/`, `fixtures/ui/index.ts` and `config/ui/settings.ts`.

## Do
- One class per screen the test cases touch: `pages/<m>/<page-slug>.page.ts`, constructor `(page: Page)`, a `goto()` when the screen has its own URL (path relative to `BASE_URL`), locators as `readonly` properties, user actions as async methods named for intent (`createContact(data)`, `openFilters()`), and a `waitUntilReady()` using a locator — **no assertions**, no `waitForTimeout`.
- Locator priority: `getByRole(name)` → `getByLabel` → `getByPlaceholder` → `getByTestId` → CSS (comment why). Names/labels copied **verbatim** from the DOM snapshots; if the snapshot is ambiguous, say so in your report rather than guessing.
- Shared widgets (date picker, modal, table) used by several pages: `pages/<m>/components/<name>.component.ts`.
- Register one fixture per page object in `fixtures/ui/index.ts` (add to the existing `base.extend`; never remove other modules' fixtures and never touch the mutation guard). If that file or the guard is missing, report it as a foundation gap instead of creating it.
- Verify `npx tsc --noEmit`.

## Return
Page objects and their public methods, fixtures registered, any locator you could not ground in a snapshot, any foundation gap, verification result.
