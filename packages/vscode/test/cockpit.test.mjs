// the Cockpit (src/cockpit.js, src/cockpit-sidebar-page.js; D-110): its messages, the form's answers, the page's
// shell, the environment model, and the view on a fake webview, whose New product form drafts a run-config through the
// framework's real run-config.mjs.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { CASE_TYPES as CORE_CASE_TYPES, STEPS as CORE_STEPS } from "../../core/scripts/lib/contract.mjs";
import { CliError, createCli } from "../src/cli.js";
import { CASE_TYPES, FILE_FIELDS, PANEL_COMMANDS, STEPS, formAnswers, renderCockpitHtml, validatePanelMessage } from "../src/cockpit-sidebar-page.js";
import { DRAFT_SCRIPT, VIEW_ID, checkRows, createEnvironment, draftResult, productRows, registerCockpit, sessionRow } from "../src/cockpit.js";
import { createWorkspace } from "../src/workspace.js";
import { fakeContext, fakeVscode } from "./fake-vscode.mjs";

const CORE = path.resolve(import.meta.dirname, "..", "..", "core");
const tmp = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-vscode-comp-")));
const put = (root, rel, text = "") => {
  const f = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};
const tick = () => new Promise((r) => setImmediate(r));

test("the form's steps and test case types are the framework's", () => {
  assert.deepEqual(STEPS, CORE_STEPS);
  assert.deepEqual(CASE_TYPES, CORE_CASE_TYPES);
});

test("validatePanelMessage: only the known messages, with bounded fields; anything else is refused", () => {
  const ok = (m) => assert.equal(validatePanelMessage(m).ok, true, JSON.stringify(m));
  const no = (m) => assert.equal(validatePanelMessage(m).ok, false, JSON.stringify(m));
  for (const type of ["ready", "check", "fix", "unpinNode", "interview", "openOutput", "newForm"]) ok({ type }), no({ type, extra: 1 });
  ok({ type: "run", product: "acme", environment: "default" });
  no({ type: "run", product: "../etc", environment: "default" });
  no({ type: "doctor", product: "acme" });
  ok({ type: "login", product: "acme" });
  no({ type: "login", product: "Acme CRM" });
  ok({ type: "useNode", path: "/usr/bin/node" });
  no({ type: "useNode", path: "" });
  no({ type: "useNode", path: "x".repeat(2000) });
  for (const id of PANEL_COMMANDS) ok({ type: "command", id });
  no({ type: "command", id: "workbench.action.terminal.new" });
  for (const field of FILE_FIELDS) ok({ type: "pickFiles", field });
  no({ type: "pickFiles", field: "name" });
  ok({ type: "draft", form: { name: "Acme", url: "https://a.test", steps: ["explore"], testcasesTypes: ["ui"], loginNeeded: true } });
  no({ type: "draft", form: { name: "Acme", steps: ["deploy"] } });
  no({ type: "draft", form: { name: "Acme", steps: ["explore", "explore"] } });
  no({ type: "draft", form: { name: 42 } });
  no({ type: "draft", form: { name: "Acme", password: "x" } });
  no({ type: "draft" });
  no({ type: "nope" });
  no(null);
  no("ready");
});

test("formAnswers: the form as the draft's answers; only what was filled in; the obvious gaps said before anything runs", () => {
  const { answers, problems } = formAnswers({
    name: " Acme CRM ",
    visibility: "internal",
    url: "https://crm.acme.test",
    description: "Sales CRM",
    overviewUrl: "",
    modules: "Contacts\n\n Deals | https://crm.acme.test/deals \n",
    references: "https://docs.acme.test\ndocs/req.md",
    api: "",
    loginNeeded: true,
    credentialsFile: " .env.acme ",
    steps: ["explore", "clarifications", "testcases"],
    testcasesTypes: ["ui", "api"],
    testcasesImport: "",
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(answers, {
    name: "Acme CRM",
    visibility: "internal",
    url: "https://crm.acme.test",
    description: "Sales CRM",
    modules: ["Contacts", { name: "Deals", url: "https://crm.acme.test/deals" }],
    references: ["https://docs.acme.test", "docs/req.md"],
    login: { needed: true, credentials_file: ".env.acme" },
    steps: ["explore", "clarifications", "testcases"],
    testcases_types: ["ui", "api"],
  });
  // every step: no `steps` (the draft's default is all six); types implied by their automation step are not asked
  const all = formAnswers({ name: "A", url: "https://a.test", modules: "M", steps: STEPS, testcasesTypes: ["ui", "api", "performance"] });
  assert.deepEqual(Object.keys(all.answers), ["name", "visibility", "url", "modules"]);
  assert.deepEqual(formAnswers({}).problems, ["Give the product's name.", "Give the URL to test (http or https).", "Name at least one module to test (one per line)."]);
  assert.deepEqual(formAnswers({ name: "A", url: "ftp://a", modules: "M", steps: [] }).problems, ["Give the URL to test (http or https).", "Choose at least one step."]);
});

test("the page: a strict CSP with this load's nonce on its one style and script, nothing remote", () => {
  const nonce = "abcdefghijklmnopqrstuv";
  const html = renderCockpitHtml({ nonce });
  assert.match(html, /default-src 'none'; style-src 'nonce-abcdefghijklmnopqrstuv'; script-src 'nonce-abcdefghijklmnopqrstuv'/);
  assert.equal((html.match(/<script nonce="abcdefghijklmnopqrstuv">/g) ?? []).length, 1);
  assert.equal((html.match(/<style nonce="abcdefghijklmnopqrstuv">/g) ?? []).length, 1);
  assert.doesNotMatch(html, /https?:\/\/(?!crm\.example|wiki\.example|docs\.example|api\.example)/, "no remote resource");
  assert.doesNotMatch(html, /innerHTML/, "values go into the DOM as text");
  assert.throws(() => renderCockpitHtml({ nonce: "short" }), /nonce/);
});

test("checkRows and sessionRow: the doctor's checks as rows; the session's Node.js with the installs to switch to", () => {
  assert.deepEqual(checkRows([
    { id: "node", ok: true, detail: "Node.js 18.20.8" },
    { id: "mcp-browser", ok: false, level: "fail", detail: "chromium missing", fix: "npx playwright install chromium", fixable: true },
    { id: "k6", ok: true, level: "warn", detail: "k6 is not installed (needed only for k6 load tests)", fix: "brew install k6" },
  ]), [
    { id: "node", status: "ok", detail: "For atf's own commands in VS Code: Node.js 18.20.8", fix: null, canFix: false },
    { id: "mcp-browser", status: "fail", detail: "chromium missing", fix: "npx playwright install chromium", canFix: true },
    { id: "k6", status: "warn", detail: "k6 is not installed (needed only for k6 load tests)", fix: "brew install k6", canFix: false },
  ]);
  const nodes = [
    { path: "/brew/node", version: "26.0.0", major: 26, source: "Homebrew node" },
    { path: "/nvm/24/node", version: "24.19.0", major: 24, source: "nvm" },
    { path: "/brew/node@18", version: "18.20.8", major: 18, source: "Homebrew node@18" },
  ];
  const old = sessionRow({ path: "/brew/node@18", version: "18.20.8", major: 18 }, { nodes });
  assert.equal(old.status, "fail");
  assert.match(old.fix, /Node\.js 20 or later/);
  assert.deepEqual(old.choices.map((c) => c.version), ["26.0.0", "24.19.0"], "only 20 or later");
  const good = sessionRow({ path: "/nvm/24/node", version: "24.19.0", major: 24 }, { nodes });
  assert.deepEqual([good.status, good.choices], ["ok", undefined], "nothing to choose when it is fine and not pinned");
  const pinned = sessionRow({ path: "/nvm/24/node", version: "24.19.0", major: 24 }, { pinned: true, nodes, nodePath: "/nvm/24/node" });
  assert.deepEqual([pinned.status, pinned.pinned, pinned.choices.map((c) => c.path)], ["ok", true, ["/brew/node"]], "pinned: the others, to switch");
});

test("productRows and draftResult", () => {
  const root = tmp();
  put(root, "atf/atf.json", "{}");
  put(root, "node_modules/@testagentic/atf/package.json", JSON.stringify({ name: "@testagentic/atf", version: "0.1.0" }));
  put(root, "node_modules/@testagentic/atf/bin/atf.mjs", "");
  put(root, "config/acme.yaml", "product: acme\n");
  put(root, "config/acme-uat.yaml", "product: acme\nenvironment: uat\n");
  put(root, "artifacts/acme/state/lock.json", "{}");
  put(root, "artifacts/acme/envs/uat/state/run.json", "{}");
  const ws = createWorkspace(fakeVscode({ folders: [root] }));
  assert.deepEqual(productRows(ws), [
    { product: "acme", environment: "default", config: "config/acme.yaml", active: true, status: "run active" },
    { product: "acme", environment: "uat", config: "config/acme-uat.yaml", active: false, status: "last run ended" },
  ]);
  assert.deepEqual(productRows({ ok: false }), []);

  const out = (line, stream = "stdout") => ({ line, stream });
  assert.deepEqual(draftResult({ code: 0, lines: ["{", '  "file": "config/acme.yaml",', '  "product": "acme",', '  "warnings": ["w"]', "}"].map((l) => out(l)) }), { ok: true, file: "config/acme.yaml", product: "acme", warnings: ["w"], next: [] });
  assert.deepEqual(draftResult({ code: 1, lines: [out("- url: missing", "stderr"), out("- modules: none", "stderr")] }), { ok: false, errors: ["url: missing", "modules: none"] });
  assert.deepEqual(draftResult({ code: 1, lines: [out("boom", "stderr")] }), { ok: false, errors: ["boom"] });
});

// the environment model on a fake cli: the machine check's JSON, and the Node.js finders
function envFixture({ terminal, nodes = [], checks, config = {} } = {}) {
  const vscode = fakeVscode({ config });
  const runs = [];
  const cli = {
    nodePath: () => (config.nodePath || "").trim() || "node",
    runStreaming: async (args, opts) => {
      runs.push({ args, opts });
      for (const l of JSON.stringify({ scope: "this machine", checks: checks ?? [{ id: "node", group: "base", ok: true, detail: "Node.js 22.1.0" }], fixed: args.includes("--fix") ? ["npx playwright install chromium"] : [] }, null, 2).split("\n")) opts.onLine(l, "stdout");
      return { code: 0, cancelled: false };
    },
  };
  const workspace = { root: "/ws", framework: "/ws/node_modules/@testagentic/atf" };
  const output = { lines: [], appendLine: (l) => output.lines.push(l) };
  const probed = [];
  const env = createEnvironment({ vscode, workspace, cli, output }, {
    terminalNode: async () => terminal ?? { path: "/usr/local/bin/node", version: "22.1.0", major: 22 },
    probeNode: async (p) => (probed.push(p), { version: "24.19.0", major: 24 }),
    findNodes: async () => nodes,
    now: () => Date.parse("2026-10-31T10:05:00"),
  });
  return { vscode, env, runs, output, probed };
}

test("the environment: the session's Node.js first, then the machine check; pinning a Node.js offered sets atf.nodePath and checks again", async () => {
  const nodes = [{ path: "/nvm/24/bin/node", version: "24.19.0", major: 24, source: "nvm" }];
  const f = envFixture({ terminal: { path: "/brew/node@18/bin/node", version: "18.20.8", major: 18 }, nodes });
  const seen = [];
  f.env.onDidChange((s) => seen.push(s.status));
  const s = await f.env.check();
  assert.deepEqual(seen, ["checking", "done"]);
  assert.deepEqual(s.rows.map((r) => [r.id, r.status]), [["session-node", "fail"], ["node", "ok"]]);
  assert.deepEqual(s.rows[0].choices, [{ path: "/nvm/24/bin/node", version: "24.19.0", source: "nvm" }]);
  assert.deepEqual(f.runs[0].args, ["--machine", "--json"]);
  assert.deepEqual([f.runs[0].opts.script, f.runs[0].opts.env], [path.join("scripts", "doctor.mjs"), { ATF_ENV: "", ATF_WORKSPACE: "/ws" }]);
  assert.equal(f.env.offered("/nvm/24/bin/node"), true);
  assert.equal(f.env.offered("/somewhere/else"), false);

  await f.env.pin("/nvm/24/bin/node");
  assert.deepEqual(f.vscode.rec.updates, [["nodePath", "/nvm/24/bin/node", f.vscode.ConfigurationTarget.Global]]);
  assert.deepEqual(f.probed, ["/nvm/24/bin/node"], "a pin is probed, not the terminal");
  assert.deepEqual(f.env.state.rows[0].detail, "Node.js 24.19.0 pinned (atf.nodePath): /nvm/24/bin/node");
  await f.env.pin(null);
  assert.deepEqual(f.vscode.rec.updates.at(-1), ["nodePath", undefined, f.vscode.ConfigurationTarget.Global]);

  // Fix: --fix, and what it installed is logged
  await f.env.check({ fix: true });
  assert.deepEqual(f.runs.at(-1).args, ["--machine", "--json", "--fix"]);
  assert.ok(f.output.lines.some((l) => l.includes("installed: npx playwright install chromium")));
});

test("the environment without the framework installed: only the Node.js check; a broken machine check is said", async () => {
  const f = envFixture();
  const env = createEnvironment({ vscode: f.vscode, workspace: { framework: null }, cli: { nodePath: () => "node" }, output: null }, { terminalNode: async () => ({ missing: true }), findNodes: async () => [] });
  const s = await env.check();
  assert.deepEqual(s.rows.map((r) => [r.id, r.status, r.choices]), [["session-node", "fail", []]]);
  const broken = createEnvironment({ vscode: f.vscode, workspace: { framework: "/fw", root: "/ws" }, cli: { nodePath: () => "node", runStreaming: async (a, o) => (o.onLine("Error: Cannot find module", "stderr"), { code: 1 }) }, output: null }, { terminalNode: async () => ({ path: "/n", version: "22.0.0", major: 22 }) });
  assert.match((await broken.check()).error, /the machine check printed no result \(exit 1\)/);
});

// ---- the view, on a fake webview, with the framework's real run-config.mjs --------------------------------------------

function fakeView() {
  const posted = [];
  let handler = null;
  const view = {
    visible: true,
    webview: { options: null, html: "", postMessage: async (m) => posted.push(m), onDidReceiveMessage: (fn) => ((handler = fn), { dispose() {} }) },
    onDidChangeVisibility: () => ({ dispose() {} }),
    onDidDispose: () => ({ dispose() {} }),
  };
  return { view, posted, send: (m) => handler(m), last: (type = "state") => posted.filter((m) => m.type === type).at(-1) };
}

function panelFixture({ openDialogs = [] } = {}) {
  const root = tmp();
  put(root, "atf/atf.json", "{}");
  mkdirSync(path.join(root, "node_modules", "@testagentic"), { recursive: true });
  symlinkSync(CORE, path.join(root, "node_modules", "@testagentic", "atf"), "dir"); // the framework, as npm links it
  put(root, "docs/req.md", "# Requirements\n");
  const vscode = fakeVscode({ folders: [root], openDialogs });
  const ctx = fakeContext();
  const output = vscode.window.createOutputChannel("atf");
  const workspace = createWorkspace(vscode);
  const cli = createCli({ vscode, workspace, output, env: { ...process.env, ATF_ENV: "" } });
  const acted = [];
  const action = (name) => (...args) => void acted.push([name, ...args]);
  const environment = createEnvironment({ vscode, workspace, cli, output }, { terminalNode: async () => ({ path: "/n", version: "22.1.0", major: 22 }), findNodes: async () => [] });
  const panel = registerCockpit(ctx, { vscode, workspace, cli, output }, { environment, actions: { run: action("run"), doctor: action("doctor"), openConfig: action("openConfig"), interview: action("interview"), login: action("login"), command: action("command") } });
  const [reg] = vscode.rec.webviewViews;
  const v = fakeView();
  reg.provider.resolveWebviewView(v.view);
  return { root, vscode, workspace, panel, reg, v, acted, environment, output };
}

test("the view: registered as atf.cockpit, a locked-down page, its state on ready, and an environment check started", async () => {
  const p = panelFixture();
  assert.equal(p.reg.id, VIEW_ID);
  assert.equal(VIEW_ID, "atf.cockpit");
  assert.deepEqual(p.reg.opts, { webviewOptions: { retainContextWhenHidden: true } });
  assert.deepEqual(p.v.view.webview.options, { enableScripts: true, enableForms: false, localResourceRoots: [] });
  assert.match(p.v.view.webview.html, /Content-Security-Policy/);
  await p.v.send({ type: "ready" });
  const s = p.v.last().state;
  assert.equal(s.workspace.state, "ok");
  assert.deepEqual(s.products, []);
  assert.deepEqual(s.form, { busy: false, errors: [], result: null, reset: false, open: false });
  assert.equal(s.env.status, "checking", "the check starts when the page is ready");
  await p.environment.check(); // the same run (one at a time)
  await tick();
  const after = p.v.last().state.env;
  assert.equal(after.status, "done");
  assert.equal(after.rows[0].id, "session-node");
  assert.ok(after.rows.some((r) => r.id === "framework-deps"), "the framework's real machine check ran");
});

test("New product form: the real run-config.mjs drafts config/<product>.yaml, readonly; the result offers login, run and config", async () => {
  const p = panelFixture();
  await p.v.send({ type: "draft", form: { name: "Acme CRM", visibility: "public", url: "https://crm.acme.test", modules: "Contacts\nDeals", references: "docs/req.md", loginNeeded: true, steps: ["explore", "clarifications", "testcases"], testcasesTypes: ["ui"] } });
  const s = p.v.last().state;
  assert.deepEqual(s.form.errors, []);
  assert.deepEqual(s.form.result, { file: "config/acme-crm.yaml", product: "acme-crm", warnings: s.form.result.warnings, loginNeeded: true });
  const text = readFileSync(path.join(p.root, "config", "acme-crm.yaml"), "utf8");
  assert.match(text, /^product: acme-crm$/m);
  assert.match(text, /mode: readonly/);
  assert.match(text, /docs\/req\.md/);
  assert.deepEqual(s.products.map((r) => r.product), ["acme-crm"], "the new product is listed");
  assert.ok(p.v.posted.some((m) => m.type === "state" && m.state.form.busy), "busy while the script runs");
  // nothing left behind but the run-config: the answers went through a temporary file
  assert.equal(existsSync(path.join(p.root, "config", "interview-answers.json")), false);

  // the same name again: the script refuses to overwrite, and says so
  await p.v.send({ type: "draft", form: { name: "Acme CRM", url: "https://crm.acme.test", modules: "Contacts" } });
  assert.equal(p.v.last().state.form.result.product, "acme-crm", "the earlier result stays until a new form");
  await p.v.send({ type: "newForm" });
  const reset = p.v.posted.filter((m) => m.type === "state").at(-1).state.form;
  assert.deepEqual([reset.result, reset.reset, reset.open], [null, true, true], "a fresh, opened form");
  await p.v.send({ type: "draft", form: { name: "Acme CRM", url: "https://crm.acme.test", modules: "Contacts" } });
  assert.ok(p.v.last().state.form.errors.some((e) => /exists|already/i.test(e)), p.v.last().state.form.errors.join("; "));

  // a file that isn't there: the script's own error, inline
  await p.v.send({ type: "draft", form: { name: "Beta", url: "https://beta.test", modules: "Home", references: "docs/missing.md" } });
  assert.ok(p.v.last().state.form.errors.some((e) => /file not found: docs\/missing\.md/.test(e)));
  // the obvious gaps: said before anything runs
  await p.v.send({ type: "draft", form: { name: "", url: "" } });
  assert.deepEqual(p.v.last().state.form.errors.slice(0, 2), ["Give the product's name.", "Give the URL to test (http or https)."]);
});

test("the view's actions: run, doctor and config only for products it lists; files picked come back relative; the rest are ignored", async () => {
  const outside = path.join(tmpdir(), "elsewhere.md");
  const p = panelFixture({ openDialogs: [] });
  put(p.root, "config/acme.yaml", "product: acme\n");
  p.vscode.window.showOpenDialog = async () => [p.vscode.Uri.file(path.join(p.root, "docs", "req.md")), p.vscode.Uri.file(outside)];
  await p.v.send({ type: "run", product: "acme", environment: "default" });
  await p.v.send({ type: "doctor", product: "acme", environment: "default" });
  await p.v.send({ type: "openConfig", product: "acme", environment: "default" });
  await p.v.send({ type: "run", product: "ghost", environment: "default" });
  await p.v.send({ type: "login", product: "acme" });
  await p.v.send({ type: "login", product: "ghost" });
  await p.v.send({ type: "interview" });
  await p.v.send({ type: "command", id: "atf.refresh" });
  await p.v.send({ type: "command", id: "workbench.action.terminal.new" });
  await p.v.send({ type: "useNode", path: "/not/offered" });
  assert.deepEqual(p.acted, [
    ["run", { product: "acme", environment: "default" }],
    ["doctor", { product: "acme", environment: "default" }],
    ["openConfig", { product: "acme", environment: "default" }],
    ["login", "acme"],
    ["interview"],
    ["command", "atf.refresh"],
  ]);
  assert.match(p.vscode.rec.messages.at(-1)[1], /ghost \(default\) is not a product of this project/);
  assert.ok(p.output.lines.some((l) => l.includes("invalid message (command: id is one of")));
  assert.ok(p.output.lines.some((l) => l.includes("/not/offered is not a Node.js the check offered")));
  assert.deepEqual(p.vscode.rec.updates, [], "nothing pinned");
  await p.v.send({ type: "pickFiles", field: "references" });
  assert.deepEqual(p.v.last("files"), { type: "files", field: "references", paths: ["docs/req.md", outside] });
});

// ---- the Cockpit state (C2): the selected product, C1 for it, the new messages and their re-checks -----------------

const C1 = {
  schemaVersion: 1,
  product: "acme",
  environment: "default",
  run: { runId: "r1", mode: "readonly", active: true, modules: ["contacts", "deals"], steps: ["explore"] },
  overview: {
    stages: [
      { stage: "explore", module: "contacts", status: "done" },
      { stage: "playwright-ui", module: "contacts", status: "failed" },
      { stage: "report", module: null, status: "pending" },
    ],
    next: [],
    needsYou: [],
    intents: {
      contacts: { explore: { enabled: true, why: "" }, testcases: { enabled: false, why: "explore first" }, automate: { enabled: true, why: "" }, k6: { enabled: false, why: "no k6 step" }, heal: { enabled: true, why: "", stage: "playwright-ui" } },
    },
  },
  missing: [],
};

function cockpitFixture({ products = [{ product: "acme", environments: [{ name: "default", config: "config/acme.yaml", state: null }] }], runJson, actions = {} } = {}) {
  const root = tmp();
  const vscode = fakeVscode({ folders: [root] });
  const ctx = fakeContext();
  const output = vscode.window.createOutputChannel("atf");
  const workspace = { ok: true, root, state: "ok", message: undefined, products: () => products, onDidRefresh: () => ({ dispose() {} }), detect() {} };
  const calls = [];
  const cli = { runJson: async (...a) => (calls.push(a), runJson ? runJson(...a) : C1) };
  const environment = { state: { status: "done", rows: [], at: null, error: null }, check: async () => {}, onDidChange: () => ({ dispose() {} }), offered: () => false };
  const acted = [];
  const wired = Object.fromEntries(Object.keys(actions).map((n) => [n, (...a) => void acted.push([n, ...a])]));
  registerCockpit(ctx, { vscode, workspace, cli, output }, { environment, actions: wired, debounceMs: 0 });
  const v = fakeView();
  vscode.rec.webviewViews[0].provider.resolveWebviewView(v.view);
  return { root, vscode, v, calls, acted, output, workspace };
}
const ALL = { intent: 1, resume: 1, openSheet: 1, openTab: 1, sweep: 1 };

test("cockpit state: no products means no selection, no data, and no script run", async () => {
  const p = cockpitFixture({ products: [] });
  await p.v.send({ type: "ready" });
  await tick();
  assert.deepEqual(p.v.last().state.cockpit, { selected: null, loading: false, error: null, data: null });
  assert.equal(p.calls.length, 0);
});

test("cockpit state: the selected product's C1 through cockpit.mjs <product> --json, with ATF_ENV; loading is flagged", async () => {
  const p = cockpitFixture();
  await p.v.send({ type: "ready" });
  assert.equal(p.v.posted.filter((m) => m.type === "state").some((m) => m.state.cockpit.loading), true);
  await tick();
  const [args, opts] = p.calls[0];
  assert.deepEqual(args, ["acme", "--json"]);
  assert.equal(opts.script, path.join("scripts", "cockpit.mjs"));
  assert.deepEqual(opts.env, { ATF_ENV: "default" });
  const c = p.v.last().state.cockpit;
  assert.deepEqual(c.selected, { product: "acme", environment: "default" });
  assert.equal(c.loading, false);
  assert.equal(c.error, null);
  assert.deepEqual(Object.keys(c.data), ["run", "overview", "missing"]);
  assert.deepEqual(c.data.run.modules, ["contacts", "deals"]);
});

test("cockpit state: the first product with an active run is selected, else the first; select changes it and reloads", async () => {
  const products = [
    { product: "acme", environments: [{ name: "default", config: "c", state: null }] },
    { product: "beta", environments: [{ name: "default", config: "c", state: null }, { name: "staging", config: "c", state: null }] },
  ];
  const p = cockpitFixture({ products });
  put(p.root, "artifacts/beta/envs/staging/state/lock.json", "{}");
  await p.v.send({ type: "ready" });
  await tick();
  assert.deepEqual(p.v.last().state.cockpit.selected, { product: "beta", environment: "staging" });
  assert.deepEqual(p.calls[0][1].env, { ATF_ENV: "staging" });
  await p.v.send({ type: "select", product: "acme", environment: "default" });
  await tick();
  assert.deepEqual(p.v.last().state.cockpit.selected, { product: "acme", environment: "default" });
  assert.deepEqual(p.calls.at(-1)[0], ["acme", "--json"]);
  await p.v.send({ type: "select", product: "ghost", environment: "default" });
  assert.deepEqual(p.v.last().state.cockpit.selected, { product: "acme", environment: "default" }, "an unlisted product is refused");
  assert.match(p.output.lines.at(-1), /ghost .*not a product/);
});

test("cockpit state: a runJson error (or C1's own error object) becomes the error in words, with no data", async () => {
  const failed = new CliError("node cockpit.mjs acme --json printed no JSON (exit 1)", { code: 1, reason: "it stopped without a result" });
  const p = cockpitFixture({ runJson: async () => Promise.reject(failed) });
  await p.v.send({ type: "ready" });
  await tick();
  const c = p.v.last().state.cockpit;
  assert.equal(c.error, "Couldn't load acme: it stopped without a result. The atf output has the details.");
  assert.equal(c.data, null);
  assert.equal(c.loading, false);
  // cockpit.mjs exits 1 with its {"error"}: allowed, so the script's own words are shown, never "exit 1"
  const q = cockpitFixture({ runJson: async () => ({ error: "unknown product 'acme'" }) });
  await q.v.send({ type: "ready" });
  await tick();
  assert.deepEqual(q.calls[0][1].allowExit, [0, 1]);
  assert.equal(q.v.last().state.cockpit.error, "Couldn't load acme: unknown product 'acme'. The atf output has the details.");
  assert.doesNotMatch(q.v.last().state.cockpit.error, /cockpit\.mjs|exit \d/);
});

test("cockpit state: a relevant file change reloads C1 (debounced); an irrelevant one does not", async () => {
  const p = cockpitFixture();
  await p.v.send({ type: "ready" });
  await tick();
  const n = p.calls.length;
  const w = p.vscode.rec.watchers.find((x) => String(x.pattern?.pattern ?? "").startsWith("artifacts/*/state"));
  assert.ok(w, "a watcher on the runs' state");
  w.change.fire({ fsPath: path.join(p.root, "README.md") });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.calls.length, n);
  w.change.fire({ fsPath: path.join(p.root, "artifacts", "acme", "state", "run.json") });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(p.calls.length, n + 1);
});

test("cockpit messages: intent, resume, openSheet, openTab and the ledger sweep reach the actions with checked targets", async () => {
  const p = cockpitFixture({ actions: ALL });
  await p.v.send({ type: "ready" });
  await tick();
  const t = { product: "acme", environment: "default" };
  await p.v.send({ type: "intent", ...t, module: "contacts", intent: "explore" });
  await p.v.send({ type: "intent", ...t, module: "contacts", intent: "heal" });
  await p.v.send({ type: "resume", ...t, stage: "playwright-ui", module: "contacts" });
  await p.v.send({ type: "resume", ...t, stage: "report", module: null });
  await p.v.send({ type: "openSheet", product: "acme", module: "deals", sheet: "approval" });
  await p.v.send({ type: "openTab", ...t, tab: "failures", focus: { module: "contacts", stage: "playwright-ui" } });
  await p.v.send({ type: "openTab", ...t, tab: "timeline" });
  await p.v.send({ type: ["sw", "eep"].join(""), ...t });
  assert.deepEqual(p.acted, [
    ["intent", { ...t, module: "contacts", intent: "explore" }],
    ["intent", { ...t, module: "contacts", intent: "heal", healStage: "playwright-ui" }],
    ["resume", { ...t, stage: "playwright-ui", module: "contacts" }],
    ["resume", { ...t, stage: "report", module: null }],
    ["openSheet", { product: "acme", module: "deals", sheet: "approval" }],
    ["openTab", { ...t, tab: "failures", focus: { module: "contacts", stage: "playwright-ui" } }],
    ["openTab", { ...t, tab: "timeline" }],
    [["sw", "eep"].join(""), t],
  ]);
});

test("cockpit messages: refusals (unknown product, module, stage, a disabled intent, bad fields) call nothing and say why", async () => {
  const p = cockpitFixture({ actions: ALL });
  await p.v.send({ type: "ready" });
  await tick();
  const t = { product: "acme", environment: "default" };
  const before = p.output.lines.length;
  const sw = ["sw", "eep"].join("");
  await p.v.send({ type: "intent", product: "ghost", environment: "default", module: "contacts", intent: "explore" });
  await p.v.send({ type: "intent", ...t, module: "nowhere", intent: "explore" });
  await p.v.send({ type: "intent", ...t, module: "contacts", intent: "testcases" }); // disabled in C1
  await p.v.send({ type: "intent", ...t, module: "deals", intent: "explore" }); // a module with no intents
  await p.v.send({ type: "intent", ...t, module: "contacts", intent: "delete" });
  await p.v.send({ type: "resume", ...t, stage: "k6", module: "contacts" });
  await p.v.send({ type: "resume", ...t, stage: "explore", module: null }); // that stage is module-scoped
  await p.v.send({ type: "openSheet", product: "acme", module: "nowhere", sheet: "approval" });
  await p.v.send({ type: "openSheet", product: "acme", module: "deals", sheet: "../x" });
  await p.v.send({ type: "openTab", ...t, tab: "nope" });
  await p.v.send({ type: "openTab", ...t, tab: "trace", focus: { module: "nowhere" } });
  await p.v.send({ type: sw, product: "acme", environment: "../x" });
  await p.v.send({ type: sw, product: "acme", environment: "default", extra: 1 });
  assert.deepEqual(p.acted, []);
  assert.equal(p.output.lines.length - before, 13, "one line for each");
  assert.ok(p.output.lines.some((l) => /explore first/.test(l)));
});

test("cockpit messages: before C1 has loaded (or after an error) a module-scoped message is refused; a missing action is logged and ignored", async () => {
  const sw = ["sw", "eep"].join("");
  const p = cockpitFixture({ runJson: async () => Promise.reject(new Error("boom")), actions: { [sw]: 1 } });
  await p.v.send({ type: "ready" });
  await tick();
  const t = { product: "acme", environment: "default" };
  await p.v.send({ type: "intent", ...t, module: "contacts", intent: "explore" });
  assert.deepEqual(p.acted, []);
  await p.v.send({ type: sw, ...t });
  assert.deepEqual(p.acted, [[sw, t]]);
  const q = cockpitFixture({ actions: {} });
  await q.v.send({ type: "ready" });
  await tick();
  await q.v.send({ type: sw, product: "acme", environment: "default" });
  await q.v.send({ type: "intent", product: "acme", environment: "default", module: "contacts", intent: "explore" });
  assert.deepEqual(q.acted, []);
  assert.ok(q.output.lines.some((l) => /intent action is not wired/.test(l)));
  assert.ok(q.output.lines.some((l) => new RegExp(`${sw} action is not wired`).test(l)));
});
