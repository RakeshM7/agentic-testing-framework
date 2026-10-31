// The Products view (id atf.runs, P-12, packaging §3.13; titled Runs before D-107): every product, its environments
// (a level only when it has several), the active run's stages with what starts next, and the ended runs with their
// reports.
//
// Built in three layers, so the shape is tested without VS Code (test/runs.test.mjs):
//   loadSnapshot()   what the framework says, per product and environment:
//                      status   `atf status <product> [--env <env>]` (run.mjs status: the run, its stages, each with
//                               status, complete, blocked, awaitingApproval, notChosen/satisfied, attempts, problems)
//                      next     the stages to start now: run.mjs's exported, read-only next() in a child node (NEXT_MODULE).
//                               `atf next` is not used: it also marks reusable knowledge done (run.mjs nextStep), and a
//                               view refresh must never write run state
//                      history  state/history/<run-id>.json, the summary `run.mjs end` writes (no script lists them)
//                      reports  results/<run>/report/index.html, where the report stage renders the deck
//   buildRunTree()   a pure function of the snapshot: plain nodes with labels, states, icons and children
//   toTreeItem()     node -> vscode.TreeItem
//
// Nodes carry what a command needs (product, environment, runId, module, stage), so a menu's command gets the node
// itself. Context values other views and commands hang menus off: atf.product, atf.environment, atf.run (active or
// ended; `active` and `report` on the node), atf.module, atf.stage.
//
// The view refreshes on atf.refresh (workspace.onDidRefresh) and, debounced, on changes under artifacts/<p>/state/
// (and envs/<e>/state/), a rendered report, or config/*.yaml; only files that change what it shows count (relevantChange),
// since a run writes telemetry and locks under state/ constantly. One load at a time; a change meanwhile reloads once more.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_ENV, envArgs, listProducts, reportFile } from "./workspace.js";

// ---- stage states ---------------------------------------------------------------------------------------------------

// The state a status row (or an ended run's summary row) shows. `unverified`: marked done, but its declared outputs
// don't verify now (run.mjs status lists the problems).
export function stageState(row) {
  if (row.notChosen || row.status === "not-chosen") return "not-chosen";
  if (row.status === "running") return "running";
  if (row.complete) return "done";
  if (row.awaitingApproval || row.status === "awaiting-approval") return "awaiting-approval";
  if (row.status === "failed") return "failed";
  if (row.blocked) return "blocked";
  if (row.status === "done") return "unverified";
  return "pending";
}

export const STATE_TEXT = {
  done: "done",
  running: "running",
  failed: "failed",
  "awaiting-approval": "awaiting approval",
  "not-chosen": "not chosen",
  blocked: "blocked",
  unverified: "done, outputs don't verify",
  pending: "pending",
};
// codicon and theme colour per state (the testing colours are in every theme)
export const STATE_ICON = {
  done: ["pass", "testing.iconPassed"],
  running: ["sync~spin", null],
  failed: ["error", "testing.iconFailed"],
  "awaiting-approval": ["person", "charts.yellow"],
  "not-chosen": ["circle-slash", "disabledForeground"],
  blocked: ["debug-pause", "testing.iconQueued"],
  unverified: ["warning", "list.warningForeground"],
  pending: ["circle-large-outline", null],
  next: ["arrow-circle-right", "charts.blue"],
};
// what a module node shows: the most pressing of its stages
const URGENCY = ["running", "failed", "next", "awaiting-approval", "unverified", "blocked", "pending", "done", "not-chosen"];

const OUTCOME_TEXT = { completed: "completed", "awaiting-approval": "awaiting approval", incomplete: "incomplete", abandoned: "abandoned" };
export const HISTORY_LIMIT = 20;

// ---- the model ------------------------------------------------------------------------------------------------------

const key = (...parts) => parts.filter((p) => p !== undefined && p !== null).join("/");
const date = (iso) => (typeof iso === "string" ? iso.slice(0, 16).replace("T", " ") : "");

function stageNode(row, base, { next }) {
  const state = stageState(row);
  const isNext = !!next;
  const shown = isNext ? "next" : state;
  const bits = [STATE_TEXT[state]];
  if (isNext) bits.push(next.retry ? `next (attempt ${next.attempt})` : "next");
  else if (state === "failed" && row.attempts) bits.push(row.exhausted ? `attempt ${row.attempts}, final` : `attempt ${row.attempts}`);
  if (state === "not-chosen" && row.satisfied) bits.push(row.satisfiedBy === "import" ? "your imported cases stand in" : "an earlier run stands in");
  const tip = [
    `${row.stage}${row.module ? ` · ${row.module}` : ""}: ${STATE_TEXT[state]}`,
    ...(row.orchestrator ? [`agent: ${row.orchestrator}`] : []),
    ...(row.error ? [`error: ${row.error}`] : []),
    ...(row.unmet?.length ? [`needs, not chosen for this run: ${row.unmet.join(", ")}`] : []),
    ...(row.reviewFailed ? [`review failed with ${row.findings?.length ?? 0} open finding(s)`] : []),
    ...(row.problems ?? []).slice(0, 8).map((p) => `- ${p}`),
  ];
  return {
    kind: "stage",
    id: key(base.id, "stage", row.stage, row.module),
    label: row.stage,
    description: bits.join(" · "),
    tooltip: tip.join("\n"),
    icon: STATE_ICON[shown],
    contextValue: "atf.stage",
    state,
    next: isNext,
    product: base.product,
    environment: base.environment,
    runId: base.runId,
    active: base.active,
    stage: row.stage,
    module: row.module ?? null,
  };
}

// A run's stages: the product-level ones, then one node per module holding its stages. nextOf(row) -> action | null.
function stageNodes(rows, run, { nextOf = () => null, modules = [] } = {}) {
  const product = rows.filter((r) => !r.module).map((r) => stageNode(r, run, { next: nextOf(r) }));
  const names = [...new Set([...modules, ...rows.filter((r) => r.module).map((r) => r.module)])];
  const mods = names.map((module) => {
    const children = rows.filter((r) => r.module === module).map((r) => stageNode(r, run, { next: nextOf(r) }));
    const worst = URGENCY.find((s) => children.some((c) => (c.next ? "next" : c.state) === s)) ?? "pending";
    const chosen = children.filter((c) => c.state !== "not-chosen");
    return {
      kind: "module",
      id: key(run.id, "module", module),
      label: module,
      description: `${chosen.filter((c) => c.state === "done").length}/${chosen.length} done${worst !== "done" && worst !== "pending" ? ` · ${worst === "next" ? "next" : STATE_TEXT[worst]}` : ""}`,
      icon: STATE_ICON[worst],
      contextValue: "atf.module",
      expanded: run.active && ["running", "failed", "next", "awaiting-approval"].includes(worst),
      product: run.product,
      environment: run.environment,
      runId: run.runId,
      active: run.active,
      module,
      children,
    };
  });
  return [...product, ...mods];
}

const reportNode = (run) => ({
  kind: "report",
  id: key(run.id, "report"),
  label: "Report",
  description: "open the run's report",
  icon: ["graph", null],
  contextValue: "atf.report",
  product: run.product,
  environment: run.environment,
  runId: run.runId,
  report: run.report,
  // atf.openReport (src/report.js) takes the run: { product, runId, … }
  command: { command: "atf.openReport", title: "Open report", arguments: [{ kind: "run", product: run.product, environment: run.environment, runId: run.runId, report: run.report }] },
});

const message = (id, label, { description, tooltip, icon = ["info", null], command } = {}) => ({ kind: "message", id, label, description, tooltip, icon, contextValue: "atf.message", command });

// The active run of an environment, or the "no run" message. env: a snapshot environment.
function currentRunNodes(base, env) {
  const st = env.status;
  if (!st) {
    if (env.statusError && !/no run state/i.test(env.statusError))
      return [message(key(base.id, "error"), "Status unavailable", { description: env.statusError, tooltip: env.statusError, icon: ["error", "list.errorForeground"] })];
    const target = { kind: "environment", product: base.product, environment: base.environment };
    return [message(key(base.id, "none"), "No run yet", { description: env.config ? "start one" : `npx atf config ${base.product} --url <url>`, icon: ["circle-large-outline", null], command: env.config ? { command: "atf.run", title: "Start a run", arguments: [target] } : undefined })];
  }
  if (!st.active) return [message(key(base.id, "idle"), "No active run", { description: `last: ${st.runId}`, icon: ["debug-stop", null], command: { command: "atf.run", title: "Start a run", arguments: [{ kind: "environment", product: base.product, environment: base.environment }] } })];
  const run = { ...base, id: key(base.id, "run", st.runId), runId: st.runId, active: true, report: env.reports?.[st.runId] ?? null };
  const rows = st.stages ?? [];
  const actions = Array.isArray(env.next) ? env.next : null;
  const nextOf = (r) => actions?.find((a) => a.stage === r.stage && (a.module ?? null) === (r.module ?? null)) ?? null;
  const children = [];
  if (actions) {
    for (const a of actions)
      children.push({
        ...message(key(run.id, "next", a.stage, a.module), `Next: ${a.stage}${a.module ? ` · ${a.module}` : ""}`, { description: `${a.agent ?? a.orchestrator ?? ""}${a.retry ? ` · attempt ${a.attempt}` : ""}`, tooltip: a.prompt, icon: STATE_ICON.next }),
        kind: "next",
        contextValue: "atf.next",
        product: run.product,
        environment: run.environment,
        runId: run.runId,
        stage: a.stage,
        module: a.module ?? null,
      });
    if (!actions.length) {
      const running = rows.filter((r) => r.status === "running").length;
      children.push(message(key(run.id, "next", "none"), running ? `Waiting for ${running} running stage(s)` : "Nothing left to start", { description: running ? "" : "the run can end", icon: ["check-all", null] }));
    }
  }
  if (run.report) children.push(reportNode(run));
  children.push(...stageNodes(rows, run, { nextOf, modules: st.modules }));
  const chosen = rows.filter((r) => stageState(r) !== "not-chosen");
  const guard = st.guard && !st.guard.ready ? `\nguard not verified yet: ${st.guard.reason}` : "";
  return [
    {
      kind: "run",
      id: run.id,
      label: st.runId,
      description: `active · ${st.mode} · ${chosen.filter((r) => stageState(r) === "done").length}/${chosen.length} done`,
      tooltip: `${st.runId} (${base.environment})\nmode: ${st.mode}\nmodules: ${(st.modules ?? []).join(", ")}${guard}`,
      icon: ["play-circle", "charts.green"],
      contextValue: "atf.run",
      expanded: true,
      product: run.product,
      environment: run.environment,
      runId: run.runId,
      active: true,
      report: run.report,
      children,
    },
  ];
}

// The ended runs, newest first, from state/history/.
function historyNode(base, env) {
  const runs = (env.history ?? []).filter((h) => h && h.runId);
  if (!runs.length) return null;
  const shown = runs.slice(0, HISTORY_LIMIT).map((h) => {
    const run = { ...base, id: key(base.id, "ended", h.runId), runId: h.runId, active: false, report: env.reports?.[h.runId] ?? null };
    const children = [...(run.report ? [reportNode(run)] : []), ...stageNodes(h.stages ?? [], run)];
    return {
      kind: "run",
      id: run.id,
      label: h.runId,
      description: `${OUTCOME_TEXT[h.outcome] ?? h.outcome ?? "ended"} · ${date(h.endedAt)}`,
      tooltip: `${h.runId}\noutcome: ${h.outcome}\nmode: ${h.mode}\nstarted ${h.createdAt}\nended ${h.endedAt}${h.sheets?.length ? `\napproval sheets waiting: ${h.sheets.map((s) => s.module).join(", ")}` : ""}`,
      icon: [{ completed: "pass", "awaiting-approval": "person", incomplete: "warning", abandoned: "circle-slash" }[h.outcome] ?? "history", null],
      contextValue: "atf.run",
      product: run.product,
      environment: run.environment,
      runId: run.runId,
      active: false,
      outcome: h.outcome ?? null,
      report: run.report,
      children,
    };
  });
  if (runs.length > HISTORY_LIMIT) shown.push(message(key(base.id, "history", "more"), `${runs.length - HISTORY_LIMIT} older run(s)`, { description: "in state/history/" }));
  return { kind: "history", id: key(base.id, "history"), label: "Ended runs", description: String(runs.length), icon: ["history", null], contextValue: "atf.history", product: base.product, environment: base.environment, children: shown };
}

const envChildren = (base, env) => [...currentRunNodes(base, env), ...[historyNode(base, env)].filter(Boolean)];

const envSummary = (env) => {
  const st = env.status;
  if (!st) return env.statusError && !/no run state/i.test(env.statusError) ? "status unavailable" : "no run yet";
  if (!st.active) return "no active run";
  const running = (st.stages ?? []).filter((r) => r.status === "running").length;
  return `${st.runId}${running ? ` · ${running} running` : ""}`;
};

// snapshot: [{ product, environments: [{ name, config, status, statusError, next, history, reports }] }] -> root nodes
export function buildRunTree(snapshot) {
  return snapshot.map(({ product, environments }) => {
    const envs = environments.length ? environments : [{ name: DEFAULT_ENV }];
    const single = envs.length === 1;
    const pid = key("p", product);
    const productNode = { kind: "product", id: pid, label: product, icon: ["package", null], contextValue: "atf.product", expanded: true, product, environments: envs.map((e) => e.name) };
    if (single) {
      const env = envs[0];
      const base = { id: key(pid, "e", env.name), product, environment: env.name };
      return { ...productNode, environment: env.name, description: `${env.name === DEFAULT_ENV ? "" : `${env.name} · `}${envSummary(env)}`, children: envChildren(base, env) };
    }
    return {
      ...productNode,
      description: `${envs.length} environments`,
      children: envs.map((env) => {
        const base = { id: key(pid, "e", env.name), product, environment: env.name };
        return { kind: "environment", id: base.id, label: env.name, description: envSummary(env), icon: ["server-environment", null], contextValue: "atf.environment", expanded: !!env.status?.active, product, environment: env.name, children: envChildren(base, env) };
      }),
    };
  });
}

// ---- tree items -----------------------------------------------------------------------------------------------------

export function toTreeItem(node, vscode) {
  const S = vscode.TreeItemCollapsibleState;
  const state = node.children?.length ? (node.expanded ? S.Expanded : S.Collapsed) : S.None;
  const item = new vscode.TreeItem(node.label, state);
  item.id = node.id;
  if (node.description) item.description = node.description;
  if (node.tooltip) item.tooltip = node.tooltip;
  item.contextValue = node.contextValue;
  if (node.icon) item.iconPath = new vscode.ThemeIcon(node.icon[0], node.icon[1] ? new vscode.ThemeColor(node.icon[1]) : undefined);
  if (node.command) item.command = node.command;
  return item;
}

// ---- loading --------------------------------------------------------------------------------------------------------

// The read-only next(): stages ready to start, with their agent and prompt (run.mjs next(), not nextStep()). argv: the
// product, the workspace, the framework. Prints null when this framework's run.mjs has no such export.
export const NEXT_MODULE = `
import path from "node:path";
import { pathToFileURL } from "node:url";
const [product, root, framework] = process.argv.slice(1);
const run = await import(pathToFileURL(path.join(framework, "scripts", "run.mjs")).href);
console.log(JSON.stringify(typeof run.next === "function" ? await run.next(product, { root }) : null));
`;

// state/history/*.json, newest first; an unreadable file is skipped.
export function readHistory(dir) {
  if (!dir) return [];
  const histDir = path.join(dir, "history");
  let names = [];
  try {
    names = readdirSync(histDir).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const runs = [];
  for (const n of names)
    try {
      runs.push(JSON.parse(readFileSync(path.join(histDir, n), "utf8")));
    } catch {
      // a half-written or hand-broken summary: not shown
    }
  return runs.sort((a, b) => String(b.endedAt ?? "").localeCompare(String(a.endedAt ?? "")));
}

// One environment of a product: its status, next and history. cli: deps.cli. ATF_ENV is always set, so an
// environment inherited from VS Code's own environment can't leak in ("" is `default`).
export async function loadEnvironment({ root, framework, cli }, product, env) {
  const out = { ...env, status: null, statusError: null, next: null, history: [], reports: {} };
  const ATF_ENV = env.name === DEFAULT_ENV ? "" : env.name;
  if (env.state) {
    try {
      const st = await cli.runJson(["status", product, ...envArgs(env.name)], { env: { ATF_ENV }, allowExit: [0, 1] });
      if (st?.errors) out.statusError = st.errors.join("; ");
      else out.status = st;
    } catch (e) {
      out.statusError = e.message;
    }
    if (out.status?.active)
      try {
        out.next = await cli.runJson([product, root, framework], { eval: NEXT_MODULE, env: { ATF_ENV } });
      } catch (e) {
        out.next = null; // the stages still show; only the "next" marks are missing
        out.nextError = e.message;
      }
    out.history = readHistory(env.state);
  }
  for (const id of [out.status?.runId, ...out.history.map((h) => h.runId)].filter(Boolean)) {
    const f = reportFile(root, product, id);
    if (existsSync(f)) out.reports[id] = f;
  }
  return out;
}

// Every product and environment, two at a time (each is one or two node processes).
export async function loadSnapshot({ workspace, cli, concurrency = 2 }) {
  if (!workspace.ok) return [];
  const products = listProducts(workspace.root);
  const jobs = products.flatMap((p) => p.environments.map((e) => [p, e]));
  const results = new Map();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const [p, e] = jobs[i++];
      results.set(`${p.product}\0${e.name}`, await loadEnvironment({ root: workspace.root, framework: workspace.framework, cli }, p.product, e));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return products.map((p) => ({ product: p.product, environments: p.environments.map((e) => results.get(`${p.product}\0${e.name}`)) }));
}

// Whether a changed file can change the view (paths relative to the workspace, either separator).
export function relevantChange(root, fsPath) {
  const rel = path.relative(root, fsPath).split(path.sep).join("/");
  return (
    /^artifacts\/[^/]+\/(envs\/[^/]+\/)?state\/(run\.json|lock\.json|history\/[^/]+\.json)$/.test(rel) ||
    /^artifacts\/[^/]+\/results\/[^/]+\/report\/index\.html$/.test(rel) ||
    /^config\/[^/]+\.ya?ml$/.test(rel)
  );
}

// fn after `ms` of quiet. -> { trigger, dispose }
export function debounce(fn, ms, timers = { setTimeout, clearTimeout }) {
  let t = null;
  return {
    trigger() {
      if (t) timers.clearTimeout(t);
      t = timers.setTimeout(() => {
        t = null;
        fn();
      }, ms);
    },
    dispose() {
      if (t) timers.clearTimeout(t);
      t = null;
    },
  };
}

export const WATCH_GLOBS = ["artifacts/*/state/**", "artifacts/*/envs/*/state/**", "artifacts/*/results/*/report/index.html", "config/*.yaml"];

// ---- the VS Code layer ----------------------------------------------------------------------------------------------

// The atf.runs view, titled Products. -> { view, refresh(), nodes() }
export function registerRuns(context, deps) {
  const { vscode, workspace, cli, output } = deps;
  const changed = new vscode.EventEmitter();
  let roots = [];
  let loaded = false;
  let loading = null;
  let again = false;
  let view = null;

  const provider = {
    onDidChangeTreeData: changed.event,
    getTreeItem: (node) => toTreeItem(node, vscode),
    getChildren: async (node) => {
      if (node) return node.children ?? [];
      if (!loaded) await (loading ?? load());
      return roots;
    },
    getParent: () => undefined,
  };

  async function load() {
    if (loading) {
      again = true;
      return loading;
    }
    loading = (async () => {
      try {
        roots = workspace.ok ? buildRunTree(await loadSnapshot({ workspace, cli })) : [];
      } catch (e) {
        output.appendLine(`runs: ${e.stack ?? e.message}`);
        roots = [];
      }
      loaded = true;
    })();
    try {
      await loading;
    } finally {
      loading = null;
    }
    changed.fire();
    if (again) {
      again = false;
      await load();
    }
  }

  // No view.message: when there is no workspace (noFolder, noWorkspace, noFramework, badMarker), the empty tree shows
  // the manifest's welcome content for that state, with its buttons; a message above it would only repeat it.
  view = vscode.window.createTreeView("atf.runs", { treeDataProvider: provider, showCollapseAll: true });
  const soon = debounce(() => void load(), 750);
  const watchers = [];
  const watch = () => {
    for (const w of watchers.splice(0)) w.dispose();
    if (!workspace.root) return;
    for (const glob of WATCH_GLOBS) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(workspace.root), glob));
      const on = (uri) => relevantChange(workspace.root, uri.fsPath) && soon.trigger();
      w.onDidCreate(on);
      w.onDidChange(on);
      w.onDidDelete(on);
      watchers.push(w);
    }
  };
  watch();
  let root = workspace.root;
  context.subscriptions.push(
    view,
    changed,
    soon,
    { dispose: () => watchers.forEach((w) => w.dispose()) },
    workspace.onDidRefresh(() => {
      if (workspace.root !== root) {
        root = workspace.root;
        watch();
      }
      void load();
    }),
  );
  return { view, refresh: load, nodes: () => roots };
}
