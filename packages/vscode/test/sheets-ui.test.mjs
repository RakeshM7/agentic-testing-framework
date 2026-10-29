// The sheets' VS Code layer with a stub vscode: the tree models and their counts, the approve action (a terminal
// running exactly `atf approve <product> <module>`, never runJson), the webview's messages validated both ways, the
// page's CSP, and an editor's load / save / conflict round trip.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { approveArgs, approveModule, targetOf } from "../src/sheets/commands.js";
import { validateHostMessage, validateWebviewMessage } from "../src/sheets/messages.js";
import { scanApprovals, scanClarifications, evidenceFiles, resolveEvidence } from "../src/sheets/scan.js";
import { CONTEXT, SheetTree, approvalsChildren, approvalsItem, clarificationsChildren, clarificationsItem } from "../src/sheets/trees.js";
import { csp, escapeHtml, makeNonce, renderHtml } from "../src/sheets/webview.js";
import { registerSheets, rootOf } from "../src/sheets/index.js";
import { realSheets } from "./sheets-fixtures.mjs";

// ---- a stub of the vscode API, recording what the extension does ----
function stubVscode({ answers = [] } = {}) {
  const calls = { terminals: [], warnings: [], executed: [], panels: [], trees: {}, commands: {}, opened: [] };
  class EventEmitter {
    constructor() {
      this.listeners = [];
      this.event = (fn) => (this.listeners.push(fn), { dispose() {} });
    }
    fire(x) {
      this.listeners.forEach((fn) => fn(x));
    }
    dispose() {}
  }
  const disposable = { dispose() {} };
  const Uri = { file: (fsPath) => ({ fsPath, scheme: "file", toString: () => `file://${fsPath}` }), from: (c) => ({ ...c, toString: () => `${c.scheme}:${c.path}?${c.query}` }) };
  const vscode = {
    EventEmitter, Uri, ViewColumn: { Active: -1 },
    TreeItem: class { constructor(label, collapsibleState) { Object.assign(this, { label, collapsibleState }); } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    RelativePattern: class { constructor(base, pattern) { Object.assign(this, { base, pattern }); } },
    window: {
      registerTreeDataProvider: (id, p) => ((calls.trees[id] = p), disposable),
      createWebviewPanel: (viewType, title, column, options) => {
        const handlers = { message: [], dispose: [] };
        const panel = {
          viewType, title, options, posted: [],
          webview: { html: "", cspSource: "vscode-webview:", postMessage(m) { panel.posted.push(m); return Promise.resolve(true); }, onDidReceiveMessage: (fn) => (handlers.message.push(fn), disposable) },
          onDidDispose: (fn) => (handlers.dispose.push(fn), disposable),
          reveal() { panel.revealed = (panel.revealed ?? 0) + 1; },
          dispose() { handlers.dispose.forEach((fn) => fn()); },
          send: async (m) => { for (const fn of handlers.message) await fn(m); },
        };
        calls.panels.push(panel);
        return panel;
      },
      showWarningMessage: async (text, _opts, ...items) => (calls.warnings.push({ text, items }), answers.shift()),
      showInformationMessage: async () => undefined,
      showErrorMessage: async (text) => calls.warnings.push({ text, error: true }),
      showQuickPick: async (items) => items[0],
      showTextDocument: async (uri) => calls.opened.push(uri.fsPath),
    },
    workspace: {
      createFileSystemWatcher: () => ({ onDidChange: () => disposable, onDidCreate: () => disposable, onDidDelete: () => disposable, dispose() {} }),
      registerTextDocumentContentProvider: () => disposable,
    },
    commands: {
      registerCommand: (id, fn) => ((calls.commands[id] = fn), disposable),
      executeCommand: async (id, ...args) => (calls.executed.push([id, ...args]), id in calls.commands ? calls.commands[id](...args) : undefined),
    },
  };
  return { vscode, calls };
}
const stubCli = () => {
  const cli = {
    terminals: [],
    runInTerminal: async (args, opts) => void cli.terminals.push({ args, opts }),
    runJson: async () => {
      throw new Error("runJson must not be called by the sheets");
    },
  };
  return cli;
};

test("the trees: product -> module -> rows/cases, with the counts and the menu context values", async () => {
  const { root, ids } = await realSheets();
  const clar = await scanClarifications(root);
  assert.deepEqual(clar.map((p) => [p.product, p.counts]), [["acme", { total: 3, open: 2, proposed: 1, answered: 0 }]]);
  const { vscode } = stubVscode();
  const [product] = clarificationsChildren(clar);
  assert.equal(clarificationsItem(vscode, product).description, "2 open · 1 awaiting approval · 0 answered");
  const [module] = clarificationsChildren(clar, product);
  assert.deepEqual([module.module, clarificationsItem(vscode, module).command.arguments], ["contacts", [{ product: "acme", module: "contacts" }]]);
  const rows = clarificationsChildren(clar, module);
  assert.deepEqual(rows.map((r) => [r.id, r.state]), [["contacts-1", "proposed"], ["contacts-2", "open"], ["contacts-3", "open"]]);
  const rowItem = clarificationsItem(vscode, rows[0]);
  assert.equal(rowItem.contextValue, CONTEXT.clarificationRow);
  assert.equal(rowItem.contextValue, "atf.clarificationRow");
  assert.deepEqual(rowItem.command.arguments, [{ product: "acme", module: "contacts", id: "contacts-1" }]);

  const apprData = await scanApprovals(root);
  assert.deepEqual(apprData[0].counts, { cases: 3, pending: 3, approved: 0, rejected: 0, changes: 0, toRecord: 0, stale: 0 });
  const [ap] = approvalsChildren(apprData);
  const [am] = approvalsChildren(apprData, ap);
  const amItem = approvalsItem(vscode, am);
  assert.equal(amItem.contextValue, "atf.approvalModule");
  assert.equal(amItem.description, "3 pending · 0 approved");
  assert.deepEqual(approvalsChildren(apprData, am).map((c) => c.id), [...ids.values()]);

  // a provider scans once per refresh, and refresh tells VS Code to ask again
  let scans = 0;
  const tree = new SheetTree(vscode, { load: async () => (scans++, clar), children: clarificationsChildren, item: clarificationsItem });
  let fired = 0;
  tree.onDidChangeTreeData(() => fired++);
  await tree.getChildren();
  await tree.getChildren(product);
  tree.refresh();
  await tree.getChildren();
  assert.deepEqual([scans, fired], [2, 1]);
});

test("an unreadable sheet is listed with its error, not hidden", async () => {
  const { root, files } = await realSheets();
  writeFileSync(files.clarifications, "ID;Module\r\n");
  const [p] = await scanClarifications(root);
  assert.match(p.modules[0].error, /header must be exactly/);
  assert.match(clarificationsItem(stubVscode().vscode, clarificationsChildren([p], { kind: "product", product: "acme" })[0]).description, /^unreadable/);
});

test("approve: a terminal running exactly [approve, product, module]; never runJson; unsaved edits ask first", async () => {
  assert.deepEqual(approveArgs({ product: "acme", module: "contacts" }), ["approve", "acme", "contacts"]);
  for (const bad of [{}, { product: "acme" }, { product: "acme", module: "Contacts" }, { product: "acme", module: "x; rm -rf /" }, { product: "../x", module: "m" }])
    assert.throws(() => approveArgs(bad), /needs a product and a module/);
  const cli = stubCli();
  assert.equal(await approveModule({ product: "acme", module: "contacts", kind: "module" }, { cli, cwd: "/ws" }), true);
  assert.deepEqual(cli.terminals, [{ args: ["approve", "acme", "contacts"], opts: { name: "approve contacts", cwd: "/ws" } }]);
  const declined = await approveModule({ product: "acme", module: "contacts" }, { cli, hasUnsaved: () => true, confirmUnsaved: async () => false });
  assert.equal(declined, false);
  assert.equal(cli.terminals.length, 1, "cancelled: no terminal");
  assert.deepEqual(targetOf({ product: "acme", module: "contacts", id: "contacts-1", extra: 1 }), { product: "acme", module: "contacts", id: "contacts-1" });
});

test("webview -> extension: only known messages with exact fields; extension -> webview: checked before rendering", () => {
  const ok = (m, kind) => validateWebviewMessage(m, kind).ok;
  assert.ok(ok({ type: "ready" }, "clarifications"));
  assert.ok(ok({ type: "save", edits: [{ id: "c-1", answer: "x", approve: false }] }, "clarifications"));
  assert.ok(ok({ type: "save", edits: [{ id: "TC-c-1", approved: "yes", comment: "" }] }, "approval"));
  assert.ok(ok({ type: "approveModule" }, "approval"));
  assert.ok(ok({ type: "openEvidence", id: "c-1", file: "clarification-evidence/c-1/observation.md" }, "clarifications"));
  for (const [m, kind] of [
    [null, "approval"], ["save", "approval"], [{ type: "eval", code: "x" }, "approval"], [{ type: "ready", extra: 1 }, "approval"],
    [{ type: "approveModule" }, "clarifications"], [{ type: "openEvidence", id: "c-1", file: "x" }, "approval"],
    [{ type: "save", edits: [{ id: "c-1", answer: "x" }] }, "clarifications"], [{ type: "save", edits: [{ id: "c-1", answer: "x", approve: false, answerStatus: "human-approved" }] }, "clarifications"],
    [{ type: "save", edits: [{ id: "TC-1", approved: "yes", comment: "", version: "v1" }] }, "approval"], [{ type: "save", edits: "all" }, "approval"],
    [{ type: "save", edits: [{ id: "", approved: "yes", comment: "" }] }, "approval"], [{ type: "save", edits: [{ id: "TC-1", approved: "yes", comment: "x".repeat(40000) }] }, "approval"],
    [{ type: "save", edits: Array.from({ length: 5001 }, (_, i) => ({ id: `TC-${i}`, approved: "", comment: "" })) }, "approval"], [{ type: "ready" }, "other"],
  ]) assert.equal(ok(m, kind), false, JSON.stringify(m)?.slice(0, 80));

  const load = { type: "load", kind: "approval", title: "t", readOnly: false, error: null, draft: [], notice: null, sheet: { counts: {}, rows: [{ id: "TC-1", title: "", keySteps: "", expected: "", priority: "p1", approved: "", comment: "", run: "", version: "v1", sheet: "current", recorded: "awaiting" }] } };
  assert.equal(validateHostMessage(load), true);
  assert.equal(validateHostMessage({ type: "status", level: "error", text: "x" }), true);
  assert.equal(validateHostMessage({ ...load, sheet: { ...load.sheet, rows: [{ ...load.sheet.rows[0], title: { html: "<b>" } }] } }), false);
  assert.equal(validateHostMessage({ ...load, notice: { level: "fatal", text: "x" } }), false);
  assert.equal(validateHostMessage({ type: "status", level: "info" }), false);
  assert.equal(validateHostMessage({ type: "script", src: "x" }), false);
  assert.equal(validateHostMessage({ ...load, kind: "clarifications", sheet: { counts: {}, rows: [{ id: "c-1" }] } }), false);
});

test("the page: a strict CSP with a per-page nonce, nothing remote, the title escaped, a script that parses", () => {
  const nonce = makeNonce();
  assert.notEqual(nonce, makeNonce());
  const html = renderHtml({ kind: "clarifications", title: '<img src=x onerror="alert(1)">', nonce });
  assert.match(html, new RegExp(`content="${csp(nonce).replace(/[+/]/g, "\\$&")}"`));
  assert.match(csp(nonce), /^default-src 'none'; style-src 'nonce-[^']+'; script-src 'nonce-[^']+'/);
  assert.doesNotMatch(html, /https?:\/\//, "no remote URL anywhere in the page");
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.equal((html.match(new RegExp(`nonce="${nonce.replace(/[+/]/g, "\\$&")}"`, "g")) ?? []).length, 2, "the style and the script carry the nonce");
  const script = html.slice(html.indexOf(">", html.indexOf("<script")) + 1, html.lastIndexOf("</script>"));
  assert.doesNotThrow(() => new Function(script), "the embedded script is valid JavaScript on its own");
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/, "values go in with textContent only");
  assert.throws(() => renderHtml({ kind: "clarifications", title: "t", nonce: "short" }), /nonce/);
  assert.throws(() => renderHtml({ kind: "x", title: "t", nonce }), /unknown sheet kind/);
  assert.equal(escapeHtml(`<a href='x'>&"`), "&lt;a href=&#39;x&#39;&gt;&amp;&quot;");
});

test("evidence: only the files offered for that row, inside the module, and never a credentials file", async () => {
  const { root } = await realSheets();
  const dir = path.join(root, "artifacts", "acme", "modules", "contacts", "clarification-evidence", "contacts-1");
  mkdirSync(dir, { recursive: true });
  for (const f of ["observation.md", "snapshot-1.md", ".env", "step-1.png"]) writeFileSync(path.join(dir, f), "x");
  const row = { id: "contacts-1", notes: "Evidence: clarification-evidence/contacts-1/observation.md\nEvidence: ../../../.auth/state.json" };
  const offered = await evidenceFiles(root, "acme", "contacts", row);
  assert.deepEqual(offered, ["clarification-evidence/contacts-1/observation.md", "../../../.auth/state.json", "clarification-evidence/contacts-1/snapshot-1.md", "clarification-evidence/contacts-1/step-1.png"].filter((f) => !f.includes(".auth")));
  assert.equal(resolveEvidence(root, "acme", "contacts", offered, "clarification-evidence/contacts-1/observation.md"), path.join(dir, "observation.md"));
  for (const bad of ["clarification-evidence/contacts-1/.env", "../../state/run.json", "/etc/passwd", "clarification-evidence/contacts-2/observation.md"]) assert.equal(resolveEvidence(root, "acme", "contacts", [...offered, "../../state/run.json"], bad), null, bad);
});

test("registerSheets: the views, the commands, an editor's load / save / conflict, and approve from the editor", async () => {
  const { root, ids, files } = await realSheets();
  const { vscode, calls } = stubVscode({ answers: ["Reload (discard my edits)"] });
  const cli = stubCli();
  const lines = [];
  const context = { subscriptions: [] };
  const api = registerSheets(context, { vscode, workspace: { current: () => ({ root }) }, cli, output: { appendLine: (l) => lines.push(l) } });
  assert.equal(rootOf({ root }), root);
  assert.ok(calls.trees["atf.clarifications"] && calls.trees["atf.approvals"]);
  assert.deepEqual(Object.keys(calls.commands).sort(), ["atf.approveModule", "atf.openApproval", "atf.openClarifications"]);
  assert.equal(typeof api.refresh, "function");

  await calls.commands["atf.openApproval"]({ product: "acme", module: "contacts" });
  const panel = calls.panels[0];
  assert.deepEqual(panel.options.localResourceRoots, []);
  assert.match(panel.webview.html, /Content-Security-Policy/);
  await panel.send({ type: "ready" });
  const load = panel.posted.at(-1);
  assert.equal(validateHostMessage(load), true);
  assert.equal(load.sheet.rows.length, 3);

  // a forged message is refused and logged; nothing is written
  const before = readFileSync(files.approval, "utf8");
  await panel.send({ type: "save", edits: [{ id: ids.get("list"), approved: "yes", comment: "", version: "v0" }] });
  assert.equal(readFileSync(files.approval, "utf8"), before);
  assert.match(lines.at(-1), /refused a webview message/);
  // an invalid value is refused with a status message
  await panel.send({ type: "save", edits: [{ id: ids.get("list"), approved: "sure", comment: "" }] });
  assert.match(panel.posted.at(-1).text, /Nothing was saved/);

  await panel.send({ type: "save", edits: [{ id: ids.get("list"), approved: "yes", comment: "fine" }] });
  assert.match(readFileSync(files.approval, "utf8"), new RegExp(`${ids.get("list")},.*,yes,fine,`));
  assert.equal(panel.posted.at(-1).text.includes("Nothing is approved yet"), true);

  // the file changes on disk under unsaved edits: the save is refused, the human chooses reload
  const now = readFileSync(files.approval, "utf8");
  writeFileSync(files.approval, now.replace(",yes,fine,", ",no,changed elsewhere,"));
  await panel.send({ type: "draft", edits: [{ id: ids.get("create"), approved: "yes", comment: "" }] });
  await panel.send({ type: "save", edits: [{ id: ids.get("create"), approved: "yes", comment: "" }] });
  assert.match(calls.warnings.at(-1).text, /changed on disk since you opened it/);
  assert.match(readFileSync(files.approval, "utf8"), /,no,changed elsewhere,/);
  assert.doesNotMatch(readFileSync(files.approval, "utf8"), new RegExp(`${ids.get("create")},.*,yes,`));
  assert.deepEqual(panel.posted.at(-1).draft, [], "reloaded: the edits were discarded");

  // approve from the editor goes through the command: a terminal, exactly [approve, product, module]
  await panel.send({ type: "approveModule" });
  assert.deepEqual(cli.terminals.map((t) => t.args), [["approve", "acme", "contacts"]]);
  // the editor is reused for the same sheet
  await calls.commands["atf.openApproval"]({ product: "acme", module: "contacts" });
  assert.equal(calls.panels.length, 1);
  assert.equal(panel.revealed, 1);

  // the clarifications editor offers a proposed answer for approval and saves it as the human's approval
  await calls.commands["atf.openClarifications"]({ product: "acme", module: "contacts", id: "contacts-1" });
  const cp = calls.panels[1];
  await cp.send({ type: "ready" });
  const row = cp.posted.at(-1).sheet.rows[0];
  assert.equal(row.state, "proposed");
  await cp.send({ type: "save", edits: [{ id: "contacts-1", answer: row.answer, approve: true }] });
  assert.match(readFileSync(files.clarifications, "utf8"), /,human-approved,/);
  await cp.send({ type: "openEvidence", id: "contacts-1", file: "../../state/run.json" });
  assert.match(cp.posted.at(-1).text, /Not an evidence file/);

  api.dispose();
});

// The page's script, run against a minimal DOM: it renders both sheets from valid messages with text nodes only, and
// ignores a message that fails validation.
function runPage(kind) {
  const html = renderHtml({ kind, title: "t", nonce: makeNonce() });
  const script = html.slice(html.indexOf(">", html.indexOf("<script")) + 1, html.lastIndexOf("</script>"));
  const posted = [];
  let onMessage;
  const node = (tag) => {
    const n = { tag, kids: [], listeners: {}, className: "", textContent: "", value: "", setAttribute() {}, addEventListener: (ev, fn) => (n.listeners[ev] = fn) };
    n.append = (...k) => {
      // what a real DOM would render as "null" or "[object …]"
      for (const x of k) assert.ok(x && typeof x === "object" && !Array.isArray(x), `append(${JSON.stringify(x)?.slice(0, 40)})`);
      n.kids.push(...k);
    };
    n.replaceChildren = () => (n.kids = []);
    return n;
  };
  const app = node("div");
  const g = { acquireVsCodeApi: () => ({ postMessage: (m) => posted.push(m) }), document: { getElementById: () => app, createElement: node, createTextNode: (t) => ({ tag: "#text", textContent: t, kids: [] }) }, window: { addEventListener: (_t, fn) => (onMessage = fn) } };
  new Function("acquireVsCodeApi", "document", "window", script)(g.acquireVsCodeApi, g.document, g.window);
  const text = (n = app) => [n.textContent, n.value, ...(n.kids ?? []).map(text)].filter(Boolean).join(" ");
  const find = (pred, n = app) => (pred(n) ? n : (n.kids ?? []).map((k) => find(pred, k)).find(Boolean));
  return { posted, send: (data) => onMessage({ data }), text, find, app };
}

test("the page's script renders a sheet from a valid message as text, and ignores an invalid one", () => {
  const page = runPage("clarifications");
  assert.deepEqual(page.posted, [{ type: "ready" }]);
  const row = { id: "c-1", question: "<b>Is it?</b>", steps: "1. Do.", answer: "Basis: observed", answerStatus: "agent-proposed", notes: "", runId: "r", state: "proposed", problems: [], evidence: ["clarification-evidence/c-1/observation.md"] };
  page.send({ type: "load", kind: "clarifications", title: "t", readOnly: false, error: null, draft: [], notice: null, sheet: { layout: "current", counts: { total: 1, open: 0, proposed: 1, answered: 0 }, rows: [row] } });
  assert.match(page.text(), /<b>Is it\?<\/b>/, "the question is a text node, not markup");
  // approve the proposed answer, then save: the message carries exactly the edit
  page.find((n) => n.tag === "button" && /Approve this answer/.test(n.textContent)).listeners.click();
  assert.deepEqual(page.posted.at(-1), { type: "draft", edits: [{ id: "c-1", answer: "Basis: observed", approve: true }] });
  page.find((n) => n.tag === "button" && /^Save/.test(n.textContent)).listeners.click();
  assert.deepEqual(page.posted.at(-1), { type: "save", edits: [{ id: "c-1", answer: "Basis: observed", approve: true }] });
  page.find((n) => n.tag === "button" && n.textContent === row.evidence[0]).listeners.click();
  assert.deepEqual(page.posted.at(-1), { type: "openEvidence", id: "c-1", file: row.evidence[0] });
  const before = page.text();
  page.send({ type: "load", kind: "clarifications", title: "forged", readOnly: false, error: null, draft: [], sheet: { counts: {}, rows: [{ id: { toString: () => "x" } }] } });
  assert.equal(page.text(), before, "an invalid message changes nothing");

  const ap = runPage("approval");
  ap.send({ type: "load", kind: "approval", title: "t", readOnly: false, error: null, draft: [], notice: null, sheet: { delimiter: ",", missing: [], stale: true, built: true, missingCases: ["TC-c-9"], changed: ["TC-c-2"], unreadable: [], counts: { cases: 2, pending: 2, approved: 0, rejected: 0, changes: 0, toRecord: 0 }, rows: [
    { id: "TC-c-1", title: "Lists", keySteps: "1. Open", expected: "listed", priority: "p1", approved: "", understood: true, comment: "", run: "r", version: "v1", sheet: "current", recorded: "awaiting", toRecord: false },
    { id: "TC-c-2", title: "Old", keySteps: "", expected: "", priority: "p2", approved: "", understood: true, comment: "", run: "r", version: "v2", sheet: "changed", recorded: "awaiting", toRecord: false },
  ] } });
  assert.match(ap.text(), /out of date against the test cases/);
  const selects = [];
  ap.find((n) => (n.tag === "select" && selects.push(n), false));
  assert.deepEqual(selects.map((s) => !!s.disabled), [false, true], "no decision on a row changed since rendered");
  selects[0].listeners.change({ target: { value: "yes" } });
  assert.deepEqual(ap.posted.at(-1), { type: "draft", edits: [{ id: "TC-c-1", approved: "yes", comment: "" }] });
  ap.find((n) => n.tag === "button" && n.textContent === "Approve module…").listeners.click();
  assert.deepEqual(ap.posted.at(-1), { type: "approveModule" });
});
