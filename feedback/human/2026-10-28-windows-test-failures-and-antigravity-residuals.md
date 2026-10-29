---
source_agent: human
date: 2026-10-28
target: framework
related_files:
  - packages/core/scripts/lib/agents/source.mjs
  - packages/core/scripts/lib/agents/renderers/common.mjs
  - packages/core/scripts/build-plugin.mjs
  - packages/core/scripts/build-plugin.test.mjs
  - packages/core/scripts/config.test.mjs
  - packages/core/scripts/run.mjs
  - packages/core/scripts/lib/roots.mjs
  - packages/core/scripts/hooks/pretooluse.mjs
  - packages/core/scripts/hooks/hosts/antigravity.mjs
  - .gitattributes
severity: medium
---

<!--
How to work this file (for the agent that picks it up):
- Read AGENTS.md first, then run
  `node packages/core/scripts/decisions.mjs for <every file you will change> --full`.
  A fix that would revert, weaken or bypass a recorded decision is `deferred`, with
  "Deferred — needs user confirmation (D-NNN)".
- Contract: packages/core/docs/conventions.md, "Feedback contract". Append one
  Resolution per finding, then make `node packages/core/scripts/feedback.mjs check <this file>` exit 0.
- Changes to the guard, the hooks, platforms or permissions are human-gated (conventions.md,
  "How it's consumed", step 4). For Findings 3 and 4, framework-implementor-agent writes the
  exact change and marks them `deferred`; a human-supervised session may apply them.
- Each code fix gets a test. Run `npm run check` before writing the Resolution.
- Environment where these failures reproduce: Windows 11, Node v26.4.0, git
  core.autocrlf=true, repo at commit 95c4a12 on branch feat/antigravity-host. Findings 1 and 2
  also fail at bac1d67, so they predate the Antigravity work.
-->

## Finding 1: Generated agent files take the source file's line endings, so build-plugin.test fails on a Windows checkout

**Summary:** On a Windows checkout with `core.autocrlf=true`, every agent source `packages/core/agents/*.md` has CRLF line endings in the working copy. The renderer copies the source's line ending into its output (`source.mjs:146`, `renderers/common.mjs:28`). So the Claude Code plugin's agent files come out CRLF, and `build-plugin.test.mjs:89` expects LF. As a result:
- this test fails on every Windows developer machine;
- a plugin release built on Windows ships different bytes from one built on Linux or macOS.

**Evidence:**
- Reproduce: `node --test packages/core/scripts/build-plugin.test.mjs` on Windows with `core.autocrlf=true`.
- Failure log (trimmed):
  ```
  test at packages\core\scripts\build-plugin.test.mjs:82:1
  ✖ plugin agents: bare name:, atf: subagents, the plugin's browser tools, no ignored frontmatter, no plugin-root paths
    AssertionError [ERR_ASSERTION]: api-discoverer
        at TestContext.<anonymous> (file:///c:/.../packages/core/scripts/build-plugin.test.mjs:89:12)
      actual: '---\r\n# GENERATED for the atf Claude Code plugin from @testagentic/atf 0.1.0 (agents/api-discoverer.md) -- do not edit: ...\r\nname: api-discoverer\r\n...'
      expected: /^---\n# GENERATED for the atf Claude Code plugin from @testagentic\/atf /
  ```
- Where the line ending is chosen:
  - `packages/core/scripts/lib/agents/source.mjs:146`: `eol: text.includes("\r\n") ? "\r\n" : "\n"`
  - `packages/core/scripts/lib/agents/renderers/common.mjs:28`: `assemble = (lines, body, eol) => ["---", ...lines, "---"].join(eol) + eol + body`
- Git's view of the files: `git ls-files --eol packages/core/agents/api-discoverer.md` gives `i/lf w/crlf attr/`. The index is LF and the working copy is CRLF, and there is no eol attribute.
- The only eol rule in `.gitattributes` is `packages/core/templates/** text eol=lf` (D-054: templates render the same bytes on every OS).
- Not reproduced: `node packages/core/scripts/build-agents.mjs --check` reports `0 generated file(s) out of date` today, even though the generated `.agents/agents/*.md` and `.claude/agents/*.md` are CRLF in the working copy. The earlier claim that `--check` flags the new `.agents/*` files after a fresh CRLF checkout (finding S8-08) is therefore unconfirmed; check it on a fresh clone before acting on it.

**Suggested fix:** pick one of these, after the decision lookup:
- **(A), preferred, with a test:** make generated output independent of the build OS by always rendering LF.
  1. In `source.mjs`, normalise the body to `\n` and set `eol: "\n"`. Alternatively, have `assemble` and `appendFragment` always use `\n`.
  2. Add a `.gitattributes` rule for the sources and generated outputs, in the same style as the D-054 templates rule:
     ```
     packages/core/agents/** text eol=lf
     .claude/agents/** text eol=lf
     .github/agents/** text eol=lf
     .agents/** text eol=lf
     ```
  3. Add `.mcp.json`, `.vscode/mcp.json` and `*/hooks/framework-guard.json` to that rule too, since they already show LF/CRLF churn.
  4. Run `git add --renormalize .` and confirm `git diff --cached --ignore-cr-at-eol --stat` is empty apart from `.gitattributes`.
  5. Check the drift check and the client-workspace sync (`atf sync`/`atf check`, `lib/sync.mjs`), which compare bytes.

  This changes what the build writes, so look up D-018, D-019, D-054, D-089 and D-092 first. If any of them records "preserve the source's line endings", defer this option.
- **(B), minimal:** if (A) is deferred, make the test independent of line endings. In `build-plugin.test.mjs:89` use `/^---\r?\n# GENERATED .../`, and check that no other assertion in that file assumes `\n`. Record in the Resolution that release bytes still depend on the build OS.

## Finding 2: config.test.mjs compares Windows paths as case-sensitive strings and fails when the drive letter's case differs

**Summary:** `config.test.mjs:172` compares `path.resolve(ws, r.run.permissionsPath)` with `configPath("permissions.yaml")` using `assert.equal`. The two sides can name the same file with different drive-letter case:
- `ws` comes from `tmpdir()`, so it starts with `C:\`.
- `frameworkRoot` comes from `import.meta.url`, so it takes the case of the path Node was started with. VS Code launches with `c:\`.

The test passes or fails depending on how the shell or IDE spelled the working directory. The cause is not line endings; the Antigravity PR description listed it as a CRLF failure, which is wrong.

**Evidence:**
- Reproduce on Windows: `node --test packages/core/scripts/config.test.mjs`, run from a shell whose working directory starts with a lowercase `c:\`, as the VS Code terminal and extension do. It passes when the working directory starts with `C:\`.
- Failure log:
  ```
  test at packages\core\scripts\config.test.mjs:162:1
  ✖ run.mjs init freezes the overlaid permissions; validation still applies; a run-config's own permissions_file gets no overlay
    AssertionError [ERR_ASSERTION]: permissionsPath still names the framework's copy
    + 'C:\\Users\\RakeshManoharan\\Documents\\GitHub\\agentic-testing-framework\\packages\\core\\config\\permissions.yaml'
    - 'c:\\Users\\RakeshManoharan\\Documents\\GitHub\\agentic-testing-framework\\packages\\core\\config\\permissions.yaml'
        at TestContext.<anonymous> (file:///c:/.../packages/core/scripts/config.test.mjs:172:10)
  ```
- Where the paths come from:
  - `packages/core/scripts/lib/roots.mjs:24`: `frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")`
  - `packages/core/scripts/run.mjs:102`: `rel = (root, p) => path.relative(root, p).replaceAll("\\", "/")`
  - `packages/core/scripts/run.mjs:187`: `permissionsPath: rel(root, permPath)`

**Suggested fix:**
1. Fix the test, which is the real bug. Compare the paths in a way that ignores case on Windows. For example, add a helper to `test-helpers.mjs`:
   ```js
   samePath = (a, b) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b)
   ```
   Use it at `config.test.mjs:172`.
2. Audit production code for the same pattern. Grep `packages/core/scripts/**/*.mjs` for `===`/`!==`/`startsWith` comparisons between absolute paths, for example against `frameworkRoot`, a workspace root, or the guard's root and framework checks: `isWithin`, `frameworkWrite` and `writeUnder` in `lib/guard.mjs`, and `overlaps` in `build-plugin.mjs`.
   - `path.relative` already ignores case on win32, so code that uses it is fine.
   - Any raw string comparison that decides a guard verdict is a safety bug. Report each one as its own finding, and do not change guard code (see the human-gated note at the top of this file).
3. Add a regression test that runs `initRun` with a framework path whose drive letter is in the other case, using the `framework` option of `configPath`.

## Finding 3: the Antigravity adapter treats any MCP server whose name contains "playwright" as the framework's browser server

**Summary:** `hooks/hosts/antigravity.mjs` (≈ lines 58-71, `browserActionOf`) classifies a tool as the Playwright browser when its server part only *contains* `playwright`, mirroring Copilot's `/playwright.*?browser_(\w+)$/i`. A user-level server such as `playwright-ext`, Playwright MCP in extension mode driving the user's real Chrome, would be judged as the framework's server. That would bypass D-070, the rule that only Playwright's own Chromium may be used, which comes with the network guard's init page.

**Evidence:**
- Validation finding S8-09, informational. The validation and fix notes for this branch are in the main session's plan folder (`antigravity-specs/S8-findings.md` and `S9-handoff.md`).
- Reproduce: feed a payload with `toolCall.name` = `mcp_playwright-ext_browser_click` to `normalize()` in `packages/core/scripts/hooks/hosts/antigravity.mjs`. It returns `kind: "browser"` rather than `unknown`.
- The exact MCP tool-name format on Antigravity is still unverified. It is the `mcp_{server}_browser_{tool}` template in `packages/core/config/platforms.yaml`, and `docs/antigravity-spike/README.md` check 1 is the check that confirms it.

**Suggested fix:** this is human-gated because it changes the guard's host adapter (D-020, D-070, D-099), so `deferred` with the exact change.
1. Require the server part to equal `browser_server` from `packages/core/config/mcp.yaml`, read through the config loader, not a constant. Allow only the separator(s) the spike confirms.
2. Add a fixture `antigravity-documented-mcp_playwright-ext_browser_click.json` and a test asserting it is `unknown`, and so denied during a run (D-101).
3. Consider the same tightening for `copilot.mjs` as a separate finding, since it changes an existing host.

## Finding 4: a malformed Antigravity hook payload can fail open when the hook's working directory isn't the workspace

**Summary:** When the stdin payload can't be parsed, `workspacePaths` is lost. The adapter then falls back to `process.cwd()` for the root (`hooks/hosts/antigravity.mjs` ≈ line 106, used from `hooks/pretooluse.mjs` ≈ line 63). If Antigravity runs hooks from a directory other than the workspace, no run lock is found, and the call is allowed with "no run is active" during an active run.

Two things limit the risk:
- The registered command is relative to the working directory (`node {fw}/scripts/hooks/pretooluse.mjs`), so a hook started outside the workspace usually can't even load.
- The D-037 liveness check then refuses the run.

**Evidence:**
- Validation finding S8-04 (low; depends on the spike).
- The validator reproduced it with a bad-JSON payload and the hook's working directory set to `%TEMP%`, with a run active in the workspace. The hook allowed the call ("no run is active, so the call is allowed", exit 0). With the working directory set to the workspace root it denied the call.
- The validator's probe script is `p2-hook.mjs`, in a temporary session folder that may be gone. Re-create it from this description if needed.
- Where Antigravity runs hooks from is unverified; `docs/antigravity-spike/README.md` check 5 records it.

**Suggested fix:** this is human-gated because it changes the hook entry and the adapter (D-007, D-040, D-085, D-099), so `deferred` with the exact change.
1. When the payload can't be parsed, don't fall back to `process.cwd()` alone. Also derive the workspace root from the hook script's own location, the same way `hookWorkspaceRoot` does for D-085: in an installed workspace the script is `<ws>/node_modules/@testagentic/atf/scripts/hooks/pretooluse.mjs`.
2. If either candidate root has an active run lock, fail closed (`guard-error`).
3. Add a test that pipes bad JSON with the working directory set to a temp folder while a run lock exists in the workspace, and expects a deny. Model it on the fail-closed tests in `packages/core/scripts/hooks.test.mjs`.
4. If the spike later shows Antigravity always runs hooks from the workspace, record that in the Resolution. The fix still holds as defence in depth.

## Resolution (2026-10-28)

### Finding 1
- **Status:** fixed
- **Reason:** Fixed by checking out LF on every OS, through git; the renderer is unchanged. Option (A)'s source.mjs change was tried in a human-supervised session (2026-10-29) and reverted: D-090 records "Line endings follow the source", and the user chose to keep that decision rather than supersede it. With the sources checked out LF, every render is LF, so a plugin release built on Windows has the same bytes as one built on Linux.
  - **`.gitattributes`:** `text eol=lf` for `packages/core/agents/**`, `dev/agents/**` (the dev-only agents' sources, which also drifted), `.claude/agents/**`, `.github/agents/**`, `.agents/**`, `.mcp.json`, `.vscode/mcp.json` and both `framework-guard.json` files. `.claude/settings.json` is left out on purpose (D-092).
  - **Renormalize:** the index already held all of these files as LF (`i/lf`), so `git add --renormalize` changes nothing in the index. The CRLF working copies (all clean) were re-checked out as LF; `git ls-files --eol` now shows `i/lf w/lf attr/text eol=lf` for all 149.
  - **Tests:** `build-plugin.test.mjs:89` stays strict (`/^---
# GENERATED …/`), so the plugin's agents must be LF. New `build-agents.test.mjs` test ".gitattributes checks the agent sources and every generated host file out LF" asserts `git check-attr eol` is `lf` for every covered path (skipped outside a git checkout).
  - **S8-08:** confirmed on a fresh clone (5 MCP and hook files out of date); the eol rules fix it.
  - **Other developers:** a working copy checked out before this change stays CRLF until it is re-checked out (`git rm --cached -r . && git reset --hard`, or a fresh clone); until then `build-plugin.test.mjs` fails on that machine, which names the problem.
- **Files changed:** .gitattributes, packages/core/scripts/build-agents.test.mjs, packages/core/scripts/build-plugin.test.mjs
- **Decisions considered:** D-018, D-019, D-054, D-056, D-089, D-090, D-092, D-098

### Finding 2
- **Status:** fixed
- **Reason:** The test was wrong, as the finding says; `run.mjs` is right, because `path.relative` ignores case on win32.
  - **Fix:** `test-helpers.mjs` gains `samePath(a, b)` (resolved, compared without case on win32) and `otherDriveCase(p)`. `config.test.mjs:172` now asserts `samePath(path.resolve(ws, r.run.permissionsPath), configPath("permissions.yaml"))`.
  - **A second Windows failure, hidden behind the first:** line 186 built the ejected copy with `/^(  knowledge-generator:\n(?:    .*\n)*?    web_research:) allowed/m`, which never matches a CRLF `config/permissions.yaml`. Since `.` does not match `\r`, the `notEqual` assertion failed. It now uses `\r?\n`.
  - **Regression test:** "run.mjs init records the same permissionsPath whatever the case of the framework's drive letter". It runs `initRun` with `framework: otherDriveCase(frameworkRoot)` and checks three things: the recorded path is the same file as `configPath("permissions.yaml", { framework: flipped })` and as `configPath("permissions.yaml")`; on win32, `flipped !== frameworkRoot`; and the recorded relative `permissionsPath` equals the one from an unflipped run.
  - **Verified:** `node --test packages/core/scripts/config.test.mjs` passes (11/11) from a `C:\` shell and from a `cmd` shell at `c:\…`, where `frameworkRoot` was confirmed to start with `c:\`. `npm run check` passes too.
  - **Audit** of `packages/core/scripts/**/*.mjs` for raw comparisons between absolute paths: none decides a guard verdict.
    - The guard's write checks (`writeUnder`/`frameworkWrite`, `guard.mjs:388-407`) fold both sides through `normalizeWritePath`, which lowercases.
    - `samePath` (`guard.mjs:293`) lowercases.
    - `sameDir` and `isWithin` (`roots.mjs:93-100`) fold case on win32.
    - `managedPath` and `decisions.mjs` `targetsOf` use `path.relative`.
    - `pretooluse.mjs:43` and `guard.mjs:343` only compare `path.dirname(x) === x`, the loop end.
    - `build-plugin.mjs:189` `overlaps` ORs its raw `plain()` check with the folded `isWithin`, so it can only find more overlaps.
  - **Non-guard, low:** `lib/explore.mjs:1182` (`path.resolve(file) === path.resolve(…knowledge…)`, both sides built from the same `productDir`) and `lib/fix.mjs:158` (`owned.has(path.resolve(b, f))`: a fixer that names a file in another case is told it is not a code file, which fails closed).
  - **Guard-relevant, outside this finding:** a relative-path case gap. `lib/decisions.mjs:78` `governing()` matches Affects globs with `permissions.mjs:136` `globToRegExp` (no `i` flag) against the call's own spelling. On Windows, a write to `Packages/Core/scripts/lib/guard.mjs` names the same file as `packages/core/scripts/lib/guard.mjs` but gets no decision "ask". It fails open for governance only, not for safety: managed files use `normalizeWritePath`, and the case-sensitive write allow-list (`permissions.mjs:182` `canWrite`) fails closed. It is safety code, so a human should file it as its own finding.
- **Files changed:** packages/core/scripts/config.test.mjs, packages/core/scripts/test-helpers.mjs
- **Decisions considered:** D-084, D-086, D-088, D-089

### Finding 3
- **Status:** fixed
- **Reason:** Applied in a human-supervised session (2026-10-29) at the user's request; it tightens D-070 and contradicts no decision. `browserActionOf(tool, server)` in `hooks/hosts/antigravity.mjs` now requires the server part to equal the effective `mcp.yaml`'s `browser_server`, exactly (case included), in either form (`mcp_{server}_browser_` or `mcp__{server}__browser_`); with no server, nothing is the browser. `mcp_playwright-ext_browser_click` is `unknown`, so it is denied during every run (D-101).
  - **How the server is read:** not through `loadConfig` as first proposed. The guard deliberately loads no YAML parser on a hook call (`lib/config.mjs` header), so the new `browserServer(framework, workspace)` in `lib/browser-tools.mjs` reads the key from the effective text, the way `networkGuarded` reads `--init-page`. A workspace's `atf/mcp.yaml` overlay or ejected copy counts (the workspace is `hookWorkspaceRoot` of the payload's root).
  - **Tests (`hooks.test.mjs`):** fixture `antigravity-documented-mcp_playwright-ext_browser_click.json`, expected `unknown`; `mcp_playwright-ext_browser_click`, `mcp__playwright-ext__browser_click`, `mcp_my-playwright_browser_click` and `mcp_Playwright_browser_click` added to `agUnmapped` (so refused in full-run and readonly runs); the D-101 readonly test covers the new fixture; a workspace overlaying `browser_server: pw` makes `mcp_pw_browser_click` the browser and `mcp_playwright_browser_click` unknown.
  - **Still open, separate findings:** `hooks/hosts/claude.mjs:72-75` (`server.includes("playwright")`) and `hooks/hosts/copilot.mjs:41` (`/playwright.*?browser_(w+)$/i`) have the same looseness. The exact tool-name format on Antigravity is still unverified (spike check 1).
- **Files changed:** packages/core/scripts/hooks/hosts/antigravity.mjs, packages/core/scripts/lib/browser-tools.mjs, packages/core/scripts/hooks.test.mjs, packages/core/scripts/fixtures/hooks/antigravity-documented-mcp_playwright-ext_browser_click.json
- **Decisions considered:** D-006, D-020, D-021, D-065, D-070, D-076, D-088, D-092, D-099, D-101

### Finding 4
- **Status:** fixed
- **Reason:** Applied in a human-supervised session (2026-10-29) at the user's request; it only adds a fail-closed case (D-007). In `hooks/pretooluse.mjs`, when anything fails (a payload that can't be parsed included), the hook checks for a run lock in the root it started from and, for an installed framework, in its own workspace (`ownWorkspace()`: the nearest `atf/atf.json` above `<ws>/node_modules/@testagentic/atf`, built-ins only, so it works when no module loads). A lock in either blocks the call, and the error is logged in the workspace that holds the run. In a source checkout `ownWorkspace()` is null, so the existing idle tests are unaffected.
  - **Test (`hooks.test.mjs`):** "hook entry fails closed on garbage started outside the workspace while the workspace that installed it has a run (D-007)": an installed workspace with a lock, the installed hook entry, `--host antigravity`, bad JSON, working directory a temp folder: a deny on stdout, exit 0, logged in the workspace; after the lock is removed, allowed (exit 0, empty stdout). Before the fix this call was allowed.
  - **Not done:** the optional defence in depth in `hosts/antigravity.mjs` `rootsOf` (an own-workspace candidate when the payload has no `workspacePaths`). Where Antigravity runs hooks from is still unverified (spike check 5); record it here when known.
- **Files changed:** packages/core/scripts/hooks/pretooluse.mjs, packages/core/scripts/hooks.test.mjs
- **Decisions considered:** D-007, D-037, D-040, D-065, D-081, D-085, D-086, D-092, D-099

