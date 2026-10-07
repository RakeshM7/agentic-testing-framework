---
source_agent: playwright-automation-agent
date: 2026-09-20
target: eventhub
related_files:
  - playwright-tests/tests/functional/events-search-filter.spec.ts
  - playwright-tests/pages/EventsListingPage.ts
  - playwright-tests/playwright.config.ts
  - artifacts/eventhub/testcases/app-wide-testcases.md
  - artifacts/eventhub/clarifications/app-wide-clarifications.md
severity: medium
---

## Finding 1: One-shot `allTextContents()` snapshots after a filter/search change race the app's async re-render

**Summary:** Writing `const titles = await locator.allTextContents(); expect(titles).toEqual([...])`
immediately after `selectOption()` or `fill()` on a live SPA is not reliable even though
`selectOption()` itself waits for actionability — the app's own filtered re-render can still land
a tick after `selectOption()`/`fill()` resolves, and `allTextContents()` is a one-shot read with no
retry, so it can capture the pre-filter DOM.

**Evidence:** Initial versions of `tests/functional/events-search-filter.spec.ts` (category filter,
city filter, free-text search, and combined-filter specs) failed on the first real `npx playwright
test` run against the live site with diffs like `Expected: ["Dilli Diwali Mela"]` vs `Received:
["Dilli Diwali Mela", "Hollywood Monsoon Night — Los Angeles", "World Tech Summit"]` — i.e. the
filter genuinely hadn't applied yet at read time. A manual Node/`playwright-core` repro of the same
`selectOption()` call succeeded when a `waitForTimeout(1000)` was inserted before reading, confirming
the race rather than a locator/selector bug. Switching every such assertion to the auto-retrying
form — `await expect(locator).toHaveText([...])` / `toHaveCount(n)` instead of a one-shot snapshot
compared with a plain `expect().toEqual()` — fixed all five failures with no arbitrary waits added.

**Suggested fix:** Add this as an explicit hard-rule-adjacent guidance in
`.claude/agents/playwright-automation-agent.md`: for any assertion whose value depends on
client-side JS reacting to a prior action (filter/select/search-as-you-type, not just navigation),
prefer `expect(locator).toHaveText(...)`/`toHaveCount(...)`/`toBeVisible()` (auto-retrying) over
`const x = await locator.allTextContents(); expect(x).toEqual(...)` (one-shot). The existing hard
rules cover selector grounding and secrets handling well but don't yet cover this timing pitfall,
and it's easy to hit the moment a spec touches a filter/search UI rather than a static page.

## Finding 2: Task-provided "admin-capable account" identity didn't match the account actually configured in `.env`

**Summary:** The invocation prompt (and `artifacts/eventhub/testcases/app-wide-testcases.md` /
`app-wide-clarifications.md`, presumably carried from `requirements-clarification-agent`'s own
run) both name `admin-user@example.com` as "the admin-capable account." The account actually
configured in `playwright-tests/.env` (`EVENTHUB_EMAIL`, read by `tests/setup/auth.setup.ts`) is a
different, `eventhub.dogfood.<random>@example.com`-style address from an earlier dogfooding run —
confirmed live to also be admin-capable (reaches `/admin/events`, sees the "+ New Event" form), so
this suite runs correctly against it, but the identity mismatch could confuse a future
agent/human who greps the test-case docs for the literal email and expects it to match `.env`.

**Evidence:** `node -e "require('dotenv').config(); ... email.startsWith('admin-userrakesh+1')"` (run
without printing the actual value, per the secrets hard rule) returned `false`; a live DOM probe
confirmed the currently-authenticated account's `data-testid="user-email-display"` text is
`eventhub.dogfood.hkm7kgad@example.com`, not `admin-user@example.com`.

**Suggested fix:** `requirements-clarification-agent`/`testcase-generator-agent` could cross-check
the account identity they name in clarifications/test-case docs against whatever
`playwright-tests/.env` actually contains (if it already exists from a prior run) rather than only
against `explore-agent`'s crawl artifacts, or explicitly note when the two might diverge (e.g. "the
crawl was performed as `X`, but the credentials file used at automation time may point to a
different, equally-admin-capable account"). Not blocking — the suite runs fine either way since it
only ever reads `process.env.EVENTHUB_EMAIL`, never the literal string from the test-case doc — but
worth a doc note to prevent future confusion.

## Resolution (2026-09-20)

**Finding 1: Fixed.** Added a new hard rule to `.claude/agents/playwright-automation-agent.md`'s "Hard rules" section: prefer auto-retrying assertions (`expect(locator).toHaveText(...)`/`toHaveCount(...)`/`toBeVisible()`) over one-shot snapshot reads (`allTextContents()` + `expect().toEqual()`) for any assertion depending on a client-side re-render triggered by a prior filter/select/search action, with an explicit note against papering over the race with `waitForTimeout`. This is placed alongside the existing selector-grounding and secrets hard rules so it's seen on every invocation, not just filter/search-heavy ones.

**Finding 2: Fixed.** Added step 3 to `.claude/agents/testcase-generator-agent.md`'s "Steps" section: when a test case names a specific account/identity, cross-check it against `playwright-tests/.env` if that file already exists from a prior run, and explicitly note in the doc when the two could plausibly diverge, rather than silently assuming they must match. Placed in `testcase-generator-agent` (not `playwright-automation-agent` itself) since that's the agent that authors the test-case doc naming the account, per the finding's own suggested fix; `requirements-clarification-agent` was considered too but the identity is written into the *test case*, not the clarifications doc, in this pipeline's actual artifact split, so `testcase-generator-agent` is the more precise target.

Files changed: `.claude/agents/playwright-automation-agent.md`, `.claude/agents/testcase-generator-agent.md`.

Verification: re-read both files' frontmatter after edit (Node script confirming `name`/`description` still parse and no leading `-` in `name`); both changes are agent-persona prose with no code to typecheck or test-run, so verification is limited to confirming correct placement, step renumbering integrity in `testcase-generator-agent.md` (steps 3-6 now sequential after the insertion), and that no existing instruction was contradicted.
