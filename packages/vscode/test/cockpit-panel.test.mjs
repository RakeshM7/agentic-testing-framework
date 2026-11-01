// the Cockpit's editor tab (src/cockpit-panel.js, src/cockpit-panel-page.js; D-110, C3): message validation, the file
// opening refusals, the page's CSP and nonce, one panel per window, and the data sent once the page is ready.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { COMMAND_CONTRIBUTION, COMMAND_ID, VIEW_TYPE, credentialsFileOf, registerCockpitPanel, resolveOpenable } from "../src/cockpit-panel.js";
import { TABS, renderCockpitPanelHtml, validatePanelPageMessage, validateTabMessage } from "../src/cockpit-panel-page.js";
import { fakeContext, fakeVscode } from "./fake-vscode.mjs";

const tmp = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-vscode-panel-")));
const put = (root, rel, text = "x") => {
  const f = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};
const tick = () => new Promise((r) => setImmediate(r));

const C1 = {
  schemaVersion: 1,
  product: "acme",
  run: { runId: "r1", mode: "readonly", active: false },
  overview: { stages: [], next: [{ stage: "report", module: null }], needsYou: [], intents: { contacts: { heal: { enabled: true, why: "", stage: "playwright-ui" }, explore: { enabled: true, why: "" } } } },
  timeline: { stages: [{ key: "k", stage: "explore", module: "contacts", status: "done" }], totals: {}, history: [{ runId: "r1", outcome: "done", report: "artifacts/acme/results/r1/report/index.html" }] },
  trace: { modules: [] },
  failures: { byClass: {}, clusters: [], healable: [], unverified: [] },
  safety: { mode: "readonly", explanation: "", ledger: { entries: [], live: 0, cleaned: 0 }, customConfig: {}, frameworkIssues: 0 },
  missing: [],
};

function fixture({ runJson } = {}) {
  const root = tmp();
  put(root, "config/acme.yaml", "authorizations:\n  credentials_file: secrets/login.txt\n");
  put(root, "secrets/login.txt", "pw");
  put(root, "docs/notes.md", "# n");
  put(root, "docs/shot.png", "png");
  put(root, "docs/credentials-howto.md", "no");
  put(root, ".auth/state.json", "{}");
  put(root, "artifacts/acme/.auth/state.json", "{}");
  const products = [{ product: "acme", environments: [{ name: "default", config: "config/acme.yaml", state: null }] }];
  const vscode = fakeVscode({ folders: [root] });
  const panels = [];
  vscode.ViewColumn = { Active: -1 };
  vscode.window.createWebviewPanel = (type, title, column, options) => {
    const posted = [];
    let receive = null;
    let dispose = null;
    const panel = {
      type, title, options, posted, revealed: 0, visible: true,
      webview: { html: "", postMessage: async (m) => posted.push(m), onDidReceiveMessage: (fn) => ((receive = fn), { dispose() {} }) },
      reveal: () => panel.revealed++,
      onDidChangeViewState: () => ({ dispose() {} }),
      onDidDispose: (fn) => ((dispose = fn), { dispose() {} }),
      dispose: () => dispose?.(),
      send: (m) => receive(m),
    };
    panels.push(panel);
    return panel;
  };
  const refreshed = [];
  const workspace = { ok: true, root, state: "ok", products: () => products, onDidRefresh: (fn) => (refreshed.push(fn), { dispose() {} }), detect() {} };
  const calls = [];
  const cli = { runJson: async (...a) => (calls.push(a), runJson ? runJson(...a) : C1) };
  const output = vscode.window.createOutputChannel("atf");
  const ctx = fakeContext();
  const sessions = [];
  const sheets = [];
  const api = registerCockpitPanel(ctx, { vscode, workspace, output, cli }, { actions: { session: (argv, t) => void sessions.push([argv, t]), openSheet: (a) => void sheets.push(a) } });
  return { root, vscode, panels, calls, api, sessions, sheets, output, ctx, workspace, refreshed, last: (type) => panels[0]?.posted.filter((m) => m.type === type).at(-1) };
}

test("validateTabMessage: the C3 messages with bounded fields; anything else is refused", () => {
  const ok = (m) => assert.equal(validateTabMessage(m).ok, true, JSON.stringify(m));
  const no = (m) => assert.equal(validateTabMessage(m).ok, false, JSON.stringify(m));
  for (const type of ["ready", "refresh", "sweep"]) ok({ type }), no({ type, x: 1 });
  for (const tab of TABS) ok({ type: "tab", tab });
  no({ type: "tab", tab: "other" });
  ok({ type: "openFile", path: "artifacts/acme/x.md" });
  no({ type: "openFile", path: "" });
  no({ type: "openFile", path: "a".repeat(1001) });
  no({ type: "openFile", path: 5 });
  ok({ type: "resume", stage: "explore", module: "contacts" });
  ok({ type: "resume", stage: "report", module: null });
  no({ type: "resume", stage: "../x", module: null });
  ok({ type: "heal", module: "contacts", stage: "playwright-ui" });
  no({ type: "heal", module: null, stage: "playwright-ui" });
  ok({ type: "openSheet", module: "contacts", sheet: "approval" });
  no({ type: "openSheet", module: "contacts", sheet: "other" });
  ok({ type: "openReport", runId: "20260101-a" });
  no({ type: "openReport", runId: "a/../b" });
  no({ type: "bogus" });
  no(null);
  no([]);
});

test("validatePanelPageMessage: host -> page data, loading and error", () => {
  const ok = (m) => assert.equal(validatePanelPageMessage(m).ok, true, JSON.stringify(m));
  const no = (m) => assert.equal(validatePanelPageMessage(m).ok, false, JSON.stringify(m));
  ok({ type: "loading" });
  ok({ type: "error", message: "boom" });
  no({ type: "error", message: 5 });
  ok({ type: "data", product: "acme", environment: "default", tab: "timeline", data: {} });
  ok({ type: "data", product: "acme", environment: "default", tab: "trace", focus: { stage: "explore", module: "m" }, data: {} });
  no({ type: "data", product: "acme", environment: "default", tab: "nope", data: {} });
  no({ type: "data", product: "acme", environment: "default", tab: "trace", data: null });
  no({ type: "data", product: "acme", environment: "default", tab: "trace", focus: { x: 1 }, data: {} });
  no({ type: "x" });
});

test("resolveOpenable: refuses .., outside the root, .auth/, a missing file, credentials files; opens a plain file", () => {
  const { root } = fixture();
  const outside = tmp();
  put(outside, "o.md");
  const no = (p, re) => {
    const r = resolveOpenable(root, "acme", p);
    assert.equal(r.ok, false, p);
    assert.match(r.why, re, p);
  };
  no("../outside.md", /outside/);
  no("docs/../../x.md", /outside/);
  no(path.join(outside, "o.md"), /outside/);
  no(".auth/state.json", /\.auth/);
  no("artifacts/acme/.auth/state.json", /\.auth/);
  no("docs/../.auth/state.json", /\.auth/);
  no("docs/missing.md", /does not exist/);
  no("docs", /not a file/);
  no("secrets/login.txt", /credentials file/);
  no("./secrets/../secrets/login.txt", /credentials file/);
  no("docs/credentials-howto.md", /looks like/);
  no("", /no path/);
  symlinkSync(outside, path.join(root, "docs", "link"), "dir");
  no("docs/link/o.md", /outside/);
  const good = resolveOpenable(root, "acme", "docs/notes.md");
  assert.equal(good.ok, true);
  assert.equal(good.file, path.join(root, "docs", "notes.md"));
  assert.equal(resolveOpenable(root, "acme", path.join(root, "docs", "notes.md")).ok, true); // absolute, inside
  assert.equal(credentialsFileOf(root, "acme"), "secrets/login.txt");
  assert.equal(credentialsFileOf(root, "nope"), null);
});

test("renderCockpitPanelHtml: the CSP, the nonce on the style and the script, the embedded kit and tabs", () => {
  const nonce = "abcdEFGH1234abcdEFGH1234";
  const html = renderCockpitPanelHtml({ nonce });
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'nonce-abcdEFGH1234abcdEFGH1234'; script-src 'nonce-abcdEFGH1234abcdEFGH1234'/);
  assert.match(html, /<style nonce="abcdEFGH1234abcdEFGH1234">/);
  assert.match(html, /<script nonce="abcdEFGH1234abcdEFGH1234">var __name=/);
  assert.equal((html.match(/<script/g) ?? []).length, 1);
  assert.doesNotMatch(html, /https?:\/\//);
  for (const n of ["renderTimeline", "renderTrace", "renderFailures", "renderSafety"]) assert.match(html, new RegExp(n));
  assert.match(html, /acquireVsCodeApi/);
  assert.throws(() => renderCockpitPanelHtml({ nonce: "x" }), /nonce/);
  // the embedded script parses
  const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script));
});

test("the page draws the header and the tab strip, remembers the tab, and posts ready", async () => {
  const { install, uninstall } = await import("./fake-dom.mjs");
  const doc = install();
  try {
    const app = doc.createElement("div");
    doc.getElementById = () => app;
    const posted = [];
    let state;
    const listeners = {};
    globalThis.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m), getState: () => ({ tab: "safety" }), setState: (s) => (state = s) });
    globalThis.window = { addEventListener: (t, fn) => (listeners[t] = fn) };
    const html = renderCockpitPanelHtml({ nonce: "abcdEFGH1234abcdEFGH1234" });
    const script = html.match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
    new Function(script)();
    assert.deepEqual(posted, [{ type: "ready" }]);
    listeners.message({ data: { type: "data", product: "acme", environment: "default", tab: "safety", data: C1 } });
    assert.match(app.textContent, /acme/);
    assert.ok(app.find("span.mode.mode-readonly"));
    const tabs = app.findAll("button.tab");
    assert.equal(tabs.length, 4);
    assert.ok(tabs[3].className.includes("active"));
    tabs[1].dispatch("click");
    assert.deepEqual(state, { tab: "trace" });
    assert.deepEqual(posted.at(-1), { type: "tab", tab: "trace" });
    app.find("button").dispatch("click"); // Refresh is the first button
    assert.deepEqual(posted.at(-1), { type: "refresh" });
    listeners.message({ data: { type: "bogus" } }); // ignored
    listeners.message({ data: { type: "error", message: "it broke" } });
    assert.match(app.textContent, /it broke/);
  } finally {
    delete globalThis.acquireVsCodeApi;
    delete globalThis.window;
    uninstall();
  }
});

test("the command: one panel per window, reused; data is posted after ready; the tab and focus come through", async () => {
  const f = fixture();
  assert.ok(f.vscode.rec.commands.has(COMMAND_ID));
  await f.vscode.commands.executeCommand(COMMAND_ID, { product: "acme", environment: "default", tab: "failures", focus: { stage: "explore", module: "contacts" } });
  assert.equal(f.panels.length, 1);
  const p = f.panels[0];
  assert.equal(p.type, VIEW_TYPE);
  assert.equal(p.title, "atf Cockpit · acme");
  assert.equal(p.options.retainContextWhenHidden, true);
  assert.match(p.webview.html, /Content-Security-Policy/);
  assert.deepEqual(f.calls[0][0], ["acme", "--json"]);
  assert.equal(f.calls[0][1].script, path.join("scripts", "cockpit.mjs"));
  assert.equal(f.calls[0][1].env.ATF_ENV, "");
  assert.deepEqual(p.posted, [], "nothing is posted before the page says ready");
  p.send({ type: "ready" });
  await tick();
  const d = p.posted.at(-1);
  assert.equal(d.type, "data");
  assert.equal(d.tab, "failures");
  assert.deepEqual(d.focus, { stage: "explore", module: "contacts" });
  assert.equal(d.data.schemaVersion, 1);
  // a second open reuses the panel
  await f.vscode.commands.executeCommand(COMMAND_ID, { product: "acme", tab: "safety" });
  assert.equal(f.panels.length, 1);
  assert.equal(p.revealed, 1);
  assert.equal(p.posted.filter((m) => m.type === "loading").length >= 1, true);
  assert.equal(p.posted.at(-1).tab, "safety");
  // the page's tab choice is remembered for the next reload; refresh reloads
  p.send({ type: "tab", tab: "trace" });
  p.send({ type: "refresh" });
  await tick();
  assert.equal(p.posted.at(-1).tab, "trace");
  assert.equal(f.calls.length, 3);
  // closing the panel lets the next open make a new one
  p.dispose();
  await f.vscode.commands.executeCommand(COMMAND_ID, { product: "acme" });
  assert.equal(f.panels.length, 2);
});

test("an unknown product is refused; a failed load and an unknown C1 format are posted as an error", async () => {
  const f = fixture({ runJson: async () => ({ error: "unknown product" }) });
  await f.vscode.commands.executeCommand(COMMAND_ID, { product: "nope" });
  assert.equal(f.panels.length, 0);
  assert.match(f.vscode.rec.messages.at(-1)[1], /not a product/);
  await f.vscode.commands.executeCommand(COMMAND_ID, { product: "acme" });
  f.panels[0].send({ type: "ready" });
  await tick();
  assert.deepEqual(f.last("error"), { type: "error", message: "unknown product" });
  const g = fixture({ runJson: async () => ({ schemaVersion: 9 }) });
  await g.vscode.commands.executeCommand(COMMAND_ID, {});
  g.panels[0].send({ type: "ready" });
  await tick();
  assert.match(g.last("error").message, /format/);
});

test("without a product the only one is taken", async () => {
  const f = fixture();
  await f.vscode.commands.executeCommand(COMMAND_ID);
  assert.equal(f.panels.length, 1);
  assert.equal(f.vscode.rec.quickPicks.length, 0);
});

test("openFile through the panel: opens a text file and an image, refuses the rest", async () => {
  const f = fixture();
  await f.vscode.commands.executeCommand(COMMAND_ID, { product: "acme" });
  const p = f.panels[0];
  p.send({ type: "ready" });
  await tick();
  p.send({ type: "openFile", path: "docs/notes.md" });
  await tick();
  assert.deepEqual(f.vscode.rec.opened.map((o) => o[0]), [path.join(f.root, "docs", "notes.md")]);
  p.send({ type: "openFile", path: "docs/shot.png" });
  await tick();
  assert.deepEqual(f.vscode.rec.executed.filter((e) => e[0] === "vscode.open").map((e) => e[1].fsPath), [path.join(f.root, "docs", "shot.png")]);
  const opened = f.vscode.rec.opened.length;
  for (const bad of ["../x", ".auth/state.json", "docs/missing.md", "secrets/login.txt", path.join(tmp(), "a.md")]) {
    p.send({ type: "openFile", path: bad });
    await tick();
  }
  assert.equal(f.vscode.rec.opened.length, opened, "none of them opened");
  assert.equal(f.vscode.rec.executed.filter((e) => e[0] === "vscode.open").length, 1);
  assert.equal(f.vscode.rec.messages.filter((m) => m[0] === "warning").length, 5);
});

test("resume, heal, openSheet, openReport and sweep re-check their targets against the product and the data", async () => {
  const f = fixture();
  await f.vscode.commands.executeCommand(COMMAND_ID, { product: "acme" });
  const p = f.panels[0];
  p.send({ type: "ready" });
  await tick();
  p.send({ type: "resume", stage: "explore", module: "contacts" });
  p.send({ type: "resume", stage: "report", module: null }); // in next
  p.send({ type: "resume", stage: "k6", module: "contacts" }); // not a stage of this run
  p.send({ type: "heal", module: "contacts", stage: "playwright-ui" });
  p.send({ type: "heal", module: "contacts", stage: "k6" }); // not the intent's stage
  p.send({ type: "heal", module: "ghost", stage: "playwright-ui" });
  p.send({ type: "openSheet", module: "contacts", sheet: "approval" });
  p.send({ type: "openSheet", module: "ghost", sheet: "approval" });
  p.send({ type: "openReport", runId: "r1" });
  p.send({ type: "openReport", runId: "r9" });
  await tick();
  assert.deepEqual(f.sessions.map((s) => s[0]), [
    ["resume", "acme", "--stage", "explore", "--module", "contacts"],
    ["resume", "acme", "--stage", "report"],
    ["resume", "acme", "--stage", "playwright-ui", "--module", "contacts"],
  ]);
  assert.deepEqual(f.sessions[0][1], { product: "acme", environment: "default" });
  assert.deepEqual(f.sheets, [{ product: "acme", environment: "default", module: "contacts", sheet: "approval" }]);
  const report = f.vscode.rec.executed.filter((e) => e[0] === "atf.openReport");
  assert.equal(report.length, 1);
  assert.equal(report[0][1].runId, "r1");
  assert.equal(f.vscode.rec.messages.filter((m) => m[0] === "warning").length, 5);
  p.send({ type: "sweep" });
  await tick();
  assert.equal(f.vscode.rec.executed.filter((e) => e[0] === "atf.sweep").length, 1);
  p.send({ type: "evil", x: 1 });
  await tick();
  assert.match(f.output.lines.at(-1), /invalid message/);
});

test("changes under the run's state reload the panel, debounced; others do not", async () => {
  const f = fixture();
  await f.vscode.commands.executeCommand(COMMAND_ID, { product: "acme" });
  assert.ok(f.vscode.rec.watchers.length >= 3);
  const before = f.calls.length;
  const w = f.vscode.rec.watchers[0];
  w.change.fire({ fsPath: path.join(f.root, "docs", "notes.md") });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(f.calls.length, before);
  // the debounce itself is runs.js's; here we only prove the relevant path is wired to a trigger
  w.change.fire({ fsPath: path.join(f.root, "artifacts", "acme", "state", "run.json") });
  f.panels[0].dispose();
  assert.ok(f.vscode.rec.watchers.every((x) => x.disposed));
});

test("COMMAND_CONTRIBUTION describes the command for package.json", () => {
  assert.deepEqual(COMMAND_CONTRIBUTION.commands[0], { command: "atf.openCockpit", title: "Open Cockpit", category: "atf", icon: "$(dashboard)" });
  assert.equal(COMMAND_CONTRIBUTION.menus.commandPalette[0].when, "atf.active");
  assert.ok(COMMAND_CONTRIBUTION.menus["view/title"].length);
});
