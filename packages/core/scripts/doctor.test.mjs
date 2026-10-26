import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { GROUPS, STAGE_NEEDS, browserBuilds, browsersDir, doctorStatus, failures, groupsFor, recordDoctor, runChecks, uncoveredStages } from "./lib/doctor.mjs";
import { autofixSteps, main, scope } from "./doctor.mjs";
import { doctor, initRun, setStage } from "./run.mjs";
import { put, startRun, tempRoot } from "./test-helpers.mjs";
import { expandFw } from "./lib/roots.mjs";

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
  assert.deepEqual(ids(checks), { node: "fail", "framework-deps": "fail", "login-browser": "fail" });
  assert.match(checks.find((c) => c.id === "framework-deps").detail, /playwright is 1\.63\.0, package\.json pins 1\.64\.1/);
  assert.deepEqual(checks.find((c) => c.id === "login-browser").autofix, { cmd: "npx", args: ["playwright", "install", "chromium"], cwd: m.root });
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.64.1" }));
  m.installed("chromium", "1248");
  checks = await runChecks(cfg(), ["base", "login"], noBranded);
  assert.deepEqual(ids(checks), { node: "ok", "framework-deps": "ok", "login-browser": "warn" });
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
  assert.deepEqual(ids(checks), { node: "ok", "framework-deps": "ok", "framework-peers": "fail", "login-browser": "fail" });
  const peers = checks.find((c) => c.id === "framework-peers");
  assert.match(peers.detail, /playwright is not installed/);
  assert.deepEqual(peers.autofix, { cmd: "npm", args: ["install"], cwd: m.root }, "the workspace lists it: npm install there");
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.63.0" }));
  assert.match((await runChecks(cfg(), ["base"], opts)).find((c) => c.id === "framework-peers").detail, /playwright is 1\.63\.0, package\.json pins 1\.64\.1/);
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.64.1" }));
  m.installed("chromium", "1248");
  checks = await runChecks(cfg(), ["base", "login"], opts);
  assert.deepEqual(ids(checks), { node: "ok", "framework-deps": "ok", "framework-peers": "ok", "login-browser": "warn" }, "the hoisted playwright-core's Chromium too");
  // a workspace that does not list the peer is told what to add, never changed by --fix
  put(m.root, "package.json", JSON.stringify({ workspaces: ["packages/*"] }));
  put(m.root, "node_modules/playwright/package.json", JSON.stringify({ version: "1.63.0" }));
  const unlisted = (await runChecks(cfg(), ["base"], opts)).find((c) => c.id === "framework-peers");
  assert.equal(unlisted.fix, "npm install --save-dev playwright@1.64.1 (in the workspace)");
  assert.equal(unlisted.autofix, undefined);
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
  assert.match(check.detail, /no cookie for app\.acme\.test \(usual after a single sign-on login\): the login is confirmed when a stage opens the target/);
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
