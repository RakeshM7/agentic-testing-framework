# atf Cockpit: plan, contracts and work items

**Status:** in progress on branch `feat/vscode-cockpit` (2026-10-31). The user agreed to the design. The decisions are D-110, the Cockpit sidebar and the check before a session, and D-111, the read-only cockpit data script. Each enters `docs/decisions.md` in the work item that implements it.

**For anyone picking up a work item (a teammate's Claude included):**
- Read `AGENTS.md` and the rules at the top of `docs/decisions.md`.
- Then read **only** the files named in your item, plus this page's contracts.
- Don't change a contract here on your own. If one doesn't fit, stop and report what you need.
- Each item lists the files it owns. Don't edit files another item owns. Integration (W9) wires everything together.
- Finish with `node --test <your test files>` green, and report what you changed.
- Never commit; the user commits.

## 1. What we're building, and why it isn't a BrowserStack knockoff

BrowserStack Test Companion is chat-first. It has quick actions that pre-fill a prompt, a test case table with **Automate**, a Failure Analysis panel with **Fix**, and Keep/Undo.

The atf **Cockpit** is a **pipeline cockpit**. It has no chat; the agent conversation stays in its own tab (Claude Code or Copilot). Its signature:

- **Needs you:** what's waiting on the human: clarifications, approvals, blocked or failed stages, leftovers to sweep.
- **The pipeline rail:** every stage, per module, at a glance.
- **Intents:** one-click buttons that start exactly the right `atf` session: Explore, Write test cases, Automate, Load test, Heal.
- **Evidence-first views in an editor tab:**
  - Run timeline;
  - Traceability (case → approval → automated test → last result);
  - Failures & bug drafts;
  - Safety & ledger (what the run created, and what's left).
- **Look:** theme-native, following the user's VS Code theme including high contrast. Its signature elements:
  - one teal accent, taken from the atf icon;
  - the rail motif;
  - a safety-mode badge (`readonly` or `full-run`);
  - monospace evidence ids (`TC-…`, `CL-…`, `API-…`, `K6-…`, `BUG-…`);
  - glyphs that always come with a text label, never colour alone.

What's already done: W0. The "Companion" panel was renamed **Cockpit**: `src/cockpit.js`, `src/cockpit-sidebar-page.js`, `test/cockpit.test.mjs`, view id `atf.cockpit`. It already has the environment checks, the Products list, the New product form, `doctor.mjs --machine`, the `atf.nodePath` pin and the check before a session (`gateSession` in `src/activate.js`).

## 2. Contracts (fixed; every work item codes against these)

### C1. `packages/core/scripts/cockpit.mjs <product> --json` (D-111)

The environment comes from `ATF_ENV`, as for every script (`lib/contract.mjs paths()`). The script is **read-only**: it writes, creates and locks nothing. It prints one JSON object. All paths are relative to the workspace root, with forward slashes.

```jsonc
{
  "schemaVersion": 1,
  "product": "acme", "environment": "default", "generatedAt": "<iso>",
  "run": null | { "runId", "mode": "readonly"|"full-run", "active": true|false, "createdAt", "target", "modules": [], "steps": [] },
  "overview": {
    "stages": [ /* run.mjs status() rows, unchanged; the extension maps them with runs.js stageState() */ ],
    "next":   [ { "stage", "module": null|"m" } ],                       // run.mjs next(), read-only
    "needsYou": [ {
      "kind": "clarifications"|"approval"|"blocked"|"failed"|"unverified"|"leftovers"|"guard",
      "module": null|"m", "stage": null|"s", "count": 0, "text": "one plain sentence", "ids": ["CL-…"]   // ids: at most 20
    } ],
    "intents": { "<module>": {
      "explore":   { "enabled": bool, "why": "…when disabled" },
      "testcases": { "enabled": bool, "why": "…" },
      "automate":  { "enabled": bool, "why": "…" },      // a playwright-ui or playwright-api step was chosen, and approved cases exist
      "k6":        { "enabled": bool, "why": "…" },
      "heal":      { "enabled": bool, "why": "…", "stage": "playwright-ui"|"playwright-api"|"k6"|null }  // triage has healable rows and that stage is not exhausted
    } }
  },
  "timeline": {
    "stages": [ { "key", "stage", "module": null|"m", "status", "attempts", "startedAt": null|"iso", "finishedAt": null|"iso",
                  "durationMs": null|n, "error": null|"…", "reviewFailed": bool, "findings": [],
                  "steps": [ { "name", "status", "at", "durationMs": null|n } ] } ],
    "totals": { "durationMs": n, "spawns": n },   // from lib/telemetry.mjs effort()
    "history": [ { "runId", "outcome", "createdAt", "endedAt", "report": null|"artifacts/…/report/index.html" } ]   // newest first, at most 20
  },
  "trace": { "modules": [ { "module", "cases": [ {
      "id": "TC-m-1", "title": null|"…", "types": ["ui"|"api"|"performance"],
      "approval": "approved"|"rejected"|"changes"|"pending"|"stale",
      "automation": {
        "ui":  { "status": "mapped"|"excluded"|"deferred"|"pending"|"none", "files": [], "reason": null },
        "api": { "status": "…", "scenarios": ["API-m-3"], "files": [], "reason": null },
        "k6":  { "status": "…", "ids": ["K6-m-1"], "reason": null }
      },
      "results": [ { "framework": "playwright-ui"|"playwright-api"|"k6", "title", "status": "passed"|"failed"|"flaky"|"skipped",
                     "attempts": n, "passedOnRetry": bool, "triageClass": null|"…" } ]
  } ] } ] },
  "failures": {
    "byClass": { "<class>": n },
    "clusters": [ { "module", "framework", "id", "class", "severity": null|"…", "signature", "count",
                    "rows": [ { "key", "title", "tcId"?, "scenarioId"?, "k6Id"?, "error", "fixHint"?, "evidence": ["path"] } ],
                    "bugDraft": null|{ "file", "title" } } ],
    "healable":   [ { "module", "framework", "stage", "count" } ],
    "unverified": [ { "module", "framework" } ]
  },
  "safety": {
    "mode": "readonly"|"full-run"|null, "explanation": "one sentence",
    "ledger": { "file": "artifacts/…/ledger.jsonl", "entries": [ { "ts", "event", "type", "ref", "label"?, "module", "stage", "agent", "live": bool } ],
                "live": n, "cleaned": n },
    "customConfig": { /* report-data customConfig(), unchanged */ },
    "frameworkIssues": n
  },
  "missing": [ { "section", "module": null|"m", "reason" } ]      // a source that isn't there is never a silent zero
}
```

When there's no run yet: `run: null`, every section empty, and `missing` holds `{section:"run", reason:"no run yet"}`. The exit code is 0.

Exit 2 means a usage error. An unknown product prints `{ "error": "…" }` and exits 1.

### C2. The sidebar's webview messages (`src/cockpit.js` ⇄ `src/cockpit-sidebar-page.js`)

The existing messages (`ready`, `check`, `fix`, `useNode`, `unpinNode`, `run`, `doctor`, `openConfig`, `login`, `command`, `pickFiles`, `draft`, `interview`, `newForm`, `openOutput`) stay as they are.

**Host → page:** the existing `{type:"state", state}`, with one new field:

```jsonc
state.cockpit = {
  "selected": null | { "product", "environment" },   // the product shown in the header (the first one with an active run, else the first)
  "loading": bool, "error": null|"…",
  "data": null | { "run", "overview", "missing" }    // C1's fields, as they are
}
```

**Page → host (new messages):** each one is validated in `validatePanelMessage` (bounded strings, slugs), and the host checks it again.

| Message | Fields |
|---|---|
| `select` | `product, environment` |
| `intent` | `product, environment, module, intent: "explore"\|"testcases"\|"automate"\|"k6"\|"heal"` |
| `resume` | `product, environment, stage, module\|null` |
| `openSheet` | `product, module, sheet: "clarifications"\|"approval"` |
| `openTab` | `product, environment, tab: "timeline"\|"trace"\|"failures"\|"safety", focus?: {stage?, module?}` |
| `sweep` | `product, environment` |

### C3. The editor tab's webview messages (`src/cockpit-panel.js` ⇄ `src/cockpit-panel-page.js`)

**Host → page:**

| Message | Fields |
|---|---|
| `data` | `product, environment, tab, focus?, data` (C1, whole) |
| `loading` | none |
| `error` | `message` |

**Page → host:**

| Message | Fields | What the host does |
|---|---|---|
| `ready` | none | |
| `refresh` | none | |
| `tab` | `tab` | |
| `openFile` | `path` | Relative; opened only when it resolves inside the workspace root, exists, and isn't under `.auth/` or a credentials file. |
| `resume` | `stage, module\|null` | |
| `heal` | `module, stage` | |
| `openSheet` | `module, sheet` | |
| `openReport` | `runId` | |
| `sweep` | none | |

### C4. Style and DOM kit (`src/cockpit-style.js`)

The module exports `COCKPIT_CSS` (a string) and `cockpitKit` (a self-contained function, embedded by source as `(${cockpitKit})()`, using browser globals only). Calling it returns:

| Helper | Returns |
|---|---|
| `el(tag, props, ...kids)` | An element. `props`: `class`, `text`, `title`, `on:{event:fn}`, `value`, `checked`, `disabled`, `type`, `name`, `placeholder`, `rows`, `open`, `dataset:{}`, `aria:{label,…}`. Text is always `textContent`; it never sets innerHTML. |
| `btn(text, onClick, cls?, extra?)` | A `button`. |
| `glyph(state)` | `span.glyph.g-<state>` with its symbol, and `title` / `aria-label` set to the state's text. |
| `idChip(id)` | `code.id`. |
| `modeBadge(mode)` | `span.mode.mode-readonly` or `span.mode.mode-full-run`. |
| `rail(items)` | `div.rail` of `[{label, state, onClick?}]`: nodes joined by a line, solid up to the last done node, dashed after. |
| `table(columns, rows, cell?)` | `table.grid`. `columns` is `[{key, label}]`; `cell(row, key)` returns a Node or a string. |
| `empty(text)` | `div.empty`. |
| `dur(ms)` | A string such as `"3m 12s"`, `"850 ms"` or `"—"`. |

The states and their glyphs, with the text each glyph carries:

| State | Glyph | Text |
|---|---|---|
| done | `●` | done |
| running | `◐` | running |
| pending | `○` | pending |
| awaiting-approval | `◆` | awaiting approval |
| blocked | `⊘` | blocked |
| failed | `✗` | failed |
| not-chosen | `·` | not chosen |
| unverified | `?` | unverified |

The CSS classes the pages may rely on are `.rail .rail-node .card .needs .mode .glyph .g-<state> .id .tabs .tab .tab.active .grid .empty .muted .toolbar .chip .section-title`.

The tokens are VS Code theme variables, plus one more:

```css
--atf-accent: color-mix(in srgb, #2fd1a8 70%, var(--vscode-foreground));
```

`body.vscode-high-contrast` replaces fills with borders.

A test helper, `test/fake-dom.mjs`, provides a minimal `document` (`createElement`, `createTextNode`, `append`, `replaceChildren`, `addEventListener` plus a `dispatch(type)` helper, `className`, `textContent`, `title`, `dataset`, `setAttribute`, `children`). Tests install it as `globalThis.document`.

### C5. Intents → the `atf` command (`src/activate.js`, `intentArgv`)

| Intent | argv (plus `envArgs(environment)`) |
|---|---|
| explore | `["explore", product, "--module", m]` |
| testcases | `["testcases", product, "--module", m]` |
| automate | `["automate", product, "--module", m]` |
| k6 | `["k6", product, "--module", m]` |
| heal | `["resume", product, "--stage", <intents[m].heal.stage>, "--module", m]` |

Each one opens through `openSession`. `gateSession` (the Node.js check plus the product's doctor) covers `run`, `resume`, `explore`, `testcases`, `automate` and `k6`.

## 3. Work items

The model column gives the suggested subagent model and effort. Keep each session under 400K tokens: read only the named files, and read large files by excerpt (`grep -n`, then a ranged read).

Owner `—` means unassigned; set your name in the Owner column when you take an item.

| # | Wave | Item | Owns (files) | Model | Owner |
|---|---|---|---|---|---|
| W0 | 0 | Rename Companion → Cockpit | (done) | — | Claude (main) |
| W1 | 1 | Record D-110 | `docs/decisions.md`, `packages/core/docs/*.md` (doctor flags only) | sonnet · medium | — |
| W2 | 1 | Framework cockpit data (C1) + D-111 entry | `packages/core/scripts/cockpit.mjs`, `scripts/lib/cockpit.mjs`, `scripts/cockpit.test.mjs` | sonnet · high | — |
| W3 | 1 | Style + DOM kit (C4) + fake DOM | `packages/vscode/src/cockpit-style.js`, `test/cockpit-style.test.mjs`, `test/fake-dom.mjs` | sonnet · medium | — |
| W4 | 2 | Sidebar page: header, Needs you, rail, intents, tab links | `src/cockpit-sidebar-page.js`, `test/cockpit-sidebar-page.test.mjs` | sonnet · medium | — |
| W5 | 2 | Sidebar host: cockpit state, new messages, intents, gate | `src/cockpit.js`, `src/activate.js`, `test/cockpit.test.mjs`, `test/activate.test.mjs`, `test/fake-vscode.mjs` | sonnet · high | — |
| W6 | 2 | Editor tab: host + page shell + command | `src/cockpit-panel.js`, `src/cockpit-panel-page.js`, `package.json`, `test/cockpit-panel.test.mjs`, `test/manifest.test.mjs` | sonnet · high | — |
| W7a | 2 | Tab: Run timeline | `src/cockpit-tabs/timeline.js`, `test/cockpit-tab-timeline.test.mjs` | sonnet · medium | — |
| W7b | 2 | Tab: Traceability | `src/cockpit-tabs/trace.js`, `test/cockpit-tab-trace.test.mjs` | sonnet · medium | — |
| W7c | 2 | Tab: Failures & bug drafts | `src/cockpit-tabs/failures.js`, `test/cockpit-tab-failures.test.mjs` | sonnet · medium | — |
| W7d | 2 | Tab: Safety & ledger | `src/cockpit-tabs/safety.js`, `test/cockpit-tab-safety.test.mjs` | haiku · medium | — |
| W8 | 3 | Docs: D-111 text checks, SPEC, README, CHANGELOG, artifact contract | `packages/vscode/{SPEC,README,CHANGELOG}.md`, `packages/core/docs/artifact-contract.md` | sonnet · medium | — |
| W9 | 3 | Integration: wire the panel into `activate.js`, `npm run check`, review | any | main session | Claude (main) |

Wave 1 items are independent of each other. Wave 2 needs W2's and W3's files to exist, since they import the kit and test against C1. Within each wave, the items are independent.

**Good items to hand to a teammate:** W7a–W7d (the tabs) and W8 (docs) are self-contained and coded only against C1, C3 and C4.

### W1 · Record D-110
Add D-110 to `docs/decisions.md`, following its rules and the format of D-106 to D-109. First run `node packages/core/scripts/decisions.mjs for docs/decisions.md packages/vscode/src/activate.js --full`, and keep the index consistent: `decisions.test.mjs` checks it.

The title: "The VS Code Cockpit: machine environment checks (`doctor.mjs --machine`), a pinned Node.js for sessions (`atf.nodePath`), a check before every session, and a New product form that drafts the run-config with no agent".

What it records:
- k6 only warns in the machine check;
- the pin puts that Node's folder first on the session's PATH;
- `atf.checkBeforeRun`, with **Start anyway**;
- the form → `run-config.mjs draft`, readonly, never over an existing file;
- it extends D-106 and D-109.

**Affects:** the files listed in `packages/vscode/SPEC.md`'s D-110 lines, plus `packages/core/scripts/doctor.mjs` and `scripts/lib/doctor.mjs`.

Also document `--machine` wherever `packages/core/docs/` lists the doctor's flags (`grep -rn "warn-only" packages/core/docs`).

Test: `node --test packages/core/scripts/decisions.test.mjs`.

### W2 · Framework cockpit data (C1)
Build `scripts/lib/cockpit.mjs` (`export async function cockpitData(product, {root})`) and the CLI `scripts/cockpit.mjs`. Reuse; don't re-derive:
- `report-data.mjs collect()` (queues, bugs, triage `byClass`, failed, blocked and awaiting stages, effort, `k6Leftovers`, `customConfig`);
- `run.mjs status()` and `next()` (never `nextStep`, which writes);
- `lib/testcases.mjs approvalSummary` / `approvalStatus`;
- `lib/ledger.mjs read` / `live`;
- `results.json` items (`tcId`, `tcIds`, `scenarioId`, `k6Id`);
- `ui-code`/`api-code` `coverage.json` items (`refs` are the spec files), and the workload coverage (`loaded[].case`);
- `lib/triage.mjs triagePaths` and `triage.json` rows and clusters;
- `lib/bug-export.mjs` for the bug draft files, if it can be used read-only. Otherwise compute the paths without writing.

Wrap `collect()` so the no-run case returns C1's empty shape.

**Tests** (`scripts/cockpit.test.mjs`): copy `scripts/fixtures/workspaces/contract-2` into a temp dir (`os.tmpdir()`), and add the results, triage and coverage files the test needs. Assert:
1. the C1 shape;
2. the trace join, a case → spec → result;
3. the intents' enabled/why;
4. that it writes nothing: compare a recursive listing of names, sizes and mtimes before and after;
5. the no-run case;
6. an `ATF_ENV=staging` product.

Add D-111 to `docs/decisions.md`, only after W1 has landed (W1 owns that file in wave 1; append yours at the end). If W1 isn't done, put the entry text in your report and the main session adds it.

Don't touch the `packages/vscode` files.

### W3 · Style + DOM kit (C4)
Write `src/cockpit-style.js` exactly as C4 says. The CSS covers:
- the rail (nodes plus a connector line: solid when done, dashed ahead);
- the glyph colours, using `--vscode-testing-iconPassed`, `--vscode-testing-iconFailed`, `--vscode-editorWarning-foreground` and `--vscode-charts-blue` for running, and `--atf-accent` for the rail and the active tab;
- cards (Needs you items, with a left accent border);
- the mode badge (readonly: the accent outline; full-run: a warning fill);
- `.id` in `var(--vscode-editor-font-family)`;
- tabs, the grid table with a sticky header, `.empty`;
- high contrast: `body.vscode-high-contrast`, with borders instead of fills.

It must work at a sidebar width of 240px and in a wide tab.

Also write `test/fake-dom.mjs` (C4), and `test/cockpit-style.test.mjs`. The test covers:
- every helper with the fake DOM;
- that `glyph` sets the title and the aria-label;
- that text never becomes HTML (a `<b>` string stays text);
- that `cockpitKit.toString()` references no module-scope identifier: eval it alone in a `new Function` with the fake document.

See the existing helpers in `src/cockpit-sidebar-page.js` (`el`, `btn`) and `src/sheets/webview.js` (`csp`, `escapeHtml`).

### W4 · Sidebar page
Extend `src/cockpit-sidebar-page.js`. Inject `COCKPIT_CSS` and `cockpitKit` (from W3) into `renderCockpitHtml`, and replace the page's own `el`/`btn` with the kit's.

New sections, top to bottom, all from `state.cockpit` (C2):
1. **The header:** a product and environment `<select>` (sends `select`), `modeBadge`, the run id `idChip`. With `data.run` null: "No run yet", and a **Start run** button (the existing `run` message).
2. **Needs you:** one card per `overview.needsYou` item, with its glyph, text, and ids as chips. Each kind has one action:
   - clarifications → `openSheet clarifications`;
   - approval → `openSheet approval`;
   - blocked or failed → `resume`;
   - leftovers → `sweep`;
   - guard → `openTab safety`.

   Shown only when the list isn't empty.
3. **Pipeline:**
   - the product-level stages as a `rail`;
   - one row per module, with the module name and a glyph per stage;
   - a click sends `openTab timeline` with `focus`.

   State: map each `overview.stages` row through a copy of `runs.js stageState`. Embed that copy in the client and keep it in sync with `runs.js`; a test compares the two over the same rows.
4. **Intents:** a module `<select>`, then the five buttons with `intents[m]`. A disabled button shows its `why` as the title. Each click sends `intent`.
5. **Open the cockpit:** four links (`openTab`).
6. The existing **Environment** (collapsed when every row is ok), **Products** and **New product**.

Extend `validatePanelMessage` with C2's new messages.

Tests (`test/cockpit-sidebar-page.test.mjs`) cover:
- the validation, accept and reject, for each new message;
- the stageState mirror;
- the client rendering with `fake-dom`, from a C1-shaped fixture you write.

The existing `test/cockpit.test.mjs` page tests must stay green.

### W5 · Sidebar host + intents
In `src/cockpit.js`:
1. Build `state.cockpit`:
   - the selected product (the first with an active run, else the first);
   - load C1 through `cli.runJson([product, "--json"], { script: path.join("scripts","cockpit.mjs"), env:{ATF_ENV: environment} })`; check the `runJson` signature in `src/cli.js`;
   - reload on changes, through `runs.js` `WATCH_GLOBS` / `relevantChange` / `debounce`.
2. Handle C2's new messages by calling `actions` (injected), checking each target again against the product list, its modules and the stages in C1.

In `src/activate.js`:
- add the exported `intentArgv(intent, {product, environment, module, healStage})` (C5);
- widen `gateSession` to C5's commands;
- add the `actions` the Cockpit needs: `intent`, `resume`, `openSheet` (the existing `atf.openClarifications` / `atf.openApproval`), `openTab` (calls `atf.openCockpit` with `{product, environment, tab, focus}`; W6 registers it, so tolerate it missing in tests), and `sweep` (`atf.sweep` with the product node).

Tests: `test/cockpit.test.mjs` (the state build, message routing, refusals) and `test/activate.test.mjs` (the `intentArgv` table, and the gate run for the C5 commands). Extend `test/fake-vscode.mjs` only as needed.

### W6 · Editor tab: host, page shell, command
`src/cockpit-panel.js` exports `registerCockpitPanel(context, deps, {actions})`. It:
- registers the command `atf.openCockpit` (args `{product, environment, tab, focus}`; asks for the product when it's missing);
- keeps one `WebviewPanel` per window (`viewType` `atf.cockpitPanel`, title "atf Cockpit · <product>", `retainContextWhenHidden`);
- loads C1 as W5 does, and posts `data`;
- handles C3's messages, re-checking each target:
  - `openFile`: resolve it inside the workspace root, require it to exist, and refuse `.auth/` and the run-config's credentials files; then `vscode.window.showTextDocument`, or `vscode.open` for images and HTML;
  - `resume` / `heal`: `actions.session(argv)` with C5's argv;
  - `openSheet`, `openReport` (`atf.openReport`), `sweep`;
- reloads on changes, debounced.

`src/cockpit-panel-page.js`:
- `renderCockpitPanelHtml({nonce})` with the CSP of `sheets/webview.js`, `COCKPIT_CSS`, and the kit;
- a header with the product, environment, `modeBadge`, run id and **Refresh**;
- a tab strip of Timeline, Traceability, Failures and Safety, which remembers the tab through `vscode.setState`;
- the body is `renderTimeline` / `renderTrace` / `renderFailures` / `renderSafety`, imported from `src/cockpit-tabs/*.js` and embedded by source. Each is called as `render(data, ctx, kit, post)`, where `ctx = {product, environment, run, focus}`.

Until W7 lands, stub the imports in your tests only, never in `src`.

`package.json`: the `atf.openCockpit` command ("Open Cockpit", category atf, `$(dashboard)`), in the Command Palette when `atf.active`, and in the Products view's title menu. Update `test/manifest.test.mjs`.

Tests: `test/cockpit-panel.test.mjs` covers message validation, `openFile` refusals (`..`, absolute outside the root, `.auth/`, a missing file), the HTML's CSP and nonce, and the single panel being reused.

### W7a–W7d · The four tabs
Each file exports **one** self-contained function, embedded by source:
- browser globals only;
- no imports, and no module-scope references (test it as W3 does);
- signature `(data, ctx, kit, post) => Node`;
- `data` is C1 whole: use only your section, plus `run` and `missing` (show `missing` items for your section as a muted "not available: <reason>" note).

Post only C3 messages. Make it readable at 240px and good at 1200px. Each tab has a toolbar of filters, kept in a closure, re-rendering the body. Write a C1-shaped fixture in your test, and test with `test/fake-dom.mjs`.

- **W7a Timeline** (`renderTimeline`):
  - product-level stages, then one swimlane per module;
  - each stage shows a glyph, its name, `dur(durationMs)`, attempts (`×2`), an error or review findings (collapsible), and steps (collapsible);
  - **Resume** on failed, blocked or pending stages (`resume`);
  - `ctx.focus` scrolls to and highlights that stage;
  - below, the run history with **Open report** (`openReport`) when `report` is set;
  - totals at the top.
- **W7b Traceability** (`renderTrace`):
  - one row per case: the id chip, title, type chips, approval, automation per type (status, plus file links → `openFile`), and the last result per framework (glyph, attempts, "passed on retry", triage class);
  - filters: module, type, and "gaps only" (not approved, not automated, failing or flaky);
  - counts at the top: N cases · approved · automated · passing;
  - pending approval links to `openSheet approval`.
- **W7c Failures** (`renderFailures`):
  - class counts as chips (click to filter);
  - clusters sorted by severity then count;
  - each cluster: class, signature, count, module and framework, and its rows (id chip, title, error first line, `fixHint`, evidence links → `openFile`);
  - `bugDraft` → `openFile`;
  - the healable summary, with **Heal** (`heal {module, stage}`);
  - an "unverified triage" warning banner.
- **W7d Safety** (`renderSafety`):
  - the mode badge, large, and its explanation;
  - the ledger table (time, event, type, ref/label, module, stage, agent, live or cleaned), filterable by "live only";
  - "N entities this run created are still live" with **Sweep leftovers…** (`sweep`) when `live > 0` and the run isn't active;
  - customConfig: which framework config was overlaid or ejected (show `permissions` first, flagged);
  - the framework-issues count.

### W8 · Docs
- **`packages/vscode/SPEC.md`:** the layout table rows for the new files, the views (`atf.cockpit`), the `atf.openCockpit` command, the Cockpit's sections and tabs, C2/C3's message rules (each target re-checked, the `openFile` limits), C5's intents and the gate.
- **`README.md`:** "The Cockpit" section, covering the sidebar and the tab, with what each part shows.
- **`CHANGELOG.md`:** "Unreleased", the Cockpit's features in user words.
- **`packages/core/docs/artifact-contract.md`:** `cockpit.mjs` in the scripts list, read-only, D-111.

Match the house style (plain sentences, no marketing). The extension docs never name BrowserStack.

### W9 · Integration (main session)
- Wire `registerCockpitPanel` into `src/activate.js`, with the actions `session`, `openReport`, `sweep` and `openSheet`.
- Run `npm run check` (drift plus every test) and fix the seams.
- Read each new file once for contract drift.
- Have the user press F5 on a project with a run and check:
  - the sidebar sections;
  - the four tabs;
  - each intent opening its session;
  - light, dark and high-contrast themes.
- Update this page's status.

## 3a. Overnight scope (2026-10-31, the user away)

The decisions hook asks the user before any edit to a file a recorded decision governs. These are: `docs/decisions.md` (D-031), `src/activate.js`, `test/activate.test.mjs`, `package.json`, `test/manifest.test.mjs`, the extension's `SPEC.md`/`README.md`/`CHANGELOG.md`, and `packages/core/docs/artifact-contract.md`.

With nobody to confirm, the overnight work touches **only new, ungoverned files**. Every governed edit is drafted and queued for the morning:

- **W1:** the D-110 and D-111 entries are drafted in `docs/cockpit-decisions-draft.md`, then moved into `docs/decisions.md` in the morning.
- **W2:** as planned, but D-111 goes into the draft file.
- **W5:** the cockpit host in `src/cockpit.js`. The intent argv and the gated commands go in a new `src/cockpit-actions.js` (`intentArgv`, `GATED_COMMANDS`) with `test/cockpit-actions.test.mjs`. Wiring it into `activate.js` (the actions, `gateSession`) moves to W9.
- **W6:** `src/cockpit-panel.js` and `src/cockpit-panel-page.js` plus their test. The `package.json` command and `manifest.test.mjs` move to W9.
- **W8:** in the morning.

### Overnight result (2026-11-01)

These items are done, tested, and not committed:
- W0 (the rename);
- W1 (the D-110 draft);
- W2 (`cockpit.mjs`, 8 tests);
- W3 (the kit, 11 tests);
- W4 (the sidebar page, 34 tests together with `cockpit.test`);
- W5 (the sidebar host and `cockpit-actions.js`);
- W6 (the editor tab: host and page, 12 tests);
- W7a–d (the four tabs: 7, 6, 8 and 12 tests).

The main session also did four things:
- **It merged the two validators of the sidebar's messages into one** (`validatePanelMessage`).
- **It fixed two of W2's judgments:**
  - An active run (its lock) no longer disables the intents. Each intent resumes the run (`lib/cli.mjs`), and the orchestrator resolves other missing prerequisites with you (D-077).
  - A bug draft is offered only when its file exists, which is checked read-only.
- **It moved W2's test workspace** to `packages/core/scripts/fixtures/cockpit-workspace.mjs`, which doesn't ship.
- **It added `packages/vscode/test/cockpit-e2e.test.mjs`.** This feeds the real `cockpit.mjs` data into the real sidebar, the editor tab and each tab, clicks every button, and checks that every posted message passes the host's validator.
- **It added the CSS the tab agents asked for:** the toolbar controls, pressed chips, `details`, the focused stage, and `.chip.warn`.

`npm test`: 1134 of 1135 pass. The one failure is expected, and needs you (morning item 1a).

### Morning result (2026-11-01, with the user)
The user's answers:
- **Next step:** do all five governed edits.
- **Teammate (Q1):** review and live test (below).
- **File guard (Q4):** keep it strict.
- **Safety tab before the first run (Q5):** show the mode from the run-config.

The accent (Q3) stays `#2fd1a8`. D-110's text (Q6) went into the log as recorded in D-110.

What was done:
- **a.** `atf/permissions.yaml`: the three cockpit files were added to framework-implementor-agent's write list. `guard.test.mjs` is green.
- **b.** `docs/decisions.md`: D-110 and D-111 are in the log and confirmed 2026-11-01. D-111 also records the sidebar, the editor tab, the strict file guard and the planned mode. The draft file was deleted.
- **c.** `src/activate.js`:
  - `registerCockpit` gets `intent`, `resume`, `openSheet`, `openTab` and `sweep`;
  - `registerCockpitPanel` gets `{session, sweep}`;
  - `openSession` gates `GATED_COMMANDS`;
  - a new `activate.test.mjs` test drives the sidebar's messages to terminal lines and checks the Node.js check stops an intent.
- **d.** `package.json`:
  - `atf.openCockpit`, with palette and view-title entries (Cockpit and Products views);
  - the Clarifications and approval trees start collapsed.

  `manifest.test.mjs` checks that the manifest carries `COMMAND_CONTRIBUTION` and the views' visibility.
- **Q5:**
  - `lib/cockpit.mjs` `plannedSafety()` reads `config/<product>[-<env>].yaml` (read-only) for the mode and the permissions source;
  - `safety.planned` and `safety.configFile` are new C1 fields;
  - the Safety tab renders "Safety mode (before the first run)".
- **e.** Docs (W8) were done by a subagent.

### Teammate brief: independent review + live test
Work on branch `feat/vscode-cockpit` and read this file's §1–§2 first. Don't change code; report findings, each as file:line with a failing scenario.

1. **Review the diff against `main`.**
   - Read the decisions first: `node packages/core/scripts/decisions.mjs show D-110` and `show D-111`.
   - Look for:
     - correctness of the C1 joins in `packages/core/scripts/lib/cockpit.mjs`;
     - message validation and target re-checks in `src/cockpit.js`, `src/cockpit-panel.js` and the two `*-page.js` validators;
     - anything that could write from `cockpit.mjs`;
     - the `resolveOpenable` file guard;
     - XSS: every value must reach the DOM as text, with no `innerHTML`.
   - `npm test` and `npm run check` must be green.
2. **Live test (F5 on `packages/vscode`)** on a workspace with a product that has a run (results, triage, a ledger), and one with no run.
   - Go through each sidebar section: the picker, Needs you, the rail, the intents (disabled ones show why), and Open Cockpit.
   - In the editor tab, go through all four tabs, every filter and every link: Resume, Heal, Open report, opening a file, and the sweep (dry run only).
   - Repeat in Light, Dark and High Contrast themes.
   - Check that the sessions open in an editor terminal with the right `atf …` line, and that an old Node.js stops them.
3. Report a list: blocker / should-fix / nit.

## 4. Follow-up (not in this work)
- **Codex as a host:** `.codex/` (untracked) holds Codex agent TOMLs, an MCP config and hooks. Supporting it means `config/platforms.yaml`, `build-agents`, guard hook wiring, and a decision. Plan it separately.
