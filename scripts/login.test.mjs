import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { setLoginKeys } from "./lib/login.mjs";
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
function fakeBrowser(state) {
  const calls = { launched: null, goto: [], snapshots: 0 };
  let onClose = () => {};
  let closed = false;
  const shut = () => {
    if (!closed) (closed = true), onClose();
  };
  const page = { goto: async (u) => calls.goto.push(u) };
  const ctx = {
    on: (ev, fn) => ev === "close" && (onClose = fn),
    pages: () => [page],
    newPage: async () => page,
    storageState: async () => {
      if (closed) throw new Error("Target page, context or browser has been closed");
      calls.snapshots++;
      return state;
    },
    close: async () => shut(),
  };
  return { calls, shut, launch: async (dir, channel) => ((calls.launched = { dir, channel }), ctx) };
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
  assert.equal(b.calls.snapshots, 6, "a snapshot every 2 seconds of the 10, and one before closing");
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
  assert.equal(r.cookies, 1);

  b = fakeBrowser(state);
  r = await login(file, { ...opts, launch: b.launch, wait: async () => b.shut() });
  assert.match(r.errors[0], /closed before a session could be saved/);
  assert.ok(readFileSync(path.join(root, "playwright-tests/acme/.auth/state.json"), "utf8"), "the earlier session is left as it was");
});

test("login: an empty session is refused with more time offered; launch failures and bad --seconds are reported", async () => {
  const { file, opts } = setup();
  let r = await login(file, { ...opts, launch: fakeBrowser({ cookies: [], origins: [] }).launch });
  assert.match(r.errors[0], /is empty .*the login did not finish.*--seconds 120/);
  assert.equal(r.saved, "playwright-tests/acme/.auth/state.json");

  r = await login(file, { ...opts, launch: async () => { throw new Error("Chromium distribution 'msedge' is not found at /opt/microsoft/msedge/msedge\nRun npx playwright install msedge"); } });
  assert.match(r.errors[0], /could not open Microsoft Edge: Chromium distribution 'msedge' is not found/);
  assert.match(r.fix, /install Microsoft Edge/);
  r = await login(file, { ...opts, exists: () => false, launch: async () => { throw new Error("ProcessSingleton: profile in use"); } });
  assert.match(r.errors[0], /could not open Playwright's Chromium/);
  assert.match(r.fix, /close the other login window/);

  assert.match((await login(file, { ...opts, seconds: 5 })).errors[0], /from 10 to 600/);
  assert.match((await login(file, { ...opts, seconds: Number("x") })).errors[0], /from 10 to 600/);
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
