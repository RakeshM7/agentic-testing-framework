// src/report.js, its pure core (no vscode): finding a run's report, the render fallback, the HTML rewrite and the CSP,
// over the framework's real deck (collected and rendered by packages/core) as well as hand-written pages; and the
// command's VS Code layer over a fake vscode.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { collect } from "../../core/scripts/report-data.mjs";
import { renderDeck } from "../../core/scripts/lib/report.mjs";
import { startRun } from "../../core/scripts/test-helpers.mjs";
import { buildCsp, environmentOf, findReport, isRelativeUrl, listReports, makeNonce, registerReport, renderFallback, reportDir, resolveInside, rewriteHtml, runOf } from "../src/report.js";

const put = (root, rel, content = "x") => {
  const f = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, content);
  return f;
};
const temp = () => mkdtempSync(path.join(tmpdir(), "atf-vscode-report-"));
const NONCE = "n0nce_ABC-123";
const CSP = buildCsp({ cspSource: "https://file+.vscode-resource.vscode-cdn.net", nonce: NONCE });
const DIR = path.resolve("/ws/artifacts/acme/results/r1/report");
const toUri = (file) => `vscode-resource:${path.relative(DIR, file).split(path.sep).join("/")}`;
const rewrite = (html) => rewriteHtml(html, { dir: DIR, nonce: NONCE, csp: CSP, toUri });

// ---- finding reports ----

test("reportDir is the contract's results/<run>/report; ids that could leave artifacts/ are refused", () => {
  assert.equal(reportDir("/ws", "acme", "acme-20261011-1721"), path.join("/ws", "artifacts", "acme", "results", "acme-20261011-1721", "report"));
  for (const [p, r] of [["..", "r"], ["acme", "../x"], ["acme", "a/b"], ["acme", "a\\b"], ["", "r"], ["acme", ".hidden"], ["acme", "a..b"]]) assert.throws(() => reportDir("/ws", p, r), /not a product and run id/);
});

test("findReport: html when index.html exists, data with report.json only, none otherwise", () => {
  const root = temp();
  assert.equal(findReport(root, "acme", "r1").state, "none");
  put(root, "artifacts/acme/results/r1/report/report.json", "{}");
  assert.equal(findReport(root, "acme", "r1").state, "data");
  const html = put(root, "artifacts/acme/results/r1/report/index.html", "<html></html>");
  const r = findReport(root, "acme", "r1");
  assert.equal(r.state, "html");
  assert.equal(r.html, html);
  assert.equal(r.dir, path.dirname(html));
});

test("listReports: every run with a report, rendered or not, newest first; runs without one are left out", () => {
  const root = temp();
  const old = put(root, "artifacts/acme/results/r1/report/index.html");
  const mid = put(root, "artifacts/beta/results/b1/report/report.json");
  const recent = put(root, "artifacts/acme/results/r2/report/index.html");
  put(root, "artifacts/acme/results/r3/acme/k6/results.json"); // a run that never reached the report stage
  put(root, "artifacts/acme/state/run.json", "{}");
  utimesSync(old, 1000, 1000);
  utimesSync(mid, 2000, 2000);
  utimesSync(recent, 3000, 3000);
  assert.deepEqual(listReports(root).map((r) => [r.product, r.runId, r.state]), [["acme", "r2", "html"], ["beta", "b1", "data"], ["acme", "r1", "html"]]);
  assert.deepEqual(listReports(temp()), [], "no artifacts/ folder: no reports");
});

test("runOf: a Runs tree item or { product, runId }; anything else is null", () => {
  assert.deepEqual(runOf({ product: "acme", runId: "r1" }), { product: "acme", runId: "r1" });
  assert.deepEqual(runOf({ contextValue: "atf.run", run: { product: "acme", runId: "r1" } }), { product: "acme", runId: "r1" });
  assert.deepEqual(runOf({ product: "acme", run: { runId: "r1" } }), { product: "acme", runId: "r1" });
  for (const x of [undefined, null, "acme", {}, { product: "acme" }, { product: "acme", runId: "../r" }]) assert.equal(runOf(x), null);
});

// ---- the render fallback ----

test("renderFallback: report.mjs render for the product's current run, with ATF_ENV for another environment", () => {
  const root = temp();
  const fw = path.join(root, "node_modules", "@testagentic", "atf");
  put(root, "artifacts/acme/state/run.json", JSON.stringify({ runId: "r1" }));
  put(root, "artifacts/acme/envs/staging/state/run.json", JSON.stringify({ runId: "r2" }));
  put(root, "artifacts/acme/envs/broken/state/run.json", "{ not json");

  assert.equal(environmentOf(root, "acme", "r1"), "default");
  assert.equal(environmentOf(root, "acme", "r2"), "staging");
  assert.equal(environmentOf(root, "acme", "r0"), null);

  const def = renderFallback({ root, framework: fw, product: "acme", runId: "r1" });
  assert.deepEqual(def.command.args, ["node", path.join(fw, "scripts", "report.mjs"), "render", "acme"]);
  assert.deepEqual(def.command.env, {});
  assert.equal(def.command.display, "node node_modules/@testagentic/atf/scripts/report.mjs render acme", "shown relative to the workspace, with / on every system");
  assert.match(def.text, /no index\.html/);
  assert.ok(def.text.includes(def.command.display));

  const staging = renderFallback({ root, framework: fw, product: "acme", runId: "r2" });
  assert.deepEqual(staging.command.env, { ATF_ENV: "staging" });
  assert.match(staging.command.display, /^ATF_ENV=staging node /);

  const old = renderFallback({ root, framework: fw, product: "acme", runId: "r0" });
  assert.equal(old.command, null, "render works on the current run only: nothing to run for an older one");
  assert.match(old.text, /no longer the product's current run/);
});

// ---- the CSP ----

test("buildCsp: nothing by default, no network, scripts and styles only from the webview's folder or with the nonce", () => {
  const csp = buildCsp({ cspSource: "vscode-src", nonce: NONCE });
  const d = Object.fromEntries(csp.split("; ").map((x) => [x.split(" ")[0], x.split(" ").slice(1).join(" ")]));
  assert.equal(d["default-src"], "'none'");
  assert.equal(d["script-src"], `vscode-src 'nonce-${NONCE}'`);
  assert.equal(d["style-src"], `vscode-src 'nonce-${NONCE}'`);
  assert.equal(d["img-src"], "vscode-src");
  assert.equal(d["base-uri"], "'none'");
  assert.equal(d["form-action"], "'none'");
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https?:|data:|\*/, "no inline without a nonce, no eval, no remote or data: sources");
  assert.throws(() => buildCsp({ cspSource: "x", nonce: "bad nonce'" }), /nonce/);
  assert.throws(() => buildCsp({ nonce: NONCE }), /cspSource/);
});

test("makeNonce: url-safe, unpredictable, CSP-valid", () => {
  const a = makeNonce();
  assert.match(a, /^[A-Za-z0-9_-]{24}$/);
  assert.notEqual(a, makeNonce());
  assert.doesNotThrow(() => buildCsp({ cspSource: "x", nonce: a }));
});

// ---- the HTML rewrite ----

test("rewriteHtml over the framework's real deck: CSP first in <head>, the nonce on its inline style and script, content intact", async () => {
  const { root } = startRun();
  const deck = renderDeck(await collect("acme", { root }));
  const { html, blocked } = rewrite(deck);
  assert.deepEqual(blocked, []);
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  assert.match(head, /^<head>\n<meta http-equiv="Content-Security-Policy" content="[^"]+">/, "the policy precedes every style and script");
  assert.equal((html.match(/<style nonce="n0nce_ABC-123">/g) ?? []).length, (deck.match(/<style>/g) ?? []).length);
  assert.equal((html.match(/<script nonce="n0nce_ABC-123">/g) ?? []).length, (deck.match(/<script>/g) ?? []).length);
  assert.ok((deck.match(/<script>/g) ?? []).length >= 1, "the deck has its inline script");
  // the deck's own behaviour: its slides, controls and key handling come through untouched
  const strip = (s) => s.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\n?/, "").replace(/ nonce="[^"]*"/g, "");
  assert.equal(strip(html), deck);
  assert.match(html, /addEventListener\("keydown"/);
  assert.match(html, /id="prev"/);
  assert.doesNotMatch(html, /\son[a-z]+=/i, "no inline event handler that the CSP would block");
});

test("rewriteHtml: relative assets become webview URIs inside the report folder; escapes and absolute paths are dropped", () => {
  const page = [
    "<!doctype html><html><head><title>t</title>",
    '<link rel="stylesheet" href="deck.css?v=2#x">',
    '<script src="./js/deck.js"></script>',
    "</head><body>",
    "<img src='img/a%20b.png' alt=\"a\">",
    '<img src="../../../../../.env">',
    '<img src="/etc/passwd">',
    '<img src="https://cdn.example.com/x.png">',
    '<img src="data:image/png;base64,AAAA">',
    '<a href="other.html">navigation stays as written</a>',
    '<a href="#s2">fragment</a>',
    '<svg><use href="#icon"></use><image href="chart.svg"/></svg>',
    '<video poster=poster.jpg src="m.mp4"></video>',
    '<img src="q.png?a=1&amp;b=2">',
    "</body></html>",
  ].join("\n");
  const { html, blocked } = rewrite(page);
  assert.match(html, /<link rel="stylesheet" href="vscode-resource:deck\.css\?v=2#x">/);
  assert.match(html, /<script src="vscode-resource:js\/deck\.js" nonce="n0nce_ABC-123"><\/script>/);
  assert.match(html, /<img src="vscode-resource:img\/a b\.png" alt="a">/);
  assert.match(html, /<image href="vscode-resource:chart\.svg"\/>/);
  assert.match(html, /<video poster="vscode-resource:poster\.jpg" src="vscode-resource:m\.mp4">/);
  assert.match(html, /<img src="vscode-resource:q\.png\?a=1&amp;b=2">/, "an entity in the value is decoded, then escaped again");
  assert.deepEqual(blocked, ["../../../../../.env", "/etc/passwd"]);
  assert.equal((html.match(/<img src="">/g) ?? []).length, 2, "what leaves the folder is emptied, never loaded");
  assert.match(html, /<img src="https:\/\/cdn\.example\.com\/x\.png">/, "a remote URL is left for the CSP to refuse");
  assert.match(html, /<img src="data:image\/png;base64,AAAA">/);
  assert.match(html, /<a href="other\.html">/);
  assert.match(html, /<a href="#s2">/);
  assert.match(html, /<use href="#icon">/);
});

test("rewriteHtml: an earlier CSP and any <base> are removed, an existing nonce replaced, script text left alone", () => {
  const page = [
    '<html><head><meta http-equiv="content-security-policy" content="default-src *"><base href="https://evil.example/">',
    '<style nonce="old">body{}</style></head><body>',
    '<script nonce=old>var s = "<img src=\\"x.png\\">"; if (1 < 2) document.title = "a>b";</script>',
    "<!-- <img src=\"commented.png\"> -->",
    "</body></html>",
  ].join("\n");
  const { html } = rewrite(page);
  assert.equal((html.match(/Content-Security-Policy/gi) ?? []).length, 1);
  assert.ok(html.includes(`content="${CSP}"`));
  assert.doesNotMatch(html, /<base|evil\.example|default-src \*/);
  assert.match(html, /<style nonce="n0nce_ABC-123">body\{\}<\/style>/);
  assert.ok(html.includes(`<script nonce="n0nce_ABC-123">var s = "<img src=\\"x.png\\">"; if (1 < 2) document.title = "a>b";</script>`), "only the start tag changes");
  assert.ok(html.includes('<!-- <img src="commented.png"> -->'));
});

test("rewriteHtml: a page without <head> still gets the policy first", () => {
  const { html } = rewrite("<p>hello</p>");
  assert.ok(html.startsWith('<meta http-equiv="Content-Security-Policy"'));
});

test("isRelativeUrl and resolveInside", () => {
  for (const u of ["a.css", "./a.css", "sub/a.png", "../x", "a.png?x#y"]) assert.equal(isRelativeUrl(u), true, u);
  for (const u of ["", " ", "#x", "/abs", "\\\\server\\share", "//host/x", "https://x", "data:x", "javascript:alert(1)", "C:\\x"]) assert.equal(isRelativeUrl(u), false, u);
  assert.deepEqual(resolveInside(DIR, "a/b.css?v=1#f"), { file: path.join(DIR, "a", "b.css"), suffix: "?v=1#f" });
  assert.equal(resolveInside(DIR, "../x.css"), null);
  assert.equal(resolveInside(DIR, "a/../../x.css"), null);
  assert.equal(resolveInside(DIR, "%2e%2e/x.css"), null, "an encoded .. is still outside");
  assert.equal(resolveInside(DIR, "%E0%A4%A"), null, "an undecodable path is refused");
  assert.equal(resolveInside(DIR, "."), null, "the folder itself is not a file");
});

// ---- the VS Code layer over a fake vscode ----

function fakeVscode({ pick, answer } = {}) {
  const calls = { panels: [], info: [], warn: [], errors: [], progress: [], picks: [], renders: [], commands: new Map() };
  const disposable = { dispose() {} };
  const vscode = {
    Uri: { file: (f) => ({ fsPath: f, toString: () => `file://${f}` }) },
    ViewColumn: { Active: -1 },
    RelativePattern: class {
      constructor(base, pattern) {
        Object.assign(this, { base, pattern });
      }
    },
    commands: { registerCommand: (id, fn) => (calls.commands.set(id, fn), disposable) },
    workspace: { createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, dispose() {} }) },
    window: {
      createWebviewPanel: (viewType, title, column, options) => {
        const panel = {
          viewType,
          title,
          options,
          revealed: 0,
          reveal() {
            this.revealed++;
          },
          onDidDispose() {},
          dispose() {},
          webview: { html: "", cspSource: "vscode-src", asWebviewUri: (u) => ({ toString: () => `webview:${u.fsPath}` }) },
        };
        calls.panels.push(panel);
        return panel;
      },
      showInformationMessage: async (msg, ...items) => (calls.info.push([msg, ...items]), answer),
      showWarningMessage: async (msg) => void calls.warn.push(msg),
      showErrorMessage: async (msg, ...items) => void calls.errors.push([msg, ...items]),
      withProgress: async (opts, task) => (calls.progress.push(opts), task({ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => disposable })),
      showQuickPick: async (items) => (calls.picks.push(items), pick ? items.find(pick) : undefined),
    },
  };
  return { vscode, calls };
}

// opts.render(root): what the fake report.mjs render does (writes index.html, or not); its exit code is returned
function setup(opts = {}) {
  const root = temp();
  const framework = path.join(root, "node_modules", "@testagentic", "atf");
  const { vscode, calls } = fakeVscode(opts);
  const context = { subscriptions: [] };
  const cli = {
    runStreaming: async (args, o) => (calls.renders.push([args, { script: o.script, env: o.env, cwd: o.cwd }]), { code: opts.render ? opts.render(root) : 1, cancelled: false }),
    runInTerminal: () => assert.fail("the report never opens a terminal"),
  };
  registerReport(context, { vscode, workspace: { root, framework }, cli, output: { appendLine() {} } });
  return { root, framework, calls, open: calls.commands.get("atf.openReport"), context };
}

test("atf.openReport from a run item: one locked-down webview per run, revealed again on a second open", async () => {
  const s = setup();
  put(s.root, "artifacts/acme/results/r1/report/index.html", '<html><head><style>x{}</style></head><body><img src="a.png"><script>1</script></body></html>');
  assert.ok(s.context.subscriptions.length >= 1);
  await s.open({ product: "acme", runId: "r1" });
  assert.equal(s.calls.panels.length, 1);
  const [panel] = s.calls.panels;
  const dir = path.join(s.root, "artifacts", "acme", "results", "r1", "report");
  assert.equal(panel.viewType, "atf.report");
  assert.deepEqual(panel.options.localResourceRoots.map((u) => u.fsPath), [dir], "the webview can read the report folder only");
  assert.equal(panel.options.enableScripts, true);
  assert.match(panel.webview.html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';/);
  assert.ok(panel.webview.html.includes(`src="webview:${path.join(dir, "a.png")}"`));
  const nonce = /'nonce-([^']+)'/.exec(panel.webview.html)[1];
  assert.ok(panel.webview.html.includes(`<script nonce="${nonce}">1</script>`));
  await s.open({ product: "acme", runId: "r1" });
  assert.equal(s.calls.panels.length, 1, "the same run reuses its panel");
  assert.equal(panel.revealed, 1);
  assert.notEqual(/'nonce-([^']+)'/.exec(panel.webview.html)[1], nonce, "a fresh nonce on every load");
});

test("atf.openReport without an item picks among the runs that have a report", async () => {
  const s = setup({ pick: (i) => i.label === "acme · r2" });
  put(s.root, "artifacts/acme/results/r1/report/index.html", "<p>1</p>");
  put(s.root, "artifacts/acme/results/r2/report/index.html", "<p>2</p>");
  await s.open();
  assert.equal(s.calls.picks.length, 1);
  assert.deepEqual(s.calls.picks[0].map((i) => i.label).sort(), ["acme · r1", "acme · r2"]);
  assert.equal(s.calls.panels.length, 1);
  assert.match(s.calls.panels[0].webview.html, /<p>2<\/p>/);

  const none = setup();
  await none.open();
  assert.equal(none.calls.picks.length, 0);
  assert.match(none.calls.info[0][0], /no run has a report yet/);
});

test("atf.openReport fallback: report.json without index.html offers report.mjs render, run in the background, then shows the deck", async () => {
  const s = setup({ answer: "Render it", render: (root) => (put(root, "artifacts/acme/results/r1/report/index.html", "<html><head></head><body>deck</body></html>"), 0) });
  put(s.root, "artifacts/acme/state/run.json", JSON.stringify({ runId: "r1" }));
  put(s.root, "artifacts/acme/results/r1/report/report.json", "{}");
  await s.open({ product: "acme", runId: "r1" });
  assert.match(s.calls.info[0][0], /node node_modules\/@testagentic\/atf\/scripts\/report\.mjs render acme/);
  assert.deepEqual(s.calls.info[0].slice(1), ["Render it"]);
  assert.deepEqual(s.calls.renders, [[["render", "acme"], { script: path.join(s.framework, "scripts", "report.mjs"), env: { ATF_ENV: "" }, cwd: s.root }]]);
  assert.equal(s.calls.progress.length, 1, "behind a notification");
  assert.equal(s.calls.panels.length, 1, "the rendered deck opens");

  const broken = setup({ answer: "Render it", render: () => 1 });
  put(broken.root, "artifacts/acme/state/run.json", JSON.stringify({ runId: "r1" }));
  put(broken.root, "artifacts/acme/results/r1/report/report.json", "{}");
  await broken.open({ product: "acme", runId: "r1" });
  assert.equal(broken.calls.panels.length, 0);
  assert.deepEqual(broken.calls.errors, [["atf: the report of acme · r1 was not rendered: report.mjs render exited 1", "Show output"]]);

  const declined = setup({ answer: undefined });
  put(declined.root, "artifacts/acme/state/run.json", JSON.stringify({ runId: "r1" }));
  put(declined.root, "artifacts/acme/results/r1/report/report.json", "{}");
  await declined.open({ product: "acme", runId: "r1" });
  assert.deepEqual(declined.calls.renders, [], "nothing runs unless the human asks");

  const old = setup({ answer: "Render it" });
  put(old.root, "artifacts/acme/results/r0/report/report.json", "{}");
  await old.open({ product: "acme", runId: "r0" });
  assert.deepEqual(old.calls.info[0].slice(1), [], "no button for a run render can't reach");
  assert.deepEqual(old.calls.renders, []);
});

test("atf.openReport for a run without any report says so", async () => {
  const s = setup();
  await s.open({ product: "acme", runId: "r9" });
  assert.equal(s.calls.panels.length, 0);
  assert.match(s.calls.info[0][0], /has no report yet/);
});
