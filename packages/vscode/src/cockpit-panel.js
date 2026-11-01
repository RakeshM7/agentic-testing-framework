// the Cockpit's editor tab (D-110, docs/cockpit-plan.md W6, C3): `atf.openCockpit` opens one WebviewPanel per window
// (Timeline, Traceability, Failures, Safety) over the framework's read-only `cockpit.mjs <product> --json` (C1).
//
// The page is untrusted input: each message is validated (cockpit-panel-page.js validateTabMessage) and its target is
// checked again here against the product list and the last C1 data before anything runs. Sessions (resume, heal) go
// through actions.session(argv, target), the same gated path as the Products view; this file runs no agent itself.
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { intentArgv } from "./cockpit-actions.js";
import { TABS, renderCockpitPanelHtml, validatePanelPageMessage, validateTabMessage } from "./cockpit-panel-page.js";
import { loadError, productRows } from "./cockpit.js";
import { WATCH_GLOBS, debounce, relevantChange } from "./runs.js";
import { makeNonce } from "./sheets/webview.js";
import { DEFAULT_ENV, configFileOf, envArgs } from "./workspace.js";

export const COMMAND_ID = "atf.openCockpit";
export const VIEW_TYPE = "atf.cockpitPanel";
export const COCKPIT_SCRIPT = path.join("scripts", "cockpit.mjs");

// The editor tab's part of package.json (`contributes`); manifest.test.mjs checks the manifest carries it.
export const COMMAND_CONTRIBUTION = {
  commands: [{ command: COMMAND_ID, title: "Open Cockpit", category: "atf", icon: "$(dashboard)" }],
  menus: {
    commandPalette: [{ command: COMMAND_ID, when: "atf.active" }],
    "view/title": [{ command: COMMAND_ID, when: "(view == atf.cockpit || view == atf.runs) && atf.active", group: "navigation@3" }],
  },
};

const IMAGE_OR_HTML = /\.(png|jpe?g|gif|webp|svg|bmp|ico|html?)$/i;
// Always applied, besides the run-config's own credentials file: a name that looks like one.
export const CREDENTIAL_NAME = /credential|\.env/i;

// The login credentials file the product's run-config names, relative to the root (a line `credentials_file: <path>`),
// read with a regex, not a YAML parser: this is a cheap guard, not the run-config's reader. -> string | null
export function credentialsFileOf(root, product) {
  try {
    const text = readFileSync(path.join(root, ...configFileOf(product).split("/")), "utf8");
    const m = /^\s*credentials_file:\s*["']?([^\s"'#]+)/m.exec(text);
    return m && m[1] !== "null" && m[1] !== "~" ? m[1] : null;
  } catch {
    return null;
  }
}

const real = (p) => {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
};
const inside = (root, p) => {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
const segments = (p) => String(p).split(/[\\/]+/).filter(Boolean);

// A path from the page -> { ok: true, file } | { ok: false, why }. Resolves inside the workspace root (through symlinks),
// requires a file, and refuses any `.auth` segment, the product's credentials file and (always) names that look like
// credentials or `.env` files.
export function resolveOpenable(root, product, requested) {
  if (!root) return { ok: false, why: "there is no workspace folder" };
  const text = String(requested ?? "");
  if (!text || text.includes("\0")) return { ok: false, why: "no path" };
  if (segments(text).some((s) => s.toLowerCase() === ".auth")) return { ok: false, why: "it is under .auth/ (saved login sessions are never opened from the Cockpit)" };
  const realRoot = real(root);
  if (!realRoot) return { ok: false, why: "the workspace folder is not readable" };
  const abs = path.resolve(realRoot, text);
  if (!inside(realRoot, abs)) return { ok: false, why: "it is outside the workspace" };
  const file = real(abs);
  if (!file) return { ok: false, why: "it does not exist" };
  if (!inside(realRoot, file)) return { ok: false, why: "it resolves outside the workspace" };
  let st;
  try {
    st = statSync(file);
  } catch {
    return { ok: false, why: "it does not exist" };
  }
  if (!st.isFile()) return { ok: false, why: "it is not a file" };
  if (segments(path.relative(realRoot, file)).some((s) => s.toLowerCase() === ".auth")) return { ok: false, why: "it is under .auth/" };
  const cred = product ? credentialsFileOf(realRoot, product) : null;
  if (cred) {
    const named = real(path.resolve(realRoot, cred)) ?? path.resolve(realRoot, cred);
    if (named === file) return { ok: false, why: "it is the run-config's credentials file" };
  }
  if (CREDENTIAL_NAME.test(path.basename(file))) return { ok: false, why: "its name looks like a credentials or .env file" };
  return { ok: true, file };
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const cleanFocus = (f) => {
  if (!f || typeof f !== "object") return undefined;
  const out = {};
  for (const k of ["stage", "module"]) if (typeof f[k] === "string" && f[k].length <= 100 && ID_RE.test(f[k])) out[k] = f[k];
  return Object.keys(out).length ? out : undefined;
};

// deps: { vscode, workspace, output, cli }. actions (activate.js, W9): session(argv, target), openSheet({product,
// environment, module, sheet}), sweep(target); each optional, with the extension's own commands as the fallback.
export function registerCockpitPanel(context, { vscode, workspace, output, cli }, { actions = {} } = {}) {
  let panel = null;
  let ready = false;
  let current = null; // { product, environment, tab, focus }
  let last = null; // the last message sent to the page (re-sent when the page asks, or comes back)
  let data = null; // the last C1 object
  let seq = 0;
  let subs = [];

  const send = (m) => {
    last = m;
    if (panel && ready) void panel.webview.postMessage(m);
  };
  const dataMessage = () => ({ type: "data", product: current.product, environment: current.environment, tab: current.tab, ...(current.focus ? { focus: current.focus } : {}), data });
  const known = (t) => productRows(workspace).some((p) => p.product === t.product && p.environment === t.environment);
  const warn = (text) => void vscode.window.showWarningMessage(`atf: ${text}`);

  async function load() {
    if (!panel || !current) return;
    const mine = ++seq;
    send({ type: "loading" });
    try {
      if (!workspace.ok) throw new Error(workspace.message ?? "this folder is not an atf workspace");
      if (!known(current)) throw new Error(`${current.product} (${current.environment}) is not a product of this project`);
      const out = await cli.runJson([current.product, "--json"], { script: COCKPIT_SCRIPT, env: { ATF_ENV: current.environment === DEFAULT_ENV ? "" : current.environment }, allowExit: [0, 1] });
      if (mine !== seq) return;
      if (out?.error) throw new Error(String(out.error));
      if (!out || typeof out !== "object" || out.schemaVersion !== 1) throw new Error("the framework's cockpit script answered in a format this extension does not know; update @testagentic/atf and the extension together");
      data = out;
      const m = dataMessage();
      const v = validatePanelPageMessage(m);
      if (!v.ok) throw new Error(`the cockpit data was refused: ${v.error}`);
      send(m);
    } catch (e) {
      if (mine !== seq) return;
      data = null;
      send({ type: "error", message: loadError(current.product, e).slice(0, 4000) });
    }
  }

  const soon = debounce(() => void load(), 750);

  function watch() {
    if (!workspace.root) return [];
    return WATCH_GLOBS.map((glob) => {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(workspace.root), glob));
      const on = (uri) => relevantChange(workspace.root, uri.fsPath) && soon.trigger();
      w.onDidCreate(on);
      w.onDidChange(on);
      w.onDidDelete(on);
      return w;
    });
  }

  function ensurePanel() {
    if (panel) return void panel.reveal?.(vscode.ViewColumn?.Active, false);
    ready = false;
    panel = vscode.window.createWebviewPanel(VIEW_TYPE, "atf Cockpit", vscode.ViewColumn?.Active ?? 1, { enableScripts: true, enableForms: false, retainContextWhenHidden: true, localResourceRoots: [] });
    panel.webview.html = renderCockpitPanelHtml({ nonce: makeNonce() });
    subs = [
      panel.webview.onDidReceiveMessage((m) => Promise.resolve(onMessage(m)).catch((e) => output?.appendLine(`atf: the Cockpit tab: ${e.stack ?? e.message}`))),
      panel.onDidChangeViewState?.(() => panel?.visible && last && ready && void panel.webview.postMessage(last)),
      workspace.onDidRefresh?.(() => soon.trigger()),
      ...watch(),
      { dispose: () => soon.dispose() },
    ];
    panel.onDidDispose(() => {
      for (const s of subs) s?.dispose?.();
      subs = [];
      panel = null;
      ready = false;
      current = null;
      last = null;
      data = null;
      seq++;
    });
  }

  // args: { product, environment, tab, focus }, as the Products view, the sidebar or the palette gives them.
  async function open(args = {}) {
    if (!workspace.ok) return warn(workspace.message ?? "open a folder with an atf workspace first.");
    const rows = productRows(workspace);
    if (!rows.length) return warn("this project has no products yet (New product…).");
    const a = args && typeof args === "object" ? args : {};
    let target;
    if (typeof a.product === "string") {
      target = rows.find((r) => r.product === a.product && r.environment === (a.environment ?? DEFAULT_ENV)) ?? (a.environment ? null : rows.find((r) => r.product === a.product));
      if (!target) return warn(`${a.product}${a.environment ? ` (${a.environment})` : ""} is not a product of this project.`);
    } else if (current && panel) target = current;
    else if (rows.length === 1) target = rows[0];
    else {
      const picked = await vscode.window.showQuickPick(
        rows.map((r) => ({ label: r.product, description: `${r.environment === DEFAULT_ENV ? "" : `${r.environment} · `}${r.status}`, row: r })),
        { placeHolder: "The product whose run to open" },
      );
      if (!picked) return;
      target = picked.row;
    }
    const tab = TABS.includes(a.tab) ? a.tab : current && panel ? current.tab : "timeline";
    const same = panel && current && current.product === target.product && current.environment === target.environment;
    current = { product: target.product, environment: target.environment, tab, focus: cleanFocus(a.focus) };
    ensurePanel();
    panel.title = `atf Cockpit · ${target.product}`;
    if (same && data) send(dataMessage());
    await load();
  }

  const refs = () => ({ stages: data?.timeline?.stages ?? [], next: data?.overview?.next ?? [], intents: data?.overview?.intents ?? {}, history: data?.timeline?.history ?? [] });

  async function openFile(requested) {
    const r = resolveOpenable(workspace.root, current?.product, requested);
    if (!r.ok) {
      output?.appendLine(`atf: the Cockpit tab did not open '${String(requested).slice(0, 200)}': ${r.why}`);
      return warn(`not opened (${r.why}).`);
    }
    const uri = vscode.Uri.file(r.file);
    if (IMAGE_OR_HTML.test(r.file)) return void (await vscode.commands.executeCommand("vscode.open", uri));
    await vscode.window.showTextDocument(uri, { preview: true });
  }

  async function onMessage(raw) {
    const v = validateTabMessage(raw);
    if (!v.ok) return void output?.appendLine(`atf: the Cockpit tab sent an invalid message (${v.error}); ignored`);
    const m = v.message;
    if (m.type === "ready") {
      ready = true;
      if (last) void panel?.webview.postMessage(last);
      return;
    }
    if (!current) return;
    const t = { product: current.product, environment: current.environment };
    switch (m.type) {
      case "refresh":
        return load();
      case "tab":
        current.tab = m.tab;
        current.focus = undefined;
        return;
      case "openFile":
        return openFile(m.path);
      case "sweep":
        if (!known(t)) return warn(`${t.product} (${t.environment}) is not a product of this project.`);
        return actions.sweep ? actions.sweep(t) : void (await vscode.commands.executeCommand("atf.sweep", { ...t, kind: "product" }));
      case "openReport": {
        const run = refs().history.find((h) => h.runId === m.runId) ?? (data?.run?.runId === m.runId ? data.run : null);
        if (!run) return warn(`run ${m.runId} is not one of this product's runs.`);
        return void (await vscode.commands.executeCommand("atf.openReport", { kind: "run", product: t.product, environment: t.environment, runId: m.runId, report: run.report ?? null }));
      }
      case "openSheet": {
        if (!known(t) || !(m.module in refs().intents)) return warn(`${m.module} is not a module of ${t.product}.`);
        if (actions.openSheet) return actions.openSheet({ ...t, module: m.module, sheet: m.sheet });
        return void (await vscode.commands.executeCommand(m.sheet === "approval" ? "atf.openApproval" : "atf.openClarifications", { ...t, kind: "module", module: m.module }));
      }
      case "resume": {
        const { stages, next } = refs();
        const hit = (s) => s.stage === m.stage && (s.module ?? null) === m.module;
        if (!known(t) || !(stages.some(hit) || next.some(hit))) return warn(`${m.stage}${m.module ? ` · ${m.module}` : ""} is not a stage of this run.`);
        return actions.session?.(["resume", t.product, "--stage", m.stage, ...(m.module ? ["--module", m.module] : []), ...envArgs(t.environment)], t);
      }
      case "heal": {
        const heal = refs().intents[m.module]?.heal;
        if (!known(t) || !heal?.enabled || heal.stage !== m.stage) return warn(`there is nothing to heal for ${m.module} at ${m.stage}.`);
        return actions.session?.(intentArgv("heal", { product: t.product, environment: t.environment, module: m.module, healStage: heal.stage }), t);
      }
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_ID, (args) => open(args)),
    { dispose: () => panel?.dispose?.() },
  );
  return { open, load, onMessage, panel: () => panel, state: () => ({ current, data }) };
}
