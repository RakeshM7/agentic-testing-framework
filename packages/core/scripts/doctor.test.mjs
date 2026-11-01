import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { GROUPS, MACHINE_GROUPS, STAGE_NEEDS, browserBuilds, browsersDir, doctorStatus, failures, groupsFor, recordDoctor, runChecks, uncoveredStages } from "./lib/doctor.mjs";
import { autofixSteps, machineChecks, main, scope } from "./doctor.mjs";
import { doctor, initRun, setStage } from "./run.mjs";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { SETUP_WORKFLOW, sync } from "./lib/sync.mjs";
import { INSTALLED_PACKAGE, installedWorkspace, put, startRun, tempRoot } from "./test-helpers.mjs";
import { expandFw } from "./lib/roots.mjs";
import { CONTRACT_VERSION } from "./lib/contract.mjs";

// a framework command as printed from this repo's workspace: `node scripts/...`, or `node packages/core/scripts/...`
const FW = expandFw("{fw}/").replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

const BROWSERS = (rev = "1248") => JSON.stringify({ browsers: [{ name: "chromium", revision: rev }, { name: "chromium-headless-shell", revision: rev }, { name: "firefox", revision: "1543" }] });
const NOW = Date.parse("2026-10-19T12:00:00Z");

// A throwaway root with its own Playwright browsers folder; `opts` go to runChecks. The root is also the framework root
// (D-085: one directory, as in this repo), so its package.json, node_modules and config/mcp.yaml are the ones checked.
function machine() {
  const root = tempRoot();
  const env = { PLAYWRIGHT_BROWSERS_PATH: path.join(root, "browsers") };
  const opts = { root, framework: root, env, platform: "linux", home: root, nodeVersion: "22.1.0", now: NOW, which: () => true, exists: () => true, fetchImpl: async () => ({ status: 200 }) };
  const installed = (name, rev) => put(root, `browsers/${name.replaceAll("-", "_")}-${rev}/INSTALLATION_COMPLETE`, "");
  const core = (dir, rev = "1248", version = "1.64.1") => {
    put(root, `${dir}/node_modules/playwright-core/browsers.json`, BROWSERS(rev));
    put(root, `${dir}/node_modules/playwright-core/package.json`, JSON.stringify({ version }));
  };
  return { root, env, opts, installed, core };
}

const cfg = (auth = {}, extra = {}) => ({ product: "acme", target: { url: "https://app.acme.test", api_urls: [] }, authorizations: { mode: "readonly", authenticated_crawl: false, identities: [], ...auth }, ...extra });
const ids = (checks) => Object.fromEntries(checks.map((c) => [c.id, c.ok && c.level !== "warn" ? "ok" : c.ok ? "warn" : "fail"]));
const mcpYaml = (args) => `browser_server: playwright\nservers:\n  playwright:\n    command: npx\n    args: [${["-y", "@playwright/mcp@0.0.83", ...args].map((a) => `'${a}'`).join(", ")}]\n`;

test("every stage says what it needs, in known groups only", () => {
  assert.deepEqual(uncoveredStages(), []);
  for (const [stage, needs] of Object.entries(STAGE_NEEDS)) for (const g of needs) assert.ok(GROUPS.includes(g), `${stage}: ${g}`);
  assert.deepEqual(groupsFor(["explore"]), ["base", "browser", "session", "target"]);
});

test("browsers folder follows Playwright's rules per platform and PLAYWRIGHT_BROWSERS_PATH", () => {
  assert.equal(browsersDir("/p", { env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, platform: "win32", home: "C:\\Users\\u" }), path.join("C:\\Users\\u\\AppData\\Local", "ms-playwright"));
  assert.equal(browsersDir("/p", { env: {}, platform: "darwin", home: "/Users/u" }), path.join("/Users/u", "Library", "Caches", "ms-playwright"));
  assert.equal(browsersDir("/p", { env: {}, platform: "linux", home: "/home/u" }), path.join("/home/u", ".cache", "ms-playwright"));
  assert.equal(browsersDir("/p", { env: { PLAYWRIGHT_BROWSERS_PATH: "0" } }), path.join("/p", "node_modules", "playwright-core", ".local-browsers"));
  assert.equal(browsersDir("/p", { env: { PLAYWRIGHT_BROWSERS_PATH: "/b" } }), "/b");
});

test("a Playwright update whose browser build was never downloaded is caught (the atf login failure)", () => {
  const m = machine();
  m.core(".", "1248");
  m.installed("chromium", "1243"); // the build of the previous version
  const core = path.join(m.root, "node_modules", "playwright-core");
  assert.deepEqual(browserBuilds(core, ["chromium"], m.opts).missing.map((b) => `${b.name}-${b.revision}`), ["chromium-1248"]);
  m.installed("chromium", "1248");
  assert.deepEqual(browserBuilds(core, ["chromium", "chromium-headless-shell"], m.opts).missing.map((b) => b.name), ["chromium-headless-shell"]);
  assert.equal(browserBuilds(path.join(m.root, "nowhere"), ["chromium"], m.opts), null);
});

test("base and login: Node version, pinned framework dependencies, and the login browser (Edge, else Chrome, else Playwright's Chromium with its install as autofix)", async () => {
  const m = machine();
  put(m.root, "package.json", JSON.stringify({ dependencies: { "js-yaml": "^4.1.0" }, devDependencies: { playwright: "1.64.1" } }));
  put(m.root, "node_modules/js-yaml/package.json", JSON.stringify({ version: "4.1.0" }));
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.63.0" }));
  m.core(".");
  const noBranded = { ...m.opts, exists: () => false };
  let checks = await runChecks(cfg(), ["base", "login"], { ...noBranded, nodeVersion: "18.20.0" });
  assert.deepEqual(ids(checks), { node: "fail", "framework-deps": "fail", "workspace-contract": "ok", "login-browser": "fail" });
  assert.match(checks.find((c) => c.id === "framework-deps").detail, /playwright is 1\.63\.0, package\.json pins 1\.64\.1/);
  assert.deepEqual(checks.find((c) => c.id === "login-browser").autofix, { cmd: "npx", args: ["playwright", "install", "chromium"], cwd: m.root });
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.64.1" }));
  m.installed("chromium", "1248");
  checks = await runChecks(cfg(), ["base", "login"], noBranded);
  assert.deepEqual(ids(checks), { node: "ok", "framework-deps": "ok", "workspace-contract": "ok", "login-browser": "warn" });
  assert.match(checks.find((c) => c.id === "login-browser").detail, /some single sign-on providers block/);
  const only = (p) => ({ ...m.opts, exists: (x) => x === p });
  assert.equal(ids(await runChecks(cfg(), ["login"], only("/opt/google/chrome/chrome")))["login-browser"], "warn");
  assert.deepEqual(await runChecks(cfg(), ["login"], only("/opt/microsoft/msedge/msedge")), [{ group: "login", id: "login-browser", ok: true, level: undefined, detail: "the login opens Microsoft Edge" }]);
});

test("base in a monorepo: dependencies hoisted to the workspace's node_modules count, and the peer playwright must resolve from the workspace", async () => {
  const m = machine();
  // the workspace root holds the install (npm workspaces); the framework is a package folder under it
  const fw = path.join(m.root, "packages", "core");
  put(m.root, "packages/core/package.json", JSON.stringify({ name: "@testagentic/atf", dependencies: { "js-yaml": "^4.1.0" }, peerDependencies: { playwright: "1.64.1" } }));
  put(m.root, "package.json", JSON.stringify({ workspaces: ["packages/*"], devDependencies: { playwright: "1.64.1" } }));
  put(m.root, "node_modules/js-yaml/package.json", JSON.stringify({ version: "4.1.0" }));
  m.core(".");
  const opts = { ...m.opts, framework: fw, exists: () => false };
  let checks = await runChecks(cfg(), ["base", "login"], opts);
  assert.deepEqual(ids(checks), { node: "ok", "framework-deps": "ok", "framework-peers": "fail", "workspace-contract": "ok", "login-browser": "fail" });
  const peers = checks.find((c) => c.id === "framework-peers");
  assert.match(peers.detail, /playwright is not installed/);
  assert.deepEqual(peers.autofix, { cmd: "npm", args: ["install"], cwd: m.root }, "the workspace lists it: npm install there");
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.63.0" }));
  assert.match((await runChecks(cfg(), ["base"], opts)).find((c) => c.id === "framework-peers").detail, /playwright is 1\.63\.0, package\.json pins 1\.64\.1/);
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.64.1" }));
  m.installed("chromium", "1248");
  checks = await runChecks(cfg(), ["base", "login"], opts);
  assert.deepEqual(ids(checks), { node: "ok", "framework-deps": "ok", "framework-peers": "ok", "workspace-contract": "ok", "login-browser": "warn" }, "the hoisted playwright-core's Chromium too");
  // a workspace that does not list the peer is told what to add, never changed by --fix
  put(m.root, "package.json", JSON.stringify({ workspaces: ["packages/*"] }));
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.63.0" }));
  const unlisted = (await runChecks(cfg(), ["base"], opts)).find((c) => c.id === "framework-peers");
  assert.equal(unlisted.fix, "npm install --save-dev playwright@1.64.1 (in the workspace)");
  assert.equal(unlisted.autofix, undefined);
});

test("base: the workspace's artifact contract must be this code's: unrecorded counts as 2; newer, older or unreadable fails with the fix (docs/packaging.md §3.10)", async () => {
  const m = machine();
  const check = async () => (await runChecks(cfg(), ["base"], m.opts)).find((c) => c.id === "workspace-contract");
  assert.deepEqual(await check(), { group: "base", id: "workspace-contract", ok: true, level: undefined, detail: `artifact contract ${CONTRACT_VERSION} (not recorded in atf/atf.json, 2 assumed)` }, "no marker: one directory that is both");
  put(m.root, "atf/atf.json", "{}\n");
  assert.equal((await check()).detail, "artifact contract 2 (not recorded in atf/atf.json, 2 assumed)", "a marker from before the field");
  put(m.root, "atf/atf.json", `{ "contract": ${CONTRACT_VERSION} }\n`);
  assert.deepEqual([(await check()).ok, (await check()).detail], [true, `artifact contract ${CONTRACT_VERSION}`]);
  put(m.root, "atf/atf.json", `{ "contract": ${CONTRACT_VERSION + 1} }\n`);
  let c = await check();
  assert.deepEqual([c.ok, c.level], [false, "fail"]);
  assert.match(c.detail, /^atf\/atf\.json records artifact contract 3, newer than this framework's 2: a newer @testagentic\/atf migrated this workspace/);
  assert.match(c.fix, /^install that newer @testagentic\/atf in the workspace/);
  assert.equal(c.autofix, undefined, "never autofixed");
  put(m.root, "atf/atf.json", '{ "contract": 1 }\n');
  c = await check();
  assert.match(c.detail, /^atf\/atf\.json records artifact contract 1, older than this framework's 2: its artifacts must be migrated first$/);
  assert.equal(c.fix, "npx atf migrate (in the workspace): it migrates the artifacts and records contract 2");
  assert.equal(failures(await runChecks(cfg(), ["base"], m.opts)).length, 1, "it blocks every stage, as base does");
  put(m.root, "atf/atf.json", '{ "contract": "2" }\n');
  assert.match((await check()).detail, /^atf\/atf\.json "contract" must be a whole number of 1 or more \(the artifact-contract version\), not "2"$/);
});

test("browser: the MCP server's channel must be installed, and it must run the framework's init page instead of a --storage-state (D-076)", async () => {
  const m = machine();
  const auth = { authenticated_crawl: true, session_state_file: "playwright-tests/acme/.auth/state.json" };
  put(m.root, "config/mcp.yaml", mcpYaml(["--isolated", "--storage-state", "playwright-tests/ami/.auth/state.json"]));
  let checks = await runChecks(cfg(auth), ["browser"], { ...m.opts, exists: () => false });
  assert.deepEqual(ids(checks), { "mcp-browser": "fail", "mcp-session": "fail" });
  assert.match(checks[0].detail, /launches chrome, which is not installed/);
  assert.match(checks[1].detail, /does not run the framework's init page \(--init-page scripts\/browser\/init-page\.cjs\)/);
  assert.match(checks[1].fix, /add "--init-page", "scripts\/browser\/init-page\.cjs" to the browser server's args in config\/mcp\.yaml, then run npm run build-agents/);

  put(m.root, "config/mcp.yaml", mcpYaml(["--isolated", "--init-page", "scripts/browser/init-page.cjs", "--storage-state", "playwright-tests/ami/.auth/state.json"]));
  checks = await runChecks(cfg(auth), ["browser"], m.opts);
  assert.equal(ids(checks)["mcp-session"], "fail", "a --storage-state would load one product's session for every product");
  assert.match(checks[1].fix, /remove --storage-state/);

  put(m.root, "config/mcp.yaml", mcpYaml(["--isolated", "--init-page", "scripts/browser/init-page.cjs"]));
  checks = await runChecks(cfg(auth), ["browser"], m.opts);
  assert.deepEqual(ids(checks), { "mcp-browser": "ok", "mcp-session": "ok" });
  assert.match(checks[1].detail, /the init page loads playwright-tests\/acme\/\.auth\/state\.json into every new browser/);
  checks = await runChecks(cfg(), ["browser"], m.opts);
  assert.match(checks.find((c) => c.id === "mcp-session").detail, /no login: the browser server starts logged out/);
});

test("browser: the fix names the file this workspace edits and how it re-renders: config/mcp.yaml and npm run build-agents in a source checkout; atf/mcp.yaml or the ejected atf/config/mcp.yaml and npx atf sync when installed", async () => {
  const m = machine();
  const browserChecks = async (framework) => {
    const at = (checks, id) => checks.find((c) => c.id === id);
    put(framework, "config/mcp.yaml", "servers: {}\n");
    const none = at(await runChecks(cfg(), ["browser"], { ...m.opts, framework }), "mcp-browser");
    put(framework, "config/mcp.yaml", mcpYaml(["--isolated"]));
    const session = at(await runChecks(cfg(), ["browser"], { ...m.opts, framework }), "mcp-session");
    return { fixes: [none.fix, session.fix], detail: none.detail };
  };
  // a source checkout (the framework root is the repo): its own config/mcp.yaml and build script, word for word as before
  const source = await browserChecks(m.root);
  assert.deepEqual(source.fixes, [
    "define the browser server in config/mcp.yaml, then npm run build-agents",
    `add "--init-page", "scripts/browser/init-page.cjs" to the browser server's args in config/mcp.yaml, then run npm run build-agents and restart the agent session`,
  ]);
  assert.equal(source.detail, "config/mcp.yaml names no browser_server");
  // installed in a client's workspace (node_modules): the package's config/mcp.yaml is not the client's to edit, and
  // there is no build-agents script. The overlay atf/mcp.yaml (D-088), with the init page by its {fw} path
  const installed = path.join(m.root, "node_modules", "@testagentic", "atf");
  const overlay = "atf/mcp.yaml (an overlay of the package's config/mcp.yaml: a list such as args replaces the package's whole list)";
  const got = await browserChecks(installed);
  assert.deepEqual(got.fixes, [
    `define the browser server in ${overlay}, then npx atf sync (in the workspace)`,
    `add "--init-page", "{fw}/scripts/browser/init-page.cjs" to the browser server's args in ${overlay}, then run npx atf sync (in the workspace) and restart the agent session`,
  ]);
  assert.equal(got.detail, "the effective mcp.yaml (node_modules/@testagentic/atf/config/mcp.yaml) names no browser_server");
  assert.ok(got.fixes.every((f) => !f.includes("build-agents") && !f.includes(" config/mcp.yaml,")));
  // an overlay already there: still the overlay, and the detail names both files
  put(m.root, "atf/mcp.yaml", "browser_server: nothing\n");
  const none = (await runChecks(cfg(), ["browser"], { ...m.opts, framework: installed })).find((c) => c.id === "mcp-browser");
  assert.equal(none.fix, `define the browser server in ${overlay}, then npx atf sync (in the workspace)`);
  assert.equal(none.detail, "the effective mcp.yaml (node_modules/@testagentic/atf/config/mcp.yaml + atf/mcp.yaml) names no browser_server");
  // ejected: the overlay is ignored, so the fix names the ejected copy
  put(m.root, "atf/config/mcp.yaml", mcpYaml(["--isolated"]));
  const checks = await runChecks(cfg(), ["browser"], { ...m.opts, framework: installed });
  assert.equal(checks.find((c) => c.id === "mcp-session").fix, `add "--init-page", "{fw}/scripts/browser/init-page.cjs" to the browser server's args in atf/config/mcp.yaml (your ejected copy), then run npx atf sync (in the workspace) and restart the agent session`);
});

test("browser: a bundled-chromium MCP server is checked against the build its cached Playwright needs", async () => {
  const m = machine();
  const env = { ...m.env, npm_config_cache: path.join(m.root, "npm") };
  put(m.root, "config/mcp.yaml", mcpYaml(["--browser", "chromium"]));
  let checks = await runChecks(cfg(), ["browser"], { ...m.opts, env });
  assert.equal(ids(checks)["mcp-browser"], "warn"); // never run yet: unknown build
  put(m.root, "npm/_npx/abc/node_modules/@playwright/mcp/package.json", JSON.stringify({ version: "0.0.83" }));
  put(m.root, "npm/_npx/abc/node_modules/playwright-core/browsers.json", BROWSERS("1247"));
  put(m.root, "npm/_npx/abc/node_modules/playwright-core/package.json", JSON.stringify({ version: "1.64.0" }));
  checks = await runChecks(cfg(), ["browser"], { ...m.opts, env });
  assert.equal(ids(checks)["mcp-browser"], "fail");
  assert.deepEqual(checks[0].autofix.args, ["-y", "playwright@1.64.0", "install", "chromium"]);
  m.installed("chromium", "1247");
  checks = await runChecks(cfg(), ["browser"], { ...m.opts, env });
  assert.equal(ids(checks)["mcp-browser"], "ok");
});

test("session: present is enough (no target cookie only warns, for single sign-on); missing, empty or expired fails; soon-expiring warns; missing credential files", async () => {
  const m = machine();
  const auth = { authenticated_crawl: true, session_state_file: "s.json" };
  const save = (cookies) => put(m.root, "s.json", JSON.stringify({ cookies, origins: [] }));
  const at = (h) => NOW / 1000 + h * 3600;
  assert.equal(ids(await runChecks(cfg(auth), ["session"], m.opts)).session, "fail");
  save([]);
  assert.match((await runChecks(cfg(auth), ["session"], m.opts))[0].detail, /s\.json is empty \(no cookie, no local storage\)/);
  put(m.root, "s.json", JSON.stringify({ cookies: [], origins: [{ origin: "https://app.acme.test", localStorage: [{ name: "msal.token", value: "x" }] }] }));
  assert.equal(ids(await runChecks(cfg(auth), ["session"], m.opts)).session, "warn", "a token in local storage only (single sign-on)");
  save([{ name: "ESTSAUTH", domain: ".login.microsoftonline.com", expires: at(100) }]);
  let check = (await runChecks(cfg(auth), ["session"], m.opts))[0];
  assert.deepEqual([check.ok, check.level], [true, "warn"], "no cookie on the target's host passes with a warning");
  assert.match(check.detail, /^nothing to fix: the saved session has no cookie for app\.acme\.test \(usual after a single sign-on login\); the login is confirmed when a stage opens the target/);
  assert.match(check.fix, /if a stage meets a sign-in page, npx atf login acme/);
  save([{ name: "ESTSAUTH", domain: ".login.microsoftonline.com", expires: at(-1) }]);
  assert.match((await runChecks(cfg(auth), ["session"], m.opts))[0].detail, /every cookie in the saved session has expired/);
  save([{ name: "sid", domain: ".acme.test", expires: at(-1) }, { name: "ESTSAUTH", domain: ".login.microsoftonline.com", expires: at(100) }]);
  check = (await runChecks(cfg(auth), ["session"], m.opts))[0];
  assert.equal(check.ok, false, "every target cookie expired still fails, whatever else lives");
  assert.match(check.detail, /every cookie for app\.acme\.test in the saved session has expired/);
  save([{ name: "sid", domain: "app.acme.test", expires: at(2) }]);
  assert.equal(ids(await runChecks(cfg(auth), ["session"], m.opts)).session, "warn");
  save([{ name: "sid", domain: "app.acme.test", expires: -1 }, { name: "x", domain: ".acme.test", expires: at(200) }]);
  assert.equal(ids(await runChecks(cfg(auth), ["session"], m.opts)).session, "ok");
  const checks = await runChecks(cfg({ ...auth, credentials_file: "playwright-tests/acme/.env" }), ["session"], m.opts);
  assert.equal(ids(checks).credentials, "fail");
  assert.match(checks[1].detail, /playwright-tests\/acme\/\.env/);
});

test("repo: not rendered, not installed, browsers missing, ready; the fix is foundation.mjs install", async () => {
  const m = machine();
  const run = async () => (await runChecks(cfg(), ["repo"], m.opts))[0];
  assert.deepEqual([(await run()).ok, (await run()).pending], [true, true]); // the run builds it
  assert.match((await run()).detail, /not built yet/);
  put(m.root, "playwright-tests/acme/package.json", "{}");
  const c = await run();
  assert.match(c.detail, /no node_modules/);
  assert.match(c.fix, new RegExp(String.raw`node ${FW}scripts\/foundation\.mjs install acme`));
  assert.deepEqual(c.autofix.steps.map((s) => s.args[0]), ["install", "playwright"]);
  put(m.root, "playwright-tests/acme/node_modules/@playwright/test/package.json", "{}");
  m.core("playwright-tests/acme", "1250", "1.65.0");
  assert.match((await run()).detail, /Playwright 1\.65\.0, which needs chromium build 1250 and chromium-headless-shell build 1250/);
  m.installed("chromium", "1250");
  m.installed("chromium-headless-shell", "1250");
  assert.equal((await run()).ok, true);
});

test("k6: installed through the OS's package manager where it has one; installed-but-not-on-PATH says to open a new terminal", async () => {
  const m = machine();
  const k6 = async (platform, which, exists = () => false) => (await runChecks(cfg(), ["k6"], { ...m.opts, env: { ProgramFiles: "C:\\Program Files" }, platform, which, exists }))[0];
  const has = (...cmds) => (cmd) => cmds.includes(cmd);

  let c = await k6("win32", has("winget"));
  assert.deepEqual([c.ok, c.autofix.cmd, c.autofix.args.slice(0, 4)], [false, "winget", ["install", "k6", "--source", "winget"]]);
  assert.ok(c.autofix.args.includes("--accept-package-agreements")); // no prompt in make's terminal
  c = await k6("darwin", has("brew"));
  assert.deepEqual([c.autofix.cmd, c.autofix.args], ["brew", ["install", "k6"]]);
  c = await k6("darwin", has());
  assert.equal(c.autofix, undefined);
  assert.match(c.fix, /install brew, then brew install k6/);
  c = await k6("linux", has("apt-get"));
  assert.equal(c.autofix, undefined);
  assert.match(c.fix, /grafana\.com\/docs\/k6/);

  c = await k6("win32", has("winget"), (p) => p === path.join("C:\\Program Files", "k6", "k6.exe"));
  assert.match(c.detail, /installed .* but not on this terminal's PATH/);
  assert.equal(c.autofix, undefined); // no reinstall
  assert.equal((await k6("win32", has("k6"))).ok, true);
});

test("k6 and target: a missing binary and an unreachable host fail; any HTTP answer is reachable", async () => {
  const m = machine();
  const down = async () => { throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }); };
  const checks = await runChecks(cfg({}, { target: { url: "https://app.acme.test", api_urls: ["https://api.acme.test"] } }), ["k6", "target"], { ...m.opts, which: () => false, fetchImpl: down });
  assert.deepEqual(ids(checks), { k6: "fail", "target:https://app.acme.test": "fail", "target:https://api.acme.test": "fail" });
  assert.match(checks[1].detail, /ENOTFOUND/);
  assert.equal(ids(await runChecks(cfg(), ["target"], { ...m.opts, fetchImpl: async () => ({ status: 302 }) }))["target:https://app.acme.test"], "ok");
});

test("doctorStatus: no record, groups not covered, and only the stages a failure touches are blocked", () => {
  const root = tempRoot();
  assert.match(doctorStatus("acme", "explore", root).reason, /has not run in this session/);
  recordDoctor("acme", root, { groups: ["base"], checks: [] });
  assert.match(doctorStatus("acme", "explore", root).reason, /did not cover browser, session, target/);
  recordDoctor("acme", root, { groups: GROUPS, checks: [{ group: "browser", id: "mcp-browser", ok: false, level: "fail", detail: "chrome is not installed", fix: "install Google Chrome" }, { group: "session", id: "session", ok: true, level: "warn", detail: "expires soon" }] });
  assert.equal(doctorStatus("acme", "knowledge", root).ready, true);
  assert.equal(doctorStatus("acme", "playwright-ui", root).ready, true); // a warning never blocks
  const r = doctorStatus("acme", "explore", root);
  assert.equal(r.ready, false);
  assert.match(r.reason, /chrome is not installed -> fix: install Google Chrome/);
});

test("run: stage start needs this session's dependency record; run.mjs doctor records it and init --resume clears it", async () => {
  const { root, product } = startRun({ doctored: false });
  const start = await setStage(product, "knowledge", null, "start", undefined, { root });
  assert.match(start.errors[0], /dependencies not ready: .*run\.mjs doctor acme/);
  put(root, "config/mcp.yaml", mcpYaml(["--init-page", "scripts/browser/init-page.cjs"]));

  const r = await doctor(product, { root, framework: root, env: { PLAYWRIGHT_BROWSERS_PATH: path.join(root, "b") }, platform: "linux", home: root, which: () => false, exists: () => true, fetchImpl: async () => ({ status: 200 }) });
  assert.ok(r.checks.length);
  assert.ok(r.checks.every((c) => !("autofix" in c)));
  assert.deepEqual(r.blockedStages, ["k6"]); // no k6; the product repo is not built yet, which the run itself does
  assert.ok(!r.checks.some((c) => c.group === "login"), "the run never checks the login browser");
  assert.ok(!(await setStage(product, "knowledge", null, "start", undefined, { root })).errors);
  assert.equal(doctorStatus(product, "playwright-ui", root).ready, true);
  put(root, "playwright-tests/acme/package.json", "{}"); // the playwright-repo stage built it: the record is stale for the repo
  assert.match(doctorStatus(product, "playwright-ui", root).reason, /built after the last dependency check/);
  assert.equal(doctorStatus(product, "explore", root).ready, true);

  initRun(path.join(root, "config", "acme.yaml"), { resume: true, root });
  assert.match(doctorStatus(product, "knowledge", root).reason, /has not run in this session/);
});

test("doctor.mjs: scope, --fix runs each distinct install once then checks again, exit codes, --warn-only", async () => {
  assert.deepEqual(scope({ for: "login" }).groups, ["base", "login"]);
  assert.deepEqual(scope({ stage: "k6" }).groups, ["base", "k6", "target"]);
  assert.match(scope({ stage: "nope" }).error, /unknown stage/);
  const step = { cmd: "npx", args: ["playwright", "install", "chromium"], cwd: "/r" };
  const bad = [{ group: "login", id: "a", ok: false, level: "fail", detail: "x", autofix: step }, { group: "repo", id: "b", ok: false, level: "fail", detail: "y", autofix: { steps: [step, { cmd: "npm", args: ["install"], cwd: "/p" }] } }];
  assert.equal(autofixSteps(bad).length, 2);
  assert.equal(failures(bad, ["repo"]).length, 1);

  const root = tempRoot();
  put(root, "config/acme.yaml", "product: acme\ntarget: {url: 'https://app.acme.test'}\nmodules:\n  - {slug: contacts, name: Contacts, nav_path: [Contacts]}\n");
  const file = path.join(root, "config", "acme.yaml");
  const lines = [];
  const log = (s) => lines.push(s);
  let calls = 0;
  const ran = [];
  const check = async () => (calls++ ? [] : bad);
  assert.equal(await main([file, "--for", "login", "--fix"], { root, log, check, exec: (s) => ran.push(s.cmd) }), 0);
  assert.deepEqual(ran, ["npx", "npm"]);
  assert.equal(calls, 2);
  assert.match(lines.at(-1), /All set\./);

  lines.length = 0;
  assert.equal(await main([file, "--stage", "playwright-ui,k6"], { root, log, check: async () => bad }), 1);
  assert.match(lines.at(-1), /Blocked until fixed: playwright-ui\./);
  assert.equal(await main([file, "--warn-only"], { root, log, check: async () => bad }), 0);
  assert.equal(await main([], { root, log }), 2);
});

test("doctor.mjs --machine: no run-config, the machine groups, a missing k6 only warns and is never installed (D-110)", async () => {
  assert.deepEqual(MACHINE_GROUPS, ["base", "login", "browser", "k6"]);
  assert.deepEqual(scope({ machine: true }), { label: "this machine", groups: MACHINE_GROUPS, stages: [], machine: true });
  assert.match(scope({ machine: true, stage: "k6" }).error, /--machine takes no/);
  const k6Step = { cmd: "brew", args: ["install", "k6"], cwd: "/r" };
  const pwStep = { cmd: "npx", args: ["playwright", "install", "chromium"], cwd: "/r" };
  const bad = [
    { group: "browser", id: "mcp-browser", ok: false, level: "fail", detail: "chromium missing", autofix: pwStep },
    { group: "k6", id: "k6", ok: false, level: "fail", detail: "k6 is not installed", fix: "brew install k6", autofix: k6Step },
  ];
  const m = machineChecks(bad);
  assert.deepEqual(m[1], { group: "k6", id: "k6", ok: true, level: "warn", detail: "k6 is not installed (needed only for k6 load tests)", fix: "brew install k6" });
  assert.deepEqual(autofixSteps(m), [pwStep]);

  const root = tempRoot();
  const lines = [];
  const ran = [];
  const seen = [];
  let calls = 0;
  const check = async (cfg, groups) => (seen.push([cfg.product, groups]), calls++ ? [bad[1]] : bad);
  assert.equal(await main(["--machine", "--fix", "--json"], { root, log: (s) => lines.push(s), check, exec: (s) => ran.push(s.cmd) }), 0, "a missing k6 alone does not fail a machine check");
  assert.deepEqual(ran, ["npx"]);
  assert.deepEqual(seen, [[null, MACHINE_GROUPS], [null, MACHINE_GROUPS]]);
  const json = JSON.parse(lines.at(-1));
  assert.equal(json.scope, "this machine");
  assert.deepEqual(json.checks.map((c) => [c.id, c.ok, c.level]), [["k6", true, "warn"]]);
  lines.length = 0;
  await main(["--machine", "--json"], { root, log: (s) => lines.push(s), check: async () => bad });
  assert.deepEqual(JSON.parse(lines.at(-1)).checks.map((c) => [c.id, c.fixable]), [["mcp-browser", true], ["k6", undefined]], "--json says which checks --fix would install for");
  assert.equal(await main(["--machine"], { root, log: () => {}, check: async () => bad }), 1);
  assert.equal(await main(["--machine", path.join(root, "x.yaml")], { root, log: () => {} }), 2, "a run-config and --machine together");
});

test("a stage not chosen for the run is never reported as blocked: run.mjs doctor and doctor.mjs check only the chosen stages", async () => {
  assert.deepEqual(STAGE_NEEDS["api-discovery"], ["base", "session", "target"], "the catalogue's guarded GET probes");
  const { root, product } = startRun({ doctored: false, extra: ["steps: [explore, testcases]"] });
  put(root, "config/mcp.yaml", mcpYaml(["--init-page", "scripts/browser/init-page.cjs"]));
  const r = await doctor(product, { root, framework: root, env: { PLAYWRIGHT_BROWSERS_PATH: path.join(root, "b") }, platform: "linux", home: root, which: () => false, exists: () => true, fetchImpl: async () => ({ status: 200 }) });
  assert.ok(r.checks.some((c) => c.group === "k6" && !c.ok), "k6 is missing on this machine");
  assert.deepEqual(r.blockedStages, [], "but k6 is not chosen, so nothing is blocked");

  const cfg = { steps: ["explore", "testcases"], testcases: {} };
  assert.deepEqual(scope({}, cfg).stages, ["knowledge", "module-knowledge", "explore", "testcases", "report"]);
  assert.deepEqual(scope({}, cfg).groups, ["base", "browser", "session", "target"], "no repo, no k6");
  assert.deepEqual(scope({}, { ...cfg, testcases: { types: ["api"] } }).stages, ["knowledge", "module-knowledge", "explore", "api-discovery", "testcases", "report"]);
  assert.equal(scope({ stage: "k6" }, cfg).stages[0], "k6", "an explicit --stage is checked as asked");
  let groups;
  const file = path.join(root, "config", "acme.yaml");
  assert.equal(await main([file], { root, log: () => {}, check: async (_cfg, g) => ((groups = g), []) }), 0);
  assert.deepEqual(groups, ["base", "browser", "session", "target"], "doctor.mjs on the run-config checks only what its steps need");
});

test("base, cloud-agent opt-in: the setup workflow must install the framework with ATF_NPM_TOKEN (fail), and git must not ignore what the agent reads (warn)", async (t) => {
  const ws = installedWorkspace();
  // git with no system or global config of the machine's (a global excludesFile would change the answer)
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(ws.root, ".no-gitconfig"), XDG_CONFIG_HOME: path.join(ws.root, ".no-xdg") };
  const base = async (opts = {}) => Object.fromEntries((await runChecks({ product: "acme" }, ["base"], { root: ws.root, framework: ws.framework, env, ...opts })).map((c) => [c.id, c]));
  const file = path.join(ws.root, SETUP_WORKFLOW);
  // no opt-in: neither check
  sync({ workspace: ws.root, framework: ws.framework });
  let c = await base();
  assert.equal(c["host-files"].ok, true);
  assert.equal(c["cloud-agent-setup"], undefined);
  assert.equal(c["cloud-agent-git"], undefined);
  // opted in, not synced yet: the workflow is missing, with the template it comes from
  put(ws.root, "atf/atf.json", '{ "cloud_agent": true }\n');
  c = await base();
  assert.deepEqual({ ok: c["cloud-agent-setup"].ok, level: c["cloud-agent-setup"].level, group: c["cloud-agent-setup"].group }, { ok: false, level: "fail", group: "base" });
  assert.equal(c["cloud-agent-setup"].detail, `${SETUP_WORKFLOW} is missing: the Copilot cloud agent would start without the framework installed, and its guard would deny every tool call`);
  assert.equal(c["cloud-agent-setup"].fix, `npx atf sync (in the workspace) creates it from ${INSTALLED_PACKAGE}/templates/workspace/copilot-setup-steps.yml; commit it and merge it to the default branch`);
  assert.match(c["host-files"].detail, /^1 host file\(s\) out of date with the installed framework: \.gitignore$/, "the workflow is reported once, by its own check");
  // synced: it passes
  sync({ workspace: ws.root, framework: ws.framework });
  c = await base();
  assert.deepEqual([c["host-files"].ok, c["cloud-agent-setup"].ok, c["cloud-agent-setup"].level], [true, true, undefined]);
  assert.equal(c["cloud-agent-setup"].detail, `${SETUP_WORKFLOW} installs the framework for the Copilot cloud agent`);
  // a workflow that installs nothing: a failure naming what to add, and nothing rewritten
  const broken = "jobs:\n  copilot-setup-steps:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n";
  writeFileSync(file, broken);
  c = await base();
  assert.equal(c["cloud-agent-setup"].ok, false);
  assert.match(c["cloud-agent-setup"].detail, /has no step in its copilot-setup-steps job that runs npm ci \(or npm install\): without the framework installed/);
  assert.match(c["cloud-agent-setup"].fix, /runs npm ci with `env: \{ ATF_NPM_TOKEN: \$\{\{ secrets\.ATF_NPM_TOKEN \}\} \}`.*templates\/workspace\/copilot-setup-steps\.yml does; atf never rewrites this file$/);
  assert.equal(failures(Object.values(c)).map((x) => x.id).join(), "cloud-agent-setup");
  assert.equal(readFileSync(file, "utf8"), broken);
  rmSync(file);
  sync({ workspace: ws.root, framework: ws.framework });

  // git: not a repository yet, or no git at all: skipped, never a problem
  c = await base();
  assert.deepEqual([c["cloud-agent-git"].ok, c["cloud-agent-git"].level], [true, undefined]);
  assert.match(c["cloud-agent-git"].detail, /^not checked whether git ignores the files the Copilot cloud agent reads: (not a git repository|git is not available)$/);
  assert.equal((await base({ env: { PATH: "" } }))["cloud-agent-git"].detail, "not checked whether git ignores the files the Copilot cloud agent reads: git is not available");
  const init = spawnSync("git", ["init", "-q"], { cwd: ws.root, env, encoding: "utf8" });
  if (init.error || init.status !== 0) return t.skip(`git is not available: ${init.error?.message ?? init.stderr}`);
  c = await base();
  assert.match(c["cloud-agent-git"].detail, /^git commits the \d+ files the Copilot cloud agent reads$/);
  assert.equal(c["cloud-agent-git"].level, undefined);
  // the client's own line hides them: a warning naming the line, never a failure
  const own = readFileSync(path.join(ws.root, ".gitignore"), "utf8");
  writeFileSync(path.join(ws.root, ".gitignore"), `.github/\n${own}`);
  c = await base();
  assert.deepEqual([c["cloud-agent-git"].ok, c["cloud-agent-git"].level], [true, "warn"]);
  assert.match(c["cloud-agent-git"].detail, /^\d+ of the files the Copilot cloud agent reads are git-ignored \(\.gitignore:1 \(\.github\/\)\), so they never reach it: \.github\/agents\/\S+\.agent\.md, .* and \d+ more$/);
  assert.match(c["cloud-agent-git"].fix, /remove or narrow those ignore lines/);
  assert.equal(failures(Object.values(c)).length, 0, "a warning only");
  // a narrower line that a later `!` line re-includes: not ignored
  writeFileSync(path.join(ws.root, ".gitignore"), `*.yml\n!/.github/workflows/*.yml\n${own}`);
  assert.equal((await base())["cloud-agent-git"].level, undefined);
});

test("doctor.mjs --preflight: each safe install is one progress line, the login is offered for a failed session, leftovers are shown once, exit 0, nothing in a sandbox or without a terminal (friction W2)", async () => {
  const root = tempRoot();
  put(root, "config/acme.yaml", "product: acme\ntarget: {url: 'https://app.acme.test'}\nmodules:\n  - {slug: contacts, name: Contacts, nav_path: [Contacts]}\n");
  const file = path.join(root, "config", "acme.yaml");
  const pw = path.join(root, "playwright-tests", "acme");
  const repoStep = { cmd: "npm", args: ["install"], cwd: pw };
  const mcpStep = { cmd: "npx", args: ["-y", "playwright@1.64.0", "install", "chromium"], cwd: root };
  const bad = [
    { group: "repo", id: "repo", ok: false, level: "fail", detail: "repo not installed", fix: "npm install", autofix: { steps: [repoStep] } },
    { group: "browser", id: "mcp-browser", ok: false, level: "fail", detail: "chromium missing", fix: "npx -y playwright install chromium", autofix: mcpStep },
    { group: "login", id: "session", ok: false, level: "fail", detail: "the saved session is missing", fix: "atf login acme" },
  ];
  const setup = (over = {}) => {
    const out = [];
    const ran = [];
    const asked = [];
    let logged = 0;
    let calls = 0;
    const o = {
      root, env: {}, interactive: true,
      log: (s) => out.push(`${s}\n`), write: (s) => out.push(s),
      check: async () => (calls++ ? bad.filter((c) => c.id === "session" && !logged) : bad),
      exec: (s) => (ran.push(s), s.cmd === "npm" ? true : { ok: false, detail: "ENOTFOUND registry" }),
      ask: async (q) => (asked.push(q), ""),
      login: () => (logged++, true),
      ...over,
    };
    return { o, text: () => out.join(""), ran, asked, logged: () => logged };
  };

  let t = setup();
  assert.equal(await main([file, "--preflight"], t.o), 0);
  assert.equal(t.ran.length, 2);
  assert.match(t.text(), /^Installing the Playwright repo for acme… done\n/);
  assert.match(t.text(), /Installing the browser server's Chromium… failed: ENOTFOUND registry\n/);
  assert.deepEqual(t.asked, ["Open the login window now? [Y/n] "]);
  assert.equal(t.logged(), 1);
  assert.match(t.text(), /Login finished\./);
  assert.match(t.text(), /Preflight: everything the chosen stages need is ready\./, "the recheck after the login");

  // a declined login, and a failure that stays: one line each, with its fix, once
  t = setup({ ask: async () => "n" });
  assert.equal(await main([file, "--preflight"], t.o), 0);
  assert.equal(t.logged(), 0);
  assert.equal(t.text().split("the saved session is missing -- fix: atf login acme").length, 2);

  // no terminal: no prompt, no login
  t = setup({ interactive: false });
  assert.equal(await main([file, "--preflight"], t.o), 0);
  assert.deepEqual([t.asked.length, t.logged()], [0, 0]);
  assert.match(t.text(), /still not ready/);

  // a sandbox: nothing installed, nothing asked, the problems reported
  t = setup({ env: { SANDBOX_RUNTIME: "1" } });
  assert.equal(await main([file, "--preflight"], t.o), 0);
  assert.deepEqual([t.ran.length, t.asked.length], [0, 0]);
  assert.match(t.text(), /Inside a sandbox: nothing is installed/);
  assert.match(t.text(), /repo not installed -- fix: npm install/);

  assert.equal(await main([file, "--preflight", "--json"], setup().o), 2);
});
