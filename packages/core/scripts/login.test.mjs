import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setLoginKeys } from "./lib/login.mjs";
import { chromiumFromId, defaultBrowserId, loginBrowser, parseMacHandlers } from "./lib/doctor.mjs";
import { login } from "./run.mjs";
import { put, tempRoot } from "./test-helpers.mjs";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const at = (h) => NOW / 1000 + h * 3600;
const EDGE = "/opt/microsoft/msedge/msedge";
const CONFIG = [
  "product: acme",
  "target: {url: 'https://app.acme.test'}",
  "modules:",
  "  - {slug: contacts, name: Contacts, entry_url: 'https://app.acme.test/contacts'}",
  "authorizations:",
  "  mode: readonly",
  "  authenticated_crawl: false    # true = browser agents start from session_state_file below",
  "  credentials_file: null",
  "  session_state_file: null      # e.g. playwright-tests/<product>/.auth/state.json",
  "",
].join("\n");

// A stand-in for Playwright's persistent context: storageState() returns `state` until the window is closed.
// `state` may be a function of the snapshot number (1 is the baseline taken before the page opens); `landing` is the
// URL the page is at after the first navigation, and setUrl moves it (the human navigating).
function fakeBrowser(state, landing = "https://app.acme.test/") {
  const calls = { launched: null, goto: [], snapshots: 0 };
  let onClose = () => {};
  let closed = false;
  let url = "about:blank";
  const shut = () => {
    if (!closed) (closed = true), onClose();
  };
  const page = { goto: async (u) => (calls.goto.push(u), (url = landing)), url: () => url };
  const ctx = {
    on: (ev, fn) => ev === "close" && (onClose = fn),
    pages: () => [page],
    newPage: async () => page,
    storageState: async () => {
      if (closed) throw new Error("Target page, context or browser has been closed");
      calls.snapshots++;
      return typeof state === "function" ? state(calls.snapshots) : state;
    },
    close: async () => shut(),
  };
  return { calls, shut, setUrl: (u) => (url = u), launch: async (dir, browser) => ((calls.launched = { dir, ...browser }), ctx) };
}

function setup(text = CONFIG) {
  const root = tempRoot();
  const file = path.join(root, "config", "acme.yaml");
  put(root, "config/acme.yaml", text);
  const opts = { root, sys: { env: {}, platform: "linux" }, exists: (p) => p === EDGE, now: () => NOW, wait: async () => {}, log: () => {} };
  return { root, file, opts };
}

test("setLoginKeys rewrites only the two values, keeping indentation and comments; a key the config lacks is reported", () => {
  const r = setLoginKeys(CONFIG, "playwright-tests/acme/.auth/state.json");
  assert.equal(r.changed, true);
  assert.match(r.text, /^  authenticated_crawl: true    # true = browser agents/m);
  assert.match(r.text, /^  session_state_file: playwright-tests\/acme\/\.auth\/state\.json      # e\.g\./m);
  assert.match(r.text, /^  credentials_file: null$/m);
  assert.equal(setLoginKeys(r.text, "playwright-tests/acme/.auth/state.json").changed, false, "a second login changes nothing");
  assert.match(setLoginKeys("authorizations:\n  authenticated_crawl:   # x\n  session_state_file:\n", "s.json").text, /^  authenticated_crawl:   true # x$/m, "an empty value keeps a space before its comment");
  assert.deepEqual(setLoginKeys("authorizations: {mode: readonly}\n", "s.json").missing, ["authenticated_crawl", "session_state_file"]);
});

test("login: opens Edge on the target with the product's profile, saves the session and sets it in the config", async () => {
  const { root, file, opts } = setup();
  const state = { cookies: [{ name: "sid", domain: ".acme.test", expires: at(100) }], origins: [] };
  const b = fakeBrowser(state);
  const r = await login(file, { ...opts, launch: b.launch, seconds: 10 });
  assert.ok(!r.errors, JSON.stringify(r));
  assert.equal(b.calls.launched.channel, "msedge");
  assert.equal(path.relative(root, b.calls.launched.dir).replaceAll("\\", "/"), "playwright-tests/acme/.auth/browser-profile", "git-ignored, next to the session");
  assert.deepEqual(b.calls.goto, ["https://app.acme.test"], "one navigation, to the target");
  assert.equal(b.calls.snapshots, 7, "a baseline, a snapshot every 2 seconds of the 10, and one before closing");
  assert.equal(r.closedBy, "timeout", "no cookie changed: the window waited the whole ceiling");
  assert.equal(r.saved, "playwright-tests/acme/.auth/state.json");
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, r.saved), "utf8")), state);
  assert.equal(r.configUpdated, true);
  assert.match(readFileSync(file, "utf8"), /^  authenticated_crawl: true/m);
  assert.equal(r.session.ok, true);
  assert.ok(!r.session.warn, r.session.detail);
  assert.equal(r.closedEarly, false);
});

test("login: a single sign-on session without a target cookie is saved with a warning, not refused", async () => {
  const { file, opts } = setup();
  const b = fakeBrowser({ cookies: [{ name: "ESTSAUTH", domain: ".login.microsoftonline.com", expires: -1 }], origins: [] });
  const r = await login(file, { ...opts, launch: b.launch });
  assert.ok(!r.errors, JSON.stringify(r));
  assert.equal(r.session.warn, true);
  assert.match(r.session.detail, /no cookie for app\.acme\.test \(usual after a single sign-on login\)/);
});

test("login: a window closed early keeps the last session seen; closed before any snapshot, nothing is saved", async () => {
  const { root, file, opts } = setup();
  const state = { cookies: [{ name: "sid", domain: "app.acme.test", expires: at(100) }], origins: [] };
  let b = fakeBrowser(state);
  let waits = 0;
  let r = await login(file, { ...opts, launch: b.launch, wait: async () => ++waits === 2 && b.shut() });
  assert.ok(!r.errors, JSON.stringify(r));
  assert.equal(r.closedEarly, true);
  assert.equal(r.closedBy, "window");
  assert.equal(r.cookies, 1);

  b = fakeBrowser(state);
  r = await login(file, { ...opts, launch: b.launch, wait: async () => b.shut() });
  assert.match(r.errors[0], /closed before a session could be saved/);
  assert.ok(readFileSync(path.join(root, "playwright-tests/acme/.auth/state.json"), "utf8"), "the earlier session is left as it was");
});

test("login: an empty session is refused with more time offered; launch failures and bad --seconds are reported", async () => {
  const { file, opts } = setup();
  let r = await login(file, { ...opts, launch: fakeBrowser({ cookies: [], origins: [] }).launch });
  assert.match(r.errors[0], /is empty .*the login did not finish.*wait for it to close by itself/);
  assert.equal(r.saved, "playwright-tests/acme/.auth/state.json");

  r = await login(file, { ...opts, launch: async () => { throw new Error("Chromium distribution 'msedge' is not found at /opt/microsoft/msedge/msedge\nRun npx playwright install msedge"); } });
  assert.match(r.errors[0], /could not open Microsoft Edge: Chromium distribution 'msedge' is not found/);
  assert.match(r.fix, /install Microsoft Edge/);
  r = await login(file, { ...opts, exists: () => false, launch: async () => { throw new Error("ProcessSingleton: profile in use"); } });
  assert.match(r.errors[0], /could not open Playwright's Chromium/);
  assert.match(r.fix, /close the other login window/);

  assert.match((await login(file, { ...opts, seconds: 5 })).errors[0], /from 10 to 900/);
  assert.match((await login(file, { ...opts, seconds: Number("x") })).errors[0], /from 10 to 900/);
  assert.match((await login(path.join(path.dirname(file), "nope.yaml"), opts)).errors[0], /cannot read/);
});

test("login: a config with the session keys in flow style is not rewritten; the result says what to set", async () => {
  const { file, opts } = setup(CONFIG.replace(/authorizations:[\s\S]*$/, "authorizations: {mode: readonly}\n"));
  const r = await login(file, { ...opts, launch: fakeBrowser({ cookies: [{ name: "sid", domain: "app.acme.test", expires: -1 }], origins: [] }).launch });
  assert.ok(!r.errors, JSON.stringify(r));
  assert.equal(r.configUpdated, false);
  assert.match(r.next[0], /add authorizations\.authenticated_crawl and authorizations\.session_state_file/);
  assert.equal(readFileSync(file, "utf8"), CONFIG.replace(/authorizations:[\s\S]*$/, "authorizations: {mode: readonly}\n"));
});

const SID = (value, domain = ".acme.test") => ({ cookies: [{ name: "sid", domain, path: "/", value, expires: at(100) }], origins: [] });

test("login: closes by itself once a target cookie is new, stable for 3 s and the page has left the login page", async () => {
  const { root, file, opts } = setup();
  const b = fakeBrowser((n) => (n >= 3 ? SID("s3cret") : { cookies: [], origins: [] }), "https://app.acme.test/login");
  let waits = 0;
  const logs = [];
  // the cookie appears at the 4 s snapshot and the human reaches /home at 6 s (the third wait)
  const r = await login(file, { ...opts, log: (m) => logs.push(m), launch: b.launch, wait: async () => ++waits === 3 && b.setUrl("https://app.acme.test/home") });
  assert.ok(!r.errors, JSON.stringify(r));
  assert.equal(r.closedBy, "signed-in");
  assert.equal(r.closedEarly, false);
  assert.equal(waits, 4, "closes at 8 s, 3+ seconds after the change, long before the 5-minute ceiling");
  assert.equal(JSON.parse(readFileSync(path.join(root, r.saved), "utf8")).cookies[0].name, "sid");
  assert.ok(!logs.join("\n").includes("s3cret"), "a cookie value is never logged");
  assert.match(logs[0], /5 minutes at most/);
  assert.equal(r.session.ok, true);
});

test("login: a cookie alone does not close the window while the page is still the login page; a changed value counts, an unchanged one does not", async () => {
  const { file, opts } = setup();
  let b = fakeBrowser((n) => (n >= 2 ? SID("new") : { cookies: [], origins: [] }), "https://app.acme.test/login");
  let r = await login(file, { ...opts, launch: b.launch, seconds: 30 });
  assert.equal(r.closedBy, "timeout", "never left /login");

  // the profile already holds sid=old: the same value is no sign-in, a changed value is
  b = fakeBrowser(SID("old"), "https://app.acme.test/login");
  let waits = 0;
  r = await login(file, { ...opts, launch: b.launch, seconds: 30, wait: async () => ++waits === 1 && b.setUrl("https://app.acme.test/home") });
  assert.equal(r.closedBy, "timeout", "unchanged cookie");
  b = fakeBrowser((n) => (n >= 4 ? SID("rotated") : SID("old")), "https://app.acme.test/login");
  waits = 0;
  r = await login(file, { ...opts, launch: b.launch, seconds: 30, wait: async () => ++waits === 1 && b.setUrl("https://app.acme.test/home") });
  assert.equal(r.closedBy, "signed-in", "changed value");

  // a cookie of an identity provider is not the target's
  b = fakeBrowser((n) => (n >= 2 ? SID("x", ".login.microsoftonline.com") : { cookies: [], origins: [] }), "https://app.acme.test/login");
  waits = 0;
  r = await login(file, { ...opts, launch: b.launch, seconds: 30, wait: async () => ++waits === 1 && b.setUrl("https://app.acme.test/home") });
  assert.equal(r.closedBy, "timeout");
});

test("login: opens the OS default browser when it is Chromium-based (by executable path or channel), else Edge", async () => {
  const BRAVE = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser";
  const mac = (id) => ({ sys: { platform: "darwin", env: {} }, run: () => `(\n    {\n        LSHandlerRoleAll = "${id}";\n        LSHandlerURLScheme = https;\n    }\n)`, exists: (p) => p === BRAVE || p.endsWith("Google Chrome") });
  const { file, opts } = setup();
  const state = SID("v");
  let b = fakeBrowser(state);
  let r = await login(file, { ...opts, ...mac("com.brave.browser"), launch: b.launch });
  assert.equal(b.calls.launched.executablePath, BRAVE);
  assert.equal(b.calls.launched.channel, undefined);
  assert.equal(r.browser, "Brave");
  assert.equal(r.defaultBrowser, true);

  b = fakeBrowser(state);
  r = await login(file, { ...opts, ...mac("com.google.chrome"), launch: b.launch });
  assert.equal(b.calls.launched.channel, "chrome");
  assert.equal(r.defaultBrowser, true);

  // Safari is not Chromium-based: the fallback is Edge, then Chrome
  b = fakeBrowser(state);
  r = await login(file, { ...opts, ...mac("com.apple.safari"), exists: (p) => p.endsWith("Microsoft Edge"), launch: b.launch });
  assert.equal(b.calls.launched.channel, "msedge");
  assert.equal(r.defaultBrowser, false);
});

test("default browser detection, per platform, from the commands' real output", () => {
  const MAC = `(
    {
        LSHandlerContentType = "public.url";
        LSHandlerPreferredVersions =         {
            LSHandlerRoleAll = "-";
        };
        LSHandlerRoleAll = "com.apple.safari";
    },
    {
        LSHandlerPreferredVersions =         {
            LSHandlerRoleAll = "-";
        };
        LSHandlerRoleAll = "company.thebrowser.browser";
        LSHandlerURLScheme = https;
    },
    {
        LSHandlerRoleAll = "company.thebrowser.browser";
        LSHandlerURLScheme = http;
    }
)`;
  assert.equal(parseMacHandlers(MAC), "company.thebrowser.browser");
  assert.equal(parseMacHandlers(`({ LSHandlerRoleViewer = "com.microsoft.edgemac"; LSHandlerURLScheme = "https"; })`), "com.microsoft.edgemac");
  assert.equal(parseMacHandlers("({ LSHandlerRoleAll = x; LSHandlerURLScheme = mailto; })"), null);
  assert.equal(parseMacHandlers(null), null);
  let seen;
  assert.equal(defaultBrowserId({ platform: "darwin", run: (c, a) => ((seen = [c, ...a]), MAC) }), "company.thebrowser.browser");
  assert.deepEqual(seen, ["defaults", "read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"]);

  const REG = "\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice\r\n    ProgId    REG_SZ    BraveHTML\r\n\r\n";
  assert.equal(defaultBrowserId({ platform: "win32", run: (c, a) => ((seen = [c, ...a]), REG) }), "BraveHTML");
  assert.equal(seen[0], "reg");
  assert.equal(defaultBrowserId({ platform: "win32", run: () => null }), null);

  assert.equal(defaultBrowserId({ platform: "linux", run: (c, a) => ((seen = [c, ...a]), "brave-browser.desktop\n") }), "brave-browser.desktop");
  assert.deepEqual(seen, ["xdg-settings", "get", "default-web-browser"]);
  assert.equal(defaultBrowserId({ platform: "linux", run: () => "" }), null);

  // id -> a Chromium browser: channel for Chrome and Edge, an executable path that exists for the rest
  const all = () => true;
  const none = () => false;
  const env = { ProgramFiles: "C:\\Program Files", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" };
  assert.deepEqual(chromiumFromId("com.microsoft.edgemac", { platform: "darwin", exists: all }), { name: "Microsoft Edge", channel: "msedge" });
  assert.deepEqual(chromiumFromId("company.thebrowser.browser", { platform: "darwin", exists: all }), { name: "Arc", executablePath: "/Applications/Arc.app/Contents/MacOS/Arc" });
  assert.equal(chromiumFromId("com.vivaldi.vivaldi", { platform: "darwin", exists: all }).name, "Vivaldi");
  assert.equal(chromiumFromId("org.chromium.Chromium", { platform: "darwin", exists: all }).name, "Chromium");
  assert.equal(chromiumFromId("com.apple.safari", { platform: "darwin", exists: all }), null);
  assert.equal(chromiumFromId("org.mozilla.firefox", { platform: "darwin", exists: all }), null);
  assert.equal(chromiumFromId("com.google.chrome", { platform: "darwin", exists: none }), null, "not installed where expected: fall back");
  assert.deepEqual(chromiumFromId("ChromeHTML", { platform: "win32", env, exists: all }), { name: "Google Chrome", channel: "chrome" });
  assert.deepEqual(chromiumFromId("MSEdgeHTM", { platform: "win32", env, exists: all }), { name: "Microsoft Edge", channel: "msedge" });
  assert.match(chromiumFromId("BraveHTML", { platform: "win32", env, exists: all }).executablePath, /Brave-Browser.*brave\.exe$/);
  assert.match(chromiumFromId("VivaldiHTM.ABC123", { platform: "win32", env, exists: all }).executablePath, /vivaldi\.exe$/);
  assert.equal(chromiumFromId("FirefoxURL-308046B0AF4A39CB", { platform: "win32", env, exists: all }), null);
  assert.equal(chromiumFromId("IE.HTTPS", { platform: "win32", env, exists: all }), null);
  assert.deepEqual(chromiumFromId("google-chrome.desktop", { platform: "linux", exists: all }), { name: "Google Chrome", channel: "chrome" });
  assert.equal(chromiumFromId("microsoft-edge.desktop", { platform: "linux", exists: all }).channel, "msedge");
  assert.equal(chromiumFromId("brave-browser.desktop", { platform: "linux", exists: all }).executablePath, "/usr/bin/brave-browser");
  assert.equal(chromiumFromId("chromium_chromium.desktop", { platform: "linux", exists: all }), null, "an unknown snap id is not guessed");
  assert.equal(chromiumFromId("chromium-browser.desktop", { platform: "linux", exists: (p) => p === "/usr/bin/chromium-browser" }).executablePath, "/usr/bin/chromium-browser");
  assert.equal(chromiumFromId("firefox.desktop", { platform: "linux", exists: all }), null);
  assert.equal(chromiumFromId(null, { platform: "linux", exists: all }), null);

  // a faked machine never reads the real OS default
  assert.equal(loginBrowser({ sys: { platform: "linux", env: {} }, exists: none }).source, "fallback");
  assert.deepEqual(loginBrowser({ sys: { platform: "linux", env: {} }, exists: none }), { name: "Playwright's Chromium", source: "fallback" });
});
