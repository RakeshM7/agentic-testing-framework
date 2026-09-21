# Agentic Testing Framework

A set of seven specialized agents — six spokes plus one orchestrator hub — that together plan and execute Manual, Automation (Playwright), UI Visual, and API (Playwright + K6) testing for a web application — from "here's a URL" to a scaffolded, running test suite plus a full API test plan — and close the loop on their own feedback.

This framework ships in **two flavors**, sharing one artifact/config contract:

| | Claude Code | GitHub Copilot |
|---|---|---|
| Agent files | [`claude-agents/`](claude-agents/) (discovered via the `.claude/agents` symlink) | [`copilot-agents/`](copilot-agents/) (discovered via the `.github/agents` symlink, both VS Code and GitHub's cloud coding agent) |
| Setup | Playwright MCP server registered via the committed [`.mcp.json`](.mcp.json) (installed on first use via `npx -y @playwright/mcp@latest`) | See [`docs/copilot-setup.md`](docs/copilot-setup.md) (same Playwright MCP server, registered via `.vscode/mcp.json`) |
| Model/provider | Anthropic only, via Claude Code | GPT / Claude / Gemini, brokered by Copilot |

Both flavors are controlled from the **same** `config/models.yaml` — see "Configuring which model/provider each agent uses" below — and read/write the **same** `artifacts/`, `playwright-tests/`, `api-tests/`, and `feedback/` trees, so a run started in one flavor produces output the other can pick up.

See [`architecture.md`](architecture.md) for the pipeline diagram and design rationale, [`docs/conventions.md`](docs/conventions.md) for the artifact handoff and feedback contracts (platform-agnostic, shared by both flavors), and [`docs/validation-report.md`](docs/validation-report.md) for a real end-to-end dogfood run of every agent against a live app, with per-agent feedback.

## What this repo is

This is a **framework**, not a finished test suite for one product. The deliverable is the seven agent definitions — in `claude-agents/` and `copilot-agents/` — concise, ready-to-deploy agents you point at *any* target web app — plus a run-config schema (`config/run-config.example.yaml`) that lets the orchestrator drive all six spokes without stalling on questions you can answer in advance. `artifacts/eventhub/`, `playwright-tests/`, `api-tests/`, and `feedback/` in this repo are not the framework itself; they're the real output of one validation run (against the public demo site `eventhub.rahulshettyacademy.com`), kept in the repo as a worked example and as evidence the agents actually work, not as a template to edit by hand.

## Agents

Both columns implement identical responsibilities/artifact contracts; only the tool surface, model, and orchestration mechanism differ per platform. Full per-agent detail lives in each linked file.

| Agent | Role | Claude Code file | Copilot file |
|---|---|---|---|
| `orchestrator-agent` | The hub. Takes one run-config YAML file and drives the six spokes below in order, resolving recurring questions from the config instead of stalling for human input. Halts and reports if it hits something the config doesn't cover. | [`claude-agents/orchestrator-agent.md`](claude-agents/orchestrator-agent.md) | [`copilot-agents/orchestrator-agent.agent.md`](copilot-agents/orchestrator-agent.agent.md) |
| `explore-agent` | Crawls a target UI, builds a sitemap, captures a baseline snapshot (screenshot + DOM + network + console) per page. Non-mutating by default; performs full UI interaction (forms, create/update/delete) when the run-config sets `authorizations.mode: full-run`. Optional opt-in authenticated-crawl mode via a credentials file, independent of that flag. | [`claude-agents/explore-agent.md`](claude-agents/explore-agent.md) | [`copilot-agents/explore-agent.agent.md`](copilot-agents/explore-agent.agent.md) (VS Code only — needs a live Playwright MCP session) |
| `requirements-clarification-agent` | Two-pass interview: asks the user about behavior, edge cases, and desired test-case format, then writes an authoritative clarifications doc from their answers. | [`claude-agents/requirements-clarification-agent.md`](claude-agents/requirements-clarification-agent.md) | [`copilot-agents/requirements-clarification-agent.agent.md`](copilot-agents/requirements-clarification-agent.agent.md) |
| `testcase-generator-agent` | Generates manual test cases in the user's confirmed format (Gherkin / Markdown table / CSV / TestRail import), with full edge-case traceability. | [`claude-agents/testcase-generator-agent.md`](claude-agents/testcase-generator-agent.md) | [`copilot-agents/testcase-generator-agent.agent.md`](copilot-agents/testcase-generator-agent.agent.md) |
| `playwright-automation-agent` | Scaffolds or extends a Playwright suite (functional + visual-regression). Matches an existing repo's conventions if one exists; researches best practices and lays out a new framework from scratch if not. Generates mutating specs (booking/checkout/create/delete) but only executes them live under `authorizations.mode: full-run`; otherwise they're generated but skipped at run time. | [`claude-agents/playwright-automation-agent.md`](claude-agents/playwright-automation-agent.md) | [`copilot-agents/playwright-automation-agent.agent.md`](copilot-agents/playwright-automation-agent.agent.md) |
| `api-testing-agent` | Discovers the target's API surface (OpenAPI/Swagger preferred, network-capture fallback), writes an exhaustive test plan, and generates Playwright API tests + k6 load-test scripts. Defaults to GET-only tests and never runs a live load test; under `authorizations.mode: full-run` it generates/executes full GET/POST/PUT/PATCH/DELETE coverage and may run `k6 run` live. | [`claude-agents/api-testing-agent.md`](claude-agents/api-testing-agent.md) | [`copilot-agents/api-testing-agent.agent.md`](copilot-agents/api-testing-agent.agent.md) |
| `feedback-implementor-agent` | Reads feedback file(s) filed by the other agents (never raw feedback text) and implements the fixes -- agent definitions, generated code, or docs -- verifying each and appending a Resolution section back to the same file. | [`claude-agents/feedback-implementor-agent.md`](claude-agents/feedback-implementor-agent.md) | [`copilot-agents/feedback-implementor-agent.agent.md`](copilot-agents/feedback-implementor-agent.agent.md) |

## Configuring which model/provider each agent uses

Edit [`config/models.yaml`](config/models.yaml) — one `claude`/`copilot` model value per agent — then run:

```bash
node scripts/sync-agent-models.mjs
```

This patches the `model:` frontmatter line in every `claude-agents/*.md` and `copilot-agents/*.agent.md` file to match. Never hand-edit a `model:` line directly; the next sync overwrites it. Claude Code's `model:` field is Anthropic-only (`sonnet`/`opus`/`haiku` or a pinned id); Copilot's accepts a prioritized array spanning whatever providers your Copilot subscription/org enables (GPT, Claude, Gemini, etc.).

## What it covers

- **Manual testing**: structured requirements clarification + traceable manual test cases in a format you choose.
- **UI functional automation**: a real, running Playwright project (POM, fixtures, auth setup, CI-ready config) — either extending your existing suite in your existing style, or built from researched best practices if you have none.
- **UI visual testing**: baseline page snapshots during exploration, plus Playwright's own `toHaveScreenshot()` visual-regression specs generated as part of the automation suite (the two are deliberately not conflated — see [`architecture.md`](architecture.md)).
- **API testing**: endpoint discovery, a full functional/negative/boundary/auth/schema/performance scenario matrix, executable Playwright API tests, and k6 load-test scripts.
- **Mode-gated safety, not all-or-nothing**: a single `authorizations.mode` flag in the run-config (`readonly`, the default, or `full-run`) governs every agent uniformly. `readonly` keeps every agent non-mutating against a live target (explore-agent never clicks a mutating control, api-testing-agent stays GET-only and never runs k6 live, playwright-automation-agent generates but skips mutating specs). `full-run` — set explicitly, per target, by a human who owns or is authorized to test that target — lets every agent perform full CRUD/UI actions and a live k6 load run. Even then, destructive actions (delete/cancel/remove) are scoped to entities that run's own agent created, never pre-existing or other users' data — see "Safety architecture" in [`architecture.md`](architecture.md).

## What it does not cover

- **No orchestrator *script* or background process.** `orchestrator-agent` is an LLM subagent, not a daemon — it still runs as a single invocation you (or a scheduler) start, and it still can't interrupt itself to ask you something an interactive session could. See "Orchestrated run" below and the pipeline diagram in `architecture.md`.
- **No fully autonomous exploration of authenticated apps.** `explore-agent` will not guess or infer credentials; by default it stops at any login wall. Getting past one requires an explicit, human-authorized credentials file — independent of `authorizations.mode`, which controls mutation, not login.
- **No mobile, desktop, or non-web testing.** The framework is scoped to web applications reachable by a browser and/or an HTTP API.
- **No test-management-system integration.** Test cases are written to files in the format you choose; importing them into TestRail/Jira/Zephyr/etc. is a manual step.
- **No CI wiring.** `playwright-automation-agent` documents a CI recommendation in its research doc but does not create pipeline config (GitHub Actions, Jenkins, etc.).
- **No live performance testing by default.** `api-testing-agent` generates k6 scripts but only runs `k6 run` against a target when the run-config explicitly sets `authorizations.mode: full-run` for that target — a human still decides, up front and per target, when and where load may actually be generated.
- **No security/penetration testing.** Auth and authorization test cases check for correct *behavior*, not for exploitable vulnerabilities.

## Limitations (learned from real dogfooding)

These are documented in full, with root causes, in [`docs/validation-report.md`](docs/validation-report.md). The dogfood run was against the Claude Code flavor specifically; where a limitation is platform-specific, the Copilot equivalent (if any) is noted inline and detailed in [`docs/copilot-setup.md`](docs/copilot-setup.md). Highlights:

- **Custom agent definitions are not hot-loaded (Claude Code).** After adding or editing a file in `claude-agents/` (discovered via the `.claude/agents` symlink), you must start a **new** Claude Code session before its `subagent_type` becomes invocable via the Agent tool. Editing an agent file mid-session and immediately trying to invoke it will fail with "Agent type not found". VS Code's discovery of `copilot-agents/` (via `.github/agents`) may have similar per-session caching — verify against your VS Code version.
- **Generated Playwright assertions can be wrong if the agent guesses page text instead of reading it.** In the validation run, `playwright-automation-agent` wrote several assertions against a "readable" compound string (e.g. `'Book Tickets — $1,500 per ticket'`) that didn't match the real DOM, which actually renders the label and value as separate text nodes. The agent definition has since been updated (in both flavors) to require grounding assertions in literally-captured text, but always review generated specs before trusting them blindly.
- **Secrets must be file-based, never inline.** Claude Code's own credential-leakage classifier blocks passing plaintext secrets inside an agent prompt; Copilot has no documented equivalent classifier, so this is enforced by agent design alone there. Every agent, in both flavors, expects credentials via a `.env` file it reads itself.
- **`.env` values containing `#` must be quoted.** Unquoted, `dotenv` treats `#` as a comment start and silently truncates the value — this caused a real, confusing login failure during validation before the root cause was found.
- **Demo/shared environments can be flaky or rotate accounts.** During validation, a previously-working test account's password was rejected minutes later with no code change on our side — plausibly an environment-level reset. Don't assume a credential that worked once will keep working against a shared third-party demo target.
- **Explore-agent's screenshots are not Playwright visual baselines.** They're reference material for deciding what to cover; `playwright-automation-agent` generates its own golden images via `--update-snapshots`.
- **`orchestrator-agent` cannot pop a structured question-and-wait, in either flavor.** Claude Code's `orchestrator-agent` has no `AskUserQuestion` access (only the top-level session a human is actually driving reliably has that tool); Copilot's `orchestrator-agent` has no equivalent tool at all. This is exactly why the run-config file exists (see below), and exactly why an unanswered `[Blocking]` question still halts the run instead of the orchestrator finding some other way to ask.
- **The orchestrator needs all six spoke types registered too.** In Claude Code it hits the same session-hot-load limitation as everything else, one level deeper — it can't natively delegate to `explore-agent` etc. until a fresh session has all seven definitions loaded. In Copilot, its `agents:` whitelist depends on all six spoke files existing under `.github/agents/` and being resolvable by name.

## Orchestrated run (recommended once you have a run-config)

The walkthrough below applies to either flavor — invoke `orchestrator-agent`/`orchestrator-agent.agent.md` the way your platform normally invokes an agent (Claude Code: `Use orchestrator-agent...`; Copilot: select it from the agent picker in Chat).

Instead of invoking the six spokes by hand (the step-by-step walkthrough below), copy [`config/run-config.example.yaml`](config/run-config.example.yaml), fill in your target and the questions you can already answer, decide `authorizations.mode` (`readonly` unless you own/are authorized to fully test this target), and invoke the hub once:

```
Use orchestrator-agent with configPath=config/<your-run>.yaml.
```

It drives explore → clarify → testcases → automation → API testing → (if any feedback got filed) the feedback loop, in order, reusing any stage whose output already exists on disk. Two outcomes:

- **Completed** — read `artifacts/<target-slug>/run-report.md` for the active `authorizations.mode`, what ran, what got skipped as already-done, every artifact path, and which `defaults`/`answers` from your config got applied where.
- **Halted at stage N** — the response names the exact stage and, if it's the clarification stage, the exact unanswered `[Blocking]` question(s). Add an `answers` entry (or a more specific `feature.description`) to your config and re-invoke with the same `configPath`; completed stages won't re-run.

The full schema, matching rules, and what the config can never override (a spoke agent's own hard safety rules) are documented in [`docs/conventions.md`](docs/conventions.md)'s "Orchestrator & run-config contract".

## How to use this repo — step by step

The orchestrated run above is the fast path once you have a config. The manual walkthrough below is what it's actually doing at each stage — useful for understanding the pipeline, debugging a halted orchestrator run, or running a single stage on its own.

### 1. Point `explore-agent` at your target

**Claude Code**: start a session in (or pointed at) the repo you want tested, with this framework's `claude-agents/` available (project-scoped agents apply to the project you're in — copy the seven files into your target repo's own `.claude/agents/`, or keep working from this repo if the target is external).

**Copilot**: open the repo in VS Code with the `.github/agents` symlink present (copy `copilot-agents/` plus a `.github/agents` symlink and `.vscode/mcp.json` into your target repo if it's external), confirm the Playwright MCP server is registered (`docs/copilot-setup.md`), and select `explore-agent` from the Copilot Chat agent picker.

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

**Check before moving on**: a real pass/fail count, not a claim. In `readonly` mode (the default), review any `test.skip()`-tagged mutating cases and their reasons — they were generated but intentionally not executed; re-run with `authorizations.mode: full-run` to have the agent execute them live.

### 5. Generate API test coverage

```
Use api-testing-agent, targeting <the app's API>, using the network-requests.json files
under artifacts/<target-slug>/explore/pages/*/ and any OpenAPI/Swagger docs you know about.
```

**Check before moving on**: `artifacts/<target-slug>/api/api-test-plan.md` and `discovered-endpoints.json` exist; `api-tests/playwright-api/` collects real tests (`npx playwright test --list`). In `readonly` mode (the default), `api-tests/k6/` scripts exist but were **not** run, and Playwright API specs stayed GET-only. If you invoked the agent directly with `mode: full-run` (or ran it via the orchestrator with that `authorizations.mode`), it already executed the full-method Playwright suite and, if authorized, the k6 run itself — check its final response and `api-tests/k6/results/` rather than assuming nothing ran. To run either yourself afterward:

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
