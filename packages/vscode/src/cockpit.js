// the Cockpit (D-110): the ATF sidebar's first view (`atf.cockpit`, a webview view), one page in the spirit of
// a test cockpit: this machine's environment checks with their fixes, the products with Run, Doctor and Config, and
// the New product form, which drafts the run-config through the framework's own script with no agent.
//
//   createEnvironment()  the environment model, shared with the run check before a session (activate.js gateSession):
//                        - the Node.js a session would run on: the pin (atf.nodePath, probed), else what a new terminal
//                          finds (node-env.js terminalNode); below NODE_MIN, the Node.js installs found on the machine
//                          are offered as "Use Node <version>" (they set atf.nodePath; the agent terminal's command line
//                          then puts that Node first on its PATH, cli.js terminalLine);
//                        - the framework's machine check, `doctor.mjs --machine --json` (no run-config: Node.js for the
//                          extension's own commands, the framework's dependencies, the login browser, the browser
//                          server's browser, k6 as a warning), and `--fix` for the installs it may run.
//   registerCockpit()  the view: renders cockpit-sidebar-page.js, sends it the state, and acts on its validated messages,
//                        through the same commands and flows the rest of the extension uses (actions from activate.js).
//
// No new runtime behaviour in the framework (SPEC): the checks, the fixes and the draft are the framework's scripts.
// The form's answers go to `run-config.mjs draft` in a temporary file outside the workspace, removed afterwards; the
// script writes config/<product>.yaml (readonly, never over an existing file), or says what to fix.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { lastJson } from "./cli.js";
import { WATCH_GLOBS, debounce, relevantChange } from "./runs.js";
import { formAnswers, renderCockpitHtml, validatePanelMessage } from "./cockpit-sidebar-page.js";
import { NODE_MIN, findNodes as defaultFindNodes, probeNode as defaultProbeNode, sessionNodeRow, terminalNode as defaultTerminalNode } from "./node-env.js";
import { makeNonce } from "./sheets/webview.js";
import { configFileOf, stateDir } from "./workspace.js";

export const VIEW_ID = "atf.cockpit";
export const DOCTOR_SCRIPT = path.join("scripts", "doctor.mjs");
export const DRAFT_SCRIPT = path.join("scripts", "run-config.mjs");
export const COCKPIT_SCRIPT = path.join("scripts", "cockpit.mjs");

// The doctor's checks (--json) as the panel's rows: { id, status: ok|warn|fail, detail, fix, canFix }. The doctor's
// Node.js check is the extension's own commands' Node (atf.nodePath, else VS Code's PATH), said so.
export function checkRows(checks) {
  const status = (c) => (!c.ok && c.level !== "warn" ? "fail" : c.level === "warn" ? "warn" : "ok");
  return (checks ?? []).map((c) => ({
    id: String(c.id ?? ""),
    status: status(c),
    detail: c.id === "node" ? `For atf's own commands in VS Code: ${c.detail}` : String(c.detail ?? c.id ?? ""),
    fix: c.fix ? String(c.fix) : null,
    canFix: !!c.fixable,
  }));
}

// The session's Node.js as a row, with the installs to switch to: offered when it is too old (or missing), and when a
// pin is set (to switch or unpin). nodes: findNodes()'s list.
export function sessionRow(found, { pinned, nodes = [], nodePath } = {}) {
  const r = sessionNodeRow(found, { pinned });
  const choices = !r.ok || pinned ? nodes.filter((n) => n.major >= NODE_MIN && n.path !== (pinned ? nodePath : r.path)).map(({ path: p, version, source }) => ({ path: p, version, source })) : undefined;
  return {
    id: "session-node",
    status: r.ok ? "ok" : "fail",
    detail: r.detail,
    fix: r.ok ? null : `a session needs Node.js ${NODE_MIN} or later: use one below (atf then runs its sessions on it), or switch your terminal's (nvm alias default 24), then Check again`,
    ok: r.ok,
    pinned: !!pinned,
    ...(choices ? { choices } : {}),
  };
}

// Why the Cockpit could not load a product, in words: the script's own reason (a CliError's), never the command line
// and its exit code, which the atf output channel keeps.
export function loadError(product, e) {
  const why = String(e?.reason ?? e?.message ?? e).trim().replace(/[.;:\s]+$/, "");
  return `Couldn't load ${product}: ${why}. The atf output has the details.`;
}

// The products as the panel lists them: [{ product, environment, config, active, status }].
export function productRows(workspace) {
  if (!workspace.ok) return [];
  return workspace.products().flatMap((p) =>
    p.environments.map((e) => {
      const active = existsSync(path.join(stateDir(workspace.root, p.product, e.name), "lock.json"));
      return { product: p.product, environment: e.name, config: e.config, active, status: active ? "run active" : e.state ? "last run ended" : e.config ? "not run yet" : "no run-config" };
    }),
  );
}

// "run-config.mjs draft" answered: { file, product, warnings, next } on stdout, or "- <error>" lines on stderr.
export function draftResult({ code, lines }) {
  if (code === 0) {
    const out = lastJson(lines);
    if (out?.file && out?.product) return { ok: true, file: String(out.file).replaceAll("\\", "/"), product: out.product, warnings: out.warnings ?? [], next: out.next ?? [] };
  }
  const errors = lines.filter((l) => l.stream === "stderr" && l.line.startsWith("- ")).map((l) => l.line.slice(2));
  return { ok: false, errors: errors.length ? errors : [lines.filter((l) => l.line.trim()).at(-1)?.line.trim() ?? `exit ${code}`] };
}

const clock = (now) => new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// The environment model. deps: { vscode, workspace, cli, output }; the node-env functions are injectable for tests.
export function createEnvironment({ vscode, workspace, cli, output }, { findNodes = defaultFindNodes, probeNode = defaultProbeNode, terminalNode = defaultTerminalNode, now = Date.now, platform = process.platform } = {}) {
  const emitter = new vscode.EventEmitter();
  const state = { status: "idle", rows: [], at: null, error: null };
  let running = null;
  const fire = () => emitter.fire(state);

  // The Node.js a session would get: { row (sessionRow), found }.
  async function sessionNode({ withChoices = true } = {}) {
    const nodePath = cli.nodePath();
    const pinned = path.isAbsolute(nodePath);
    let found;
    if (pinned) {
      const v = await probeNode(nodePath);
      found = v ? { path: nodePath, ...v } : { error: `${nodePath} did not answer` };
    } else found = await terminalNode({ shell: vscode.env.shell, platform });
    const ok = sessionNodeRow(found, { pinned }).ok;
    const nodes = withChoices && (!ok || pinned) ? await findNodes({ platform }) : [];
    return { found, row: sessionRow(found, { pinned, nodes, nodePath }) };
  }

  // The machine check (and with fix, its installs first). Lines go to the atf channel through runStreaming.
  async function machine({ fix = false, token } = {}) {
    if (!workspace.framework) return { rows: [] };
    const lines = [];
    const r = await cli.runStreaming(["--machine", "--json", ...(fix ? ["--fix"] : [])], { script: DOCTOR_SCRIPT, env: { ATF_ENV: "", ATF_WORKSPACE: workspace.root }, token, onLine: (line, stream) => lines.push({ line, stream }) });
    if (r.cancelled) return { cancelled: true, rows: [] };
    const json = lastJson(lines);
    if (!Array.isArray(json?.checks)) return { error: `the machine check printed no result (exit ${r.code}); see the atf output`, rows: [] };
    return { rows: checkRows(json.checks), fixed: json.fixed ?? [] };
  }

  // Runs both, one at a time (a second call while one runs waits for it). -> the state
  function check({ fix = false } = {}) {
    if (running) return running;
    state.status = "checking";
    state.error = null;
    fire();
    running = (async () => {
      try {
        const [node, m] = await Promise.all([sessionNode(), machine({ fix })]);
        state.rows = [node.row, ...m.rows];
        state.error = m.error ?? null;
        state.status = "done";
        state.at = clock(now());
        if (m.fixed?.length) output?.appendLine(`atf: the environment check installed: ${m.fixed.join("; ")}`);
      } catch (e) {
        state.status = "error";
        state.error = `The environment check failed: ${e.message}`;
      } finally {
        running = null;
        fire();
      }
      return state;
    })();
    return running;
  }

  // atf.nodePath: a Node.js the check offered, or none (unpinned). The setting is the user's (machine-overridable).
  async function pin(nodePath) {
    await vscode.workspace.getConfiguration("atf").update("nodePath", nodePath ?? undefined, (vscode.ConfigurationTarget ?? { Global: 1 }).Global);
    output?.appendLine(nodePath ? `atf: sessions and atf's own commands now run on ${nodePath} (atf.nodePath)` : "atf: atf.nodePath cleared: sessions run on the terminal's node");
    return check();
  }
  const offered = (p) => state.rows.some((r) => r.choices?.some((c) => c.path === p));

  return { state, check, sessionNode, pin, offered, onDidChange: emitter.event, dispose: () => emitter.dispose() };
}

// The view. actions (activate.js): run(t), doctor(t), openConfig(t), interview(), login(product), command(id).
// The Cockpit's own actions (activate.js adds them in W9): intent({product, environment, module, intent, healStage}),
// resume({product, environment, stage, module}), openSheet({product, module, sheet}), openTab({product, environment,
// tab, focus}), sweep({product, environment}); one that is missing is logged and ignored. debounceMs: the reload delay.
export function registerCockpit(context, { vscode, workspace, output, cli }, { environment, actions = {}, debounceMs = 750 }) {
  // open: the form section is shown opened (New product… → Fill in the form); reset: the page clears its fields. Both
  // are sent once, to a view that is there.
  const form = { busy: false, errors: [], result: null, reset: false, open: false };
  let view = null;

  // C2's state.cockpit: the selected product, and C1 for it.
  const cock = { chosen: null, loading: false, error: null, data: null, key: null };
  let loadSeq = 0;
  const selected = () => {
    const rows = productRows(workspace);
    const chosen = cock.chosen && rows.find((r) => r.product === cock.chosen.product && r.environment === cock.chosen.environment);
    const r = chosen ?? rows.find((x) => x.active) ?? rows[0];
    return r ? { product: r.product, environment: r.environment } : null;
  };
  const keyOf = (sel) => (sel ? `${sel.product}\0${sel.environment}` : null);
  async function loadCockpit() {
    const sel = selected();
    const seq = ++loadSeq;
    if (!sel || !workspace.ok) {
      Object.assign(cock, { loading: false, error: null, data: null, key: keyOf(sel) });
      return send();
    }
    if (cock.key !== keyOf(sel)) cock.data = null; // another product: never show the old one's data
    cock.key = keyOf(sel);
    Object.assign(cock, { loading: true, error: null });
    send();
    try {
      // exit 1 carries the script's {"error"} (cockpit.mjs), shown as it is, as the editor tab does
      const json = await cli.runJson([sel.product, "--json"], { script: COCKPIT_SCRIPT, env: { ATF_ENV: sel.environment }, allowExit: [0, 1] });
      if (seq !== loadSeq) return;
      if (json?.error) throw new Error(String(json.error));
      cock.data = { run: json.run ?? null, overview: json.overview ?? null, missing: json.missing ?? [] };
      cock.error = null;
    } catch (e) {
      if (seq !== loadSeq) return;
      cock.error = loadError(sel.product, e);
      cock.data = null;
    }
    cock.loading = false;
    send();
  }
  const soon = debounce(() => void loadCockpit(), debounceMs);
  const state = () => ({
    workspace: { state: workspace.state, message: workspace.message },
    env: { status: environment.state.status, rows: environment.state.rows, at: environment.state.at, error: environment.state.error },
    products: productRows(workspace),
    form: { ...form },
    cockpit: { selected: selected(), loading: cock.loading, error: cock.error, data: cock.data },
  });
  const send = () => {
    if (!view) return;
    void view.webview.postMessage({ type: "state", state: state() });
    form.reset = false;
    form.open = false;
  };

  // The form's answers through `run-config.mjs draft`, from a temporary file outside the workspace.
  async function draft(fields) {
    const { answers, problems } = formAnswers(fields);
    if (problems.length) return Object.assign(form, { errors: problems, result: null }), send();
    Object.assign(form, { busy: true, errors: [] });
    send();
    const dir = mkdtempSync(path.join(os.tmpdir(), "atf-answers-"));
    const file = path.join(dir, "interview-answers.json");
    const lines = [];
    try {
      writeFileSync(file, JSON.stringify(answers, null, 2), { mode: 0o600 });
      const r = await cli.runStreaming(["draft", file], { script: DRAFT_SCRIPT, env: { ATF_ENV: "" }, onLine: (line, stream) => lines.push({ line, stream }) });
      const res = draftResult({ code: r.code, lines });
      if (res.ok) {
        Object.assign(form, { result: { file: res.file, product: res.product, warnings: res.warnings, loginNeeded: !!answers.login?.needed }, errors: [] });
        workspace.detect();
      } else form.errors = res.errors;
    } catch (e) {
      form.errors = [e.message];
    } finally {
      rmSync(dir, { recursive: true, force: true });
      form.busy = false;
      send();
    }
  }

  const known = (t) => productRows(workspace).some((p) => p.product === t.product && p.environment === t.environment);

  const NEW = ["select", "intent", "resume", "openSheet", "openTab", "sweep"];
  const refuse = (why) => void output.appendLine(`atf: the Cockpit: ${why}; ignored`);
  // select, intent, resume, openSheet, openTab and the ledger sweep: each target checked again against the product
  // list and C1 (the selected product's modules and stages, its intents).
  async function onCockpitMessage(m) {
    const row = productRows(workspace).find((r) => r.product === m.product && (m.type === "openSheet" || r.environment === m.environment));
    if (!row) return refuse(`${m.product}${m.environment ? ` (${m.environment})` : ""} is not a product of this project`);
    const env = m.environment ?? row.environment;
    if (m.type === "select") {
      cock.chosen = { product: m.product, environment: m.environment };
      return loadCockpit();
    }
    const sel = selected();
    const c1 = sel && sel.product === m.product && sel.environment === env ? cock.data : null;
    const moduleKnown = (mod) => !!c1?.run?.modules?.includes(mod);
    const act = (name) => (typeof actions[name] === "function" ? actions[name] : (refuse(`the ${name} action is not wired yet`), null));
    switch (m.type) {
      case "intent": {
        if (!moduleKnown(m.module)) return refuse(`${m.module} is not a module of ${m.product}'s run`);
        const i = c1.overview?.intents?.[m.module]?.[m.intent];
        if (!i?.enabled) return refuse(`${m.intent} is not available for ${m.module}${i?.why ? `: ${i.why}` : ""}`);
        if (m.intent === "heal" && !i.stage) return refuse(`heal for ${m.module} has no stage`);
        return act("intent")?.({ product: m.product, environment: env, module: m.module, intent: m.intent, ...(m.intent === "heal" ? { healStage: i.stage } : {}) });
      }
      case "resume": {
        const stages = c1?.overview?.stages ?? [];
        if (!stages.some((r) => r.stage === m.stage && (r.module ?? null) === (m.module ?? null))) return refuse(`${m.stage}${m.module ? ` (${m.module})` : ""} is not a stage of ${m.product}'s run`);
        return act("resume")?.({ product: m.product, environment: env, stage: m.stage, module: m.module ?? null });
      }
      case "openSheet":
        if (!moduleKnown(m.module)) return refuse(`${m.module} is not a module of ${m.product}'s run`);
        return act("openSheet")?.({ product: m.product, module: m.module, sheet: m.sheet });
      case "openTab":
        if (m.focus?.module && !moduleKnown(m.focus.module)) return refuse(`${m.focus.module} is not a module of ${m.product}'s run`);
        return act("openTab")?.({ product: m.product, environment: env, tab: m.tab, ...(m.focus ? { focus: m.focus } : {}) });
      case "sweep":
        return act("sweep")?.({ product: m.product, environment: env });
    }
  }

  async function onMessage(raw) {
    // one validator for every page message (cockpit-sidebar-page.js); the targets are checked again below
    const v = validatePanelMessage(raw);
    if (!v.ok) return void output.appendLine(`atf: the Cockpit sent an invalid message (${v.error}); ignored`);
    const m = v.message;
    if (NEW.includes(m.type)) return onCockpitMessage(m);
    switch (m.type) {
      case "ready":
        send();
        void loadCockpit();
        if (environment.state.status === "idle") void environment.check();
        return;
      case "check":
        return void environment.check();
      case "fix":
        return void environment.check({ fix: true });
      case "useNode":
        if (!environment.offered(m.path)) return void output.appendLine(`atf: ${m.path} is not a Node.js the check offered; ignored`);
        return void environment.pin(m.path);
      case "unpinNode":
        return void environment.pin(null);
      case "run":
      case "doctor":
      case "openConfig":
        if (!known(m)) return void vscode.window.showWarningMessage(`atf: ${m.product} (${m.environment}) is not a product of this project.`);
        return actions[m.type]({ product: m.product, environment: m.environment });
      case "login":
        if (!existsSync(path.join(workspace.root ?? "", ...configFileOf(m.product).split("/")))) return;
        return actions.login(m.product);
      case "draft":
        return draft(m.form);
      case "interview":
        return actions.interview();
      case "command":
        return actions.command(m.id);
      case "newForm":
        return openForm();
      case "openOutput":
        return output.show(true);
      case "pickFiles": {
        const picked = await vscode.window.showOpenDialog({ canSelectMany: m.field === "references" || m.field === "api", canSelectFiles: true, canSelectFolders: false, defaultUri: workspace.root ? vscode.Uri.file(workspace.root) : undefined, openLabel: "Add" });
        if (!picked?.length) return;
        // paths from the project's root when inside it (the run-config's own form), else absolute
        const rel = (p) => (workspace.root && !path.relative(workspace.root, p).startsWith("..") && !path.isAbsolute(path.relative(workspace.root, p)) ? path.relative(workspace.root, p).split(path.sep).join("/") : p);
        return void view?.webview.postMessage({ type: "files", field: m.field, paths: picked.map((u) => rel(u.fsPath)) });
      }
    }
  }

  const provider = {
    resolveWebviewView(webviewView) {
      view = webviewView;
      webviewView.webview.options = { enableScripts: true, enableForms: false, localResourceRoots: [] };
      webviewView.webview.html = renderCockpitHtml({ nonce: makeNonce() });
      const subs = [
        webviewView.webview.onDidReceiveMessage((m) => Promise.resolve(onMessage(m)).catch((e) => output.appendLine(`atf: the Cockpit: ${e.stack ?? e.message}`))),
        webviewView.onDidChangeVisibility?.(() => webviewView.visible && send()),
        webviewView.onDidDispose(() => {
          view = null;
          for (const s of subs) s?.dispose?.();
        }),
      ];
    },
  };
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, { webviewOptions: { retainContextWhenHidden: true } }),
    environment.onDidChange(send),
    soon,
    workspace.onDidRefresh(() => {
      if (view) soon.trigger();
      send();
      if (view && workspace.ok && environment.state.status === "idle") void environment.check();
    }),
  );
  // a run-config or a run's lock appearing changes the product list
  for (const glob of ["**/config/*.{yaml,yml}", "**/artifacts/*/state/lock.json", "**/artifacts/*/envs/*/state/lock.json"]) {
    const w = vscode.workspace.createFileSystemWatcher(glob);
    w.onDidCreate(send);
    w.onDidDelete(send);
    context.subscriptions.push(w);
  }
  // a run's state, a report or a run-config changing: C1 again (debounced)
  if (workspace.root) {
    for (const glob of WATCH_GLOBS) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(workspace.root), glob));
      const on = (uri) => view && relevantChange(workspace.root, uri.fsPath) && soon.trigger();
      w.onDidCreate(on);
      w.onDidChange(on);
      w.onDidDelete(on);
      context.subscriptions.push(w);
    }
  }
  // New product… → Fill in the form: the form section, opened and empty
  const openForm = () => {
    Object.assign(form, { result: null, errors: [], reset: true, open: true });
    send();
  };
  return { refresh: send, openForm, draft, onMessage, loadCockpit };
}
