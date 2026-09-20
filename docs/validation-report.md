# Validation Report — Agentic Testing Framework Dogfood Run

## 1. Overview

- **Date**: 2026-09-20
- **Target**: `https://eventhub.rahulshettyacademy.com` (a public QA-practice demo app by Rahul Shetty Academy; backend at `https://api.eventhub.rahulshettyacademy.com`)
- **Scope**: full end-to-end dogfood run of all 5 agents against a real, previously-unseen web app — explore → requirements clarification → test case generation → Playwright automation → API testing — with no shortcuts on any stage.
- **Methodology**: each agent's exact `.claude/agents/*.md` definition was injected verbatim as the operating persona for a subagent invocation (see §4 for why native `subagent_type` dispatch wasn't available), given a concrete task grounded in the previous stage's real output, and required to actually produce and verify its artifacts (not just describe them). Test runs were real (`npx playwright test`), not simulated.
- **Feature under test**: the event browsing → event details → booking flow, chosen because it's the app's core user journey and exercises UI, form validation, visual rendering, and API surface all at once.

## 2. Pipeline Execution Summary

| Stage | Agent | Status | Notable events |
|---|---|---|---|
| 1 | explore-agent | ✅ Complete (2 runs) | 1st attempt blocked — Chrome extension not connected. Retried successfully after user connected it. Extended once with explicit, user-authorized authenticated crawl. |
| 2 | requirements-clarification-agent | ✅ Complete (2 passes, as designed) | Pass 1 produced 10 grounded questions; 4 relayed to user via AskUserQuestion, 6 resolved via documented reasonable defaults; Pass 2 wrote the final doc. |
| 3 | testcase-generator-agent | ✅ Complete | 19 test cases, 100% edge-case traceability. |
| 4 | playwright-automation-agent | ⚠️ Complete with real failures | 1st attempt failed mid-run (platform rate limit, not the agent's fault). Retry scaffolded successfully but hit 3 real bugs before producing a runnable, partially-passing suite (12 passed / 9 failed / 5 skipped-with-reason). |
| 5 | api-testing-agent | ✅ Complete | Discovered 15 endpoints via Swagger extraction, generated plan + specs + k6 scripts, all guardrails held. |

## 3. Per-Agent Findings

### explore-agent

**Task given**: crawl eventhub from the homepage, cap ~15 pages, snapshot everything reachable, stay read-only.

**What it actually did**: First attempt correctly detected the Chrome extension wasn't connected (`list_connected_browsers` returned empty) and stopped cleanly rather than failing silently or fabricating results — this is exactly the intended behavior for an environmental blocker. After the user connected Chrome, the retry crawled 3 unauthenticated pages (`/`, `/login`, `/register`) and correctly identified that every other route (`/events`, `/dashboard`, `/bookings`, `/admin`) is gated behind a login wall — and, per its hard rule, **did not attempt to log in**, stopping there and documenting the wall in `crawl-log.md`. Because the whole app is auth-gated, a human then had to explicitly authorize and drive one additional "authenticated crawl extension" (with real, user-supplied credentials) outside the agent's own default scope, which captured 5 more pages including real event/booking/admin content.

**Artifacts produced**: `artifacts/eventhub/explore/sitemap.json` (8 pages), `crawl-log.md`, 8 per-page folders each with `screenshot.png` (verified as genuine captured image bytes, not placeholders), `dom-snapshot.md`, `network-requests.json`, `console-log.txt`.

**Issues / gaps**:
- The default no-login design is *correct* for safety, but it means explore-agent alone cannot fully explore any auth-gated app (which is most real products) — a human always has to intervene with a second, ad hoc step to go further, and that step isn't part of the framework's documented pipeline.
- The unauthenticated `/events` listing DOM snapshot briefly contained an unresolved id→title guess that a later, more authoritative capture superseded — downstream agents had to be told explicitly which source to trust.

**Feedback for the agent definition**: Add an explicit, optional, first-class "authenticated crawl" input (credentials passed via a file reference, never inline) so this doesn't require an ad hoc follow-up prompt every time. See §5, item 5.

---

### requirements-clarification-agent

**Task given**: Pass 1 — read the sitemap/DOM snapshots and produce clarification questions for the event-booking flow; Pass 2 — synthesize the user's answers into a clarifications doc.

**What it actually did**: Pass 1 produced 10 well-grounded questions, each traceable to a specific captured DOM element or observed gap (e.g. the sold-out edge case was flagged because no seeded event is actually near capacity; the 503 reliability signal was picked up from `crawl-log.md` and turned into a scoping question). It correctly refused to fabricate any answer and explicitly asked about output format as instructed. The orchestrator (this session) relayed the 4 most decision-critical questions via `AskUserQuestion` and resolved the remaining 6 lower-stakes ones with documented defaults — Pass 2 correctly incorporated both without silently overriding any stated answer, and produced all 7 required sections (6 mandated + the explicit output-format field), each properly caveated (e.g. "Confirm Booking" was never actually clicked, so success-behavior assertions are marked inferred, not verified).

**Artifacts produced**: `artifacts/eventhub/clarifications/event-booking-clarifications.md`.

**Issues / gaps**: The agent's own persona doesn't distinguish which of its questions are truly blocking vs. safely defaultable — that judgment call was made by the orchestrating session, not documented anywhere in the agent's output itself.

**Feedback for the agent definition**: Tag each Pass-1 question `[Blocking]` or `[Nice-to-have]` so an orchestrator has an explicit signal for what must interrupt the user vs. what can reasonably default. See §5, item 4.

---

### testcase-generator-agent

**Task given**: generate manual test cases from the clarifications doc, in the confirmed format, with full edge-case traceability.

**What it actually did**: Produced exactly 19 test cases in the confirmed plain-Markdown-table format (no format-ambiguity fallback needed), pulled real UI labels from the DOM snapshots (e.g. "Book Now", "Full Name*", the actual placeholder text), and covered all 11 edge-case-table rows with zero gaps — verified via its own traceability matrix. It correctly extrapolated one additional negative case (TC-008, the 503-reliability-on-submit scenario) beyond the table and explicitly flagged it as speculative rather than presenting it as sourced fact.

**Artifacts produced**: `artifacts/eventhub/testcases/event-booking-testcases.md` (19 cases), `testcases-summary.md` (counts + traceability matrix).

**Issues / gaps**: None of substance. This was the cleanest stage in the pipeline.

**Feedback for the agent definition**: None needed — working as designed.

---

### playwright-automation-agent

**Task given**: greenfield branch — research best practices, write the research doc, scaffold a runnable suite, automate the P0 subset, generate a visual-regression spec, and actually run the suite.

**What it actually did, and what went wrong**:
1. First invocation failed partway through (platform weekly rate limit — an environmental/harness issue, not an agent defect) after only confirming the greenfield branch. Retried successfully.
2. Retry scaffolded a real, well-structured project: `docs/playwright-framework-research.md`, `playwright-tests/` with POM classes, a `project`-based auth-setup fixture (`storageState`), a `networkGuards.ts` helper that hard-blocks any non-GET call to the live API even if a test accidentally tries to submit something, and 26 collected tests across 6 spec files. `npm install`, `npx playwright install`, and `npx tsc --noEmit` all ran clean.
3. **Credential handling required a workaround, not an agent defect**: Claude Code's own credential-leakage classifier blocked an Agent-tool call that contained a plaintext password inline in the prompt. Worked around by writing credentials to a `.env` file directly and having the agent reference/read the file itself — this is the *correct* pattern and is now how the persona is written, but it's worth calling out as a hard operational constraint for anyone deploying this framework: **never pass secrets through an agent prompt string.**
4. **Real bug found #1 — `dotenv` truncation**: the test account's password ends in `#`. Unquoted in `.env`, `dotenv` treats `#` as a comment start and silently truncates the value (`Qa9!Test123#` → `Qa9!Test123`, 11 chars instead of 12). This caused every login attempt to fail with a clean, correctly-diagnosed 400 from the live app — but the *root cause* (truncated password, not wrong password) wasn't something the agent itself could see without instrumentation. Fixed by quoting the value in `.env`.
5. **Original test account also failed even after the quoting fix** — likely account rotation/reset on the shared demo backend (a `400 Invalid email or password` for an account that had worked minutes earlier via direct browser login). Per user instruction, registered a fresh account with generated credentials instead, which then worked correctly once the same quoting fix was applied.
6. **Real bug found #2 — Playwright strict-mode locator violation**: the generated `auth.setup.ts` asserted `getByRole('link', { name: 'My Bookings' })`, but that text legitimately appears three times on the page (nav, main content, footer). Fixed by scoping to the nav's `data-testid="nav-bookings"`.
7. **Real bug found #3 — the largest issue, affecting 9 of 26 tests**: several generated assertions assume the live app renders label and value as a single joined text string (e.g. `'Book Tickets — $1,500 per ticket'`, `'PRICE PER TICKET: $2,500'`, a `$X × Y tickets = $Z` line). Pulling the live page text directly confirmed the app actually renders these as **separate text nodes/rows** ("Book Tickets" / "$1,500" / "per ticket" as three separate lines; "AVAILABLE" / "229 / 500 seats" as two). The assertions were reconstructed the way a human would *describe* the UI, not grounded in the literal DOM text explore-agent had already captured. This is a systematic, generalizable gap, not a one-off typo.

**Final real test run**: **12 passed, 9 failed (all the same root-cause class above), 5 skipped-with-`test.fixme()`-and-reason** (booking-completion-dependent cases correctly deferred rather than executed against a live shared demo site). Visual-regression baselines generated successfully (2/2) once auth worked.

**Artifacts produced**: `docs/playwright-framework-research.md`, full `playwright-tests/` project (see Appendix), a real `playwright-report/` from the final run.

**Feedback for the agent definition** (highest priority in this report):
- Add an explicit instruction: ground every text-based assertion in the *literal* text captured by explore-agent's `dom-snapshot.md`/`get_page_text` output — never reconstruct a "readable" compound string (em-dash-joined, colon-joined, or with a computed `=`) unless that exact string was observed as a single DOM text node. Prefer per-line/per-label assertions, or structural locators (`data-testid`) where they exist.
- Add explicit locator-uniqueness guidance: prefer `data-testid`/scoped locators over bare `getByRole`/`getByText` whenever the same label could plausibly repeat in nav + main + footer.
- Add a standing note (not just an ad hoc runtime instruction) about `.env` value quoting for special characters, and instruct the agent to sanity-check a loaded secret's length/non-emptiness (without logging the value) immediately after load, so a parsing bug surfaces as a clear pre-flight error instead of a confusing downstream auth failure.
- Cap the Branch-B research phase explicitly (e.g. "3–5 targeted searches, not an exhaustive survey") — this run's first attempt burned into a rate limit partly because research had no stated bound.

---

### api-testing-agent

**Task given**: discover eventhub's API surface, produce a test plan, generate Playwright API tests and k6 scripts, respect the no-live-load-test rule.

**What it actually did**: Correctly followed its own discovery preference order — it fetched the public Swagger docs page first rather than relying on explore-agent's sparse network captures (the frontend is server-rendered, so client-visible XHR was almost empty, exactly as explore-agent's crawl-log had flagged for it). When the docs site had no direct JSON-export route, it found and parsed the embedded spec object out of the swagger-ui bundle's JS — a resourceful, correct solution, though fairly specific to this site's setup and not guaranteed to generalize to every target. It discovered 15 endpoints across 4 resource groups, and **found and explicitly tested a genuine contract discrepancy** (the spec documents `bearerAuth` as required only on `GET /auth/me`, but its own description implies bookings/events should be private-per-account) — rather than assuming either interpretation, it tested empirically with no-token/valid-token/invalid-token variants. All guardrails held: `k6` wasn't installed, so it correctly fell back to manual review + `node --check` syntax validation instead of skipping validation entirely; generated Playwright API specs stayed GET-only with one clearly-justified, narrowly-scoped exception (a single login call needed purely to obtain a bearer token, never a mutating call); the one write-path k6 script defaults its `BASE_URL` to `localhost` specifically so it can't accidentally be pointed at the live third-party host.

**Artifacts produced**: `artifacts/eventhub/api/discovered-endpoints.json`, `api-test-plan.md`, `api-tests/playwright-api/` (5 spec files, 50 collected tests), `api-tests/k6/` (4 scripts + README).

**Issues / gaps**: None that compromise correctness. The Swagger-extraction technique, while effective here, is a reverse-engineering workaround specific to this site's docs setup — the persona should note that this is a fallback, not the expected common case.

**Feedback for the agent definition**: Minor — note in the persona that when no standard JSON-export route exists for a Swagger UI page, checking for an embedded spec object in the page's own JS bundle is a reasonable fallback before giving up and falling back fully to network-capture inference.

## 4. Cross-cutting Observations

- **Newly-written `.claude/agents/*.md` definitions are not hot-loaded into a running session.** Immediately after writing the 5 files, attempting `subagent_type: "explore-agent"` failed with `Agent type 'explore-agent' not found` — only pre-existing agent types were available. The entire dogfood run had to work around this by injecting each persona's full markdown body verbatim into a `general-purpose` agent's prompt. This means the definitions are correct and were genuinely exercised, but **"ready to deploy" requires starting a new Claude Code session (or whatever reload mechanism the harness provides) before the custom `subagent_type`s become natively invocable** — this should be called out explicitly wherever the framework is documented as deployable.
- **Secrets must never be passed as plaintext inside an Agent-tool prompt** — Claude Code's own credential-leakage classifier blocked it. Every agent in this framework that needs to authenticate against a target app must be designed around file-based credential references (`.env`, read by the agent itself) from the start, not as an afterthought.
- **A platform-level rate limit interrupted one subagent run mid-task.** This is outside the framework's control, but it reinforces the value of the "keep research bounded" feedback above — long, unbounded research phases are more exposed to this kind of interruption.
- **Model adequacy**: `sonnet` (the model specified in all 5 agent definitions) was sufficient for every stage, including the more involved reverse-engineering step in api-testing-agent and the multi-file scaffolding in playwright-automation-agent. No stage showed evidence of needing a stronger model.
- **Path-convention discipline held up well** — every agent correctly read from and wrote to the exact `artifacts/<target>/...` paths specified in `docs/conventions.md`, with no orchestrator script needed to enforce it.

## 5. Recommended Next-Iteration Edits (prioritized)

1. **playwright-automation-agent.md** — ground all text assertions in literal captured DOM text; never reconstruct joined/compound display strings. *(Highest priority — caused the majority of this run's test failures.)*
2. **playwright-automation-agent.md** — add explicit locator-uniqueness guidance (prefer `data-testid` / scoped locators over bare role/text locators).
3. **playwright-automation-agent.md** + **api-testing-agent.md** — add a standing `.env` quoting/sanity-check instruction for secrets containing special characters.
4. **requirements-clarification-agent.md** — tag each Pass-1 question `[Blocking]`/`[Nice-to-have]` to guide the orchestrator's escalation decision.
5. **explore-agent.md** — add a first-class, explicitly-opt-in authenticated-crawl mode (credentials via file reference) instead of requiring an ad hoc follow-up step for every auth-gated target.
6. **playwright-automation-agent.md** — bound the Branch-B research phase to a small number of targeted searches.
7. **api-testing-agent.md** — note the embedded-spec-in-JS-bundle fallback technique as a documented (but secondary) discovery method.
8. **README.md** — add an explicit "New session required before custom agent types are invocable" deployment note.

## Appendix: Full Artifact Tree

```
api-tests/
├── k6/
│   ├── README.md
│   └── scripts/
│       ├── booking-creation-load-test.js
│       ├── bookings-load-test.js
│       ├── events-load-test.js
│       └── health-load-test.js
└── playwright-api/
    ├── README.md, package.json, package-lock.json, playwright.config.ts, tsconfig.json
    ├── fixtures/api-fixtures.ts
    └── tests/{auth,bookings,config,events,health}.spec.ts

artifacts/eventhub/
├── api/{api-test-plan.md, discovered-endpoints.json}
├── clarifications/event-booking-clarifications.md
├── explore/
│   ├── crawl-log.md, sitemap.json
│   ├── login-attempt-failed/{network-request.json, screenshot.jpg}
│   └── pages/{admin,event-detail,events,home,home-authenticated,login,my-bookings,register}/
│       └── {screenshot(.png|.jpg), dom-snapshot.md, network-requests.json, console-log.txt}
└── testcases/{event-booking-testcases.md, testcases-summary.md}

docs/
├── conventions.md
├── playwright-framework-research.md
└── validation-report.md   (this file)

playwright-tests/
├── package.json, package-lock.json, playwright.config.ts, tsconfig.json, README.md, .env.example
├── .auth/user.json (gitignored)
├── pages/{LoginPage,EventsListingPage,EventDetailPage,networkGuards}.ts
├── fixtures/base.ts
└── tests/
    ├── setup/auth.setup.ts
    ├── functional/{navigation,booking-widget,validation,reliability,booking-mutating}.spec.ts
    └── visual/{visual.spec.ts, visual.spec.ts-snapshots/*.png}
```
