# Agentic Testing Framework

A set of six specialized Claude Code subagents that together plan and execute Manual, Automation (Playwright), UI Visual, and API (Playwright + K6) testing for a web application — from "here's a URL" to a scaffolded, running test suite plus a full API test plan — and close the loop on their own feedback.

See [`architecture.md`](architecture.md) for the pipeline diagram and design rationale, [`docs/conventions.md`](docs/conventions.md) for the artifact handoff and feedback contracts, and [`docs/validation-report.md`](docs/validation-report.md) for a real end-to-end dogfood run of every agent against a live app, with per-agent feedback.

## What this repo is

This is a **framework**, not a finished test suite for one product. The deliverable is the six agent definitions in `.claude/agents/` — concise, ready-to-deploy Claude Code subagents you point at *any* target web app. `artifacts/eventhub/`, `playwright-tests/`, `api-tests/`, and `feedback/` in this repo are not the framework itself; they're the real output of one validation run (against the public demo site `eventhub.rahulshettyacademy.com`), kept in the repo as a worked example and as evidence the agents actually work, not as a template to edit by hand.

## Agents

| Agent | Role | Tools | Model |
|---|---|---|---|
| [`explore-agent`](.claude/agents/explore-agent.md) | Crawls a target UI, builds a sitemap, captures a baseline snapshot (screenshot + DOM + network + console) per page. Optional opt-in authenticated-crawl mode via a credentials file. | Read, Write, Glob, Grep, Bash, Chrome browser tools | sonnet |
| [`requirements-clarification-agent`](.claude/agents/requirements-clarification-agent.md) | Two-pass interview: asks the user about behavior, edge cases, and desired test-case format, then writes an authoritative clarifications doc from their answers. | Read, Write, Glob, Grep, WebFetch | sonnet |
| [`testcase-generator-agent`](.claude/agents/testcase-generator-agent.md) | Generates manual test cases in the user's confirmed format (Gherkin / Markdown table / CSV / TestRail import), with full edge-case traceability. | Read, Write, Glob, Grep | sonnet |
| [`playwright-automation-agent`](.claude/agents/playwright-automation-agent.md) | Scaffolds or extends a Playwright suite (functional + visual-regression). Matches an existing repo's conventions if one exists; researches best practices and lays out a new framework from scratch if not. | Read, Write, Edit, Glob, Grep, Bash, WebSearch, WebFetch | sonnet |
| [`api-testing-agent`](.claude/agents/api-testing-agent.md) | Discovers the target's API surface (OpenAPI/Swagger preferred, network-capture fallback), writes an exhaustive test plan, and generates Playwright API tests + k6 load-test scripts. Never runs a live load test. | Read, Write, Edit, Glob, Grep, Bash, WebFetch, WebSearch | sonnet |
| [`feedback-implementor-agent`](.claude/agents/feedback-implementor-agent.md) | Reads feedback file(s) filed by the other agents (never raw feedback text) and implements the fixes -- agent definitions, generated code, or docs -- verifying each and appending a Resolution section back to the same file. | Read, Write, Edit, Glob, Grep, Bash | sonnet |

## What it covers

- **Manual testing**: structured requirements clarification + traceable manual test cases in a format you choose.
- **UI functional automation**: a real, running Playwright project (POM, fixtures, auth setup, CI-ready config) — either extending your existing suite in your existing style, or built from researched best practices if you have none.
- **UI visual testing**: baseline page snapshots during exploration, plus Playwright's own `toHaveScreenshot()` visual-regression specs generated as part of the automation suite (the two are deliberately not conflated — see [`architecture.md`](architecture.md)).
- **API testing**: endpoint discovery, a full functional/negative/boundary/auth/schema/performance scenario matrix, executable Playwright API tests, and k6 load-test scripts.
- **Safety by default**: every agent is read-only/non-mutating against a live target unless a step explicitly requires and is told to authenticate, and even then it never performs a real booking/payment/delete or a live k6 load run without a human explicitly directing it to a target they control.

## What it does not cover

- **No orchestrator.** There is no script that chains the five agents automatically. A human (or a top-level Claude Code session acting on a human's behalf) invokes each agent in order and passes the previous stage's artifact path forward. See the pipeline diagram in `architecture.md`.
- **No fully autonomous exploration of authenticated apps.** `explore-agent` will not guess or infer credentials; by default it stops at any login wall. Getting past one requires an explicit, human-authorized credentials file.
- **No mobile, desktop, or non-web testing.** The framework is scoped to web applications reachable by a browser and/or an HTTP API.
- **No test-management-system integration.** Test cases are written to files in the format you choose; importing them into TestRail/Jira/Zephyr/etc. is a manual step.
- **No CI wiring.** `playwright-automation-agent` documents a CI recommendation in its research doc but does not create pipeline config (GitHub Actions, Jenkins, etc.).
- **No live performance testing by default.** `api-testing-agent` generates k6 scripts but will never run `k6 run` against a target on its own; a human decides when and where to actually generate load.
- **No security/penetration testing.** Auth and authorization test cases check for correct *behavior*, not for exploitable vulnerabilities.

## Limitations (learned from real dogfooding)

These are documented in full, with root causes, in [`docs/validation-report.md`](docs/validation-report.md). Highlights:

- **Custom agent definitions are not hot-loaded.** After adding or editing a file in `.claude/agents/`, you must start a **new** Claude Code session before its `subagent_type` becomes invocable via the Agent tool. Editing an agent file mid-session and immediately trying to invoke it will fail with "Agent type not found".
- **Generated Playwright assertions can be wrong if the agent guesses page text instead of reading it.** In the validation run, `playwright-automation-agent` wrote several assertions against a "readable" compound string (e.g. `'Book Tickets — $1,500 per ticket'`) that didn't match the real DOM, which actually renders the label and value as separate text nodes. The agent definition has since been updated to require grounding assertions in literally-captured text, but always review generated specs before trusting them blindly.
- **Secrets must be file-based, never inline.** Claude Code's own credential-leakage classifier blocks passing plaintext secrets inside an agent prompt. Every agent that needs to authenticate against a target expects credentials via a `.env` file it reads itself.
- **`.env` values containing `#` must be quoted.** Unquoted, `dotenv` treats `#` as a comment start and silently truncates the value — this caused a real, confusing login failure during validation before the root cause was found.
- **Demo/shared environments can be flaky or rotate accounts.** During validation, a previously-working test account's password was rejected minutes later with no code change on our side — plausibly an environment-level reset. Don't assume a credential that worked once will keep working against a shared third-party demo target.
- **Explore-agent's screenshots are not Playwright visual baselines.** They're reference material for deciding what to cover; `playwright-automation-agent` generates its own golden images via `--update-snapshots`.

## How to use this repo — step by step

### 1. Point `explore-agent` at your target

Start a Claude Code session in (or pointed at) the repo you want tested, with this framework's `.claude/agents/` available (project-scoped agents apply to the project you're in — copy the five files into your target repo's own `.claude/agents/`, or keep working from this repo if the target is external).

```
Use the explore-agent to crawl https://your-target-app.example.com,
cap it at ~15 pages, and save artifacts under artifacts/<target-slug>/explore/.
```

If most of the app is behind a login wall, decide whether to authorize an authenticated crawl. If so, create a `.env`-style credentials file yourself first (never type credentials directly into the chat/prompt) and tell the agent to read it:

```
Re-run explore-agent with authCredentialsFile=path/to/creds.env to get past the login wall.
Do not print or log the credential values.
```

**Check before moving on**: `artifacts/<target-slug>/explore/sitemap.json` lists real pages, and each `pages/<slug>/` folder has a genuine `screenshot.png`, `dom-snapshot.md`, `network-requests.json`, and `console-log.txt`.

### 2. Run the two-pass requirements interview

```
Use requirements-clarification-agent (Pass 1) on the <feature> flow, using
artifacts/<target-slug>/explore/sitemap.json for grounding.
```

The agent returns a question list (tagged `[Blocking]`/`[Nice-to-have]`). Answer the blocking ones yourself; then re-invoke:

```
Use requirements-clarification-agent (Pass 2) with these answers: <paste answers under "Answers:">
```

**Check before moving on**: `artifacts/<target-slug>/clarifications/<feature>-clarifications.md` exists and has an explicit "Confirmed test-case output format" line.

### 3. Generate manual test cases

```
Use testcase-generator-agent on artifacts/<target-slug>/clarifications/<feature>-clarifications.md.
```

**Check before moving on**: `artifacts/<target-slug>/testcases/<feature>-testcases.<ext>` plus `testcases-summary.md` exist, and the summary's traceability matrix covers every edge case.

### 4. Automate it with Playwright (functional + visual)

```
Use playwright-automation-agent, targeting <your target repo or this repo if greenfield>,
using artifacts/<target-slug>/testcases/<feature>-testcases.<ext> as the source cases to automate.
```

Then actually run what it produced and read the real output — do not trust a summary alone:

```bash
cd playwright-tests   # or wherever it scaffolded
npm install
npx playwright install
cp .env.example .env  # fill in real, authorized credentials if the app needs auth
npx playwright test tests/visual --update-snapshots   # generate visual baselines first
npx playwright test
```

**Check before moving on**: a real pass/fail count, not a claim. Review any `test.fixme()`-skipped cases and their reasons.

### 5. Generate API test coverage

```
Use api-testing-agent, targeting <the app's API>, using the network-requests.json files
under artifacts/<target-slug>/explore/pages/*/ and any OpenAPI/Swagger docs you know about.
```

**Check before moving on**: `artifacts/<target-slug>/api/api-test-plan.md` and `discovered-endpoints.json` exist; `api-tests/playwright-api/` collects real tests (`npx playwright test --list`); `api-tests/k6/` scripts exist but were **not** run — running them against a real target is a separate, deliberate decision you make yourself:

```bash
cd api-tests/playwright-api && npm install && npm test
k6 run api-tests/k6/scripts/<script>.js   # only against a target you own/control
```

### 6. Read the artifacts, don't just trust the summaries

Every stage's real output lives under `artifacts/<target-slug>/`, `playwright-tests/`, and `api-tests/`. Treat an agent's final chat response as a claim to verify against those files and against an actual `npx playwright test` run, not as ground truth on its own.

### 7. Close the loop on feedback

Any agent above can, mid-task, file feedback about a bug, ambiguity, or improvement it found — in its own instructions, another agent's, or in generated code — instead of just mentioning it in chat. It writes that feedback to `feedback/<agent-name>/<date>-<slug>.md` (schema in [`docs/conventions.md`](docs/conventions.md)) and states only the file path in its response. Pass that same file path — not the feedback text — to `feedback-implementor-agent`:

```
Use feedback-implementor-agent on feedback/<agent-name>/<date>-<slug>.md.
```

**Check before moving on**: the same file now has a `## Resolution` section appended, with a Fixed/Skipped/Deferred status per finding and what was actually changed.
