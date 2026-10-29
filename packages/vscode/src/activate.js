// The extension's wiring (P-12), apart from src/extension.js so node:test can run it with a fake `vscode`
// (test/activate.test.mjs): the output channel, deps.workspace and deps.cli, the Runs view, Basil's commands, then the
// sheets (Poppy) and the report (Ivy) through their register functions, each with deps = { vscode, workspace, cli,
// output }. One part that fails to register is logged and the rest still load.
//
// Every command here runs atf in a terminal the human sees (cli.runInTerminal): init is human-only, and run, resume and
// doctor are interactive or long. The extension never registers, replaces or bypasses the hooks (no safety role, P-12).
import { createCli } from "./cli.js";
import { registerRuns } from "./runs.js";
import { DEFAULT_ENV, INSTALL_HINT, createWorkspace, envArgs, findFramework } from "./workspace.js";

// Basil's commands (the manifest declares every command; test/manifest.test.mjs checks both ways)
export const COMMANDS = ["atf.refresh", "atf.init", "atf.sync", "atf.check", "atf.doctor", "atf.run", "atf.resume"];

// The stages, for `atf resume` when the tree has none to offer (the CLI checks the name either way).
export const STAGES = ["knowledge", "module-knowledge", "explore", "clarifications", "api-discovery", "testcases", "playwright-repo", "playwright-ui", "playwright-api", "k6", "report"];

const walk = (nodes, fn) => {
  for (const n of nodes) {
    fn(n);
    if (n.children) walk(n.children, fn);
  }
};

// registerSheets/registerReport: the other owners' register functions (src/sheets/index.js, src/report.js).
export function start(vscode, context, { registerSheets, registerReport } = {}) {
  const output = vscode.window.createOutputChannel("atf");
  context.subscriptions.push(output);
  const workspace = createWorkspace(vscode);
  context.subscriptions.push(workspace);
  const cli = createCli({ vscode, workspace, output });
  const deps = { vscode, workspace, cli, output };
  const guarded = (name, fn) => {
    try {
      return fn();
    } catch (e) {
      output.appendLine(`atf: ${name} failed to load: ${e.stack ?? e.message}`);
      return null;
    }
  };
  output.appendLine(workspace.ok ? `atf: workspace ${workspace.root}, ${workspace.framework} ${workspace.frameworkVersion}` : workspace.message);

  const runs = guarded("the Runs view", () => registerRuns(context, deps));
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  status.name = "atf";
  status.command = "atf.refresh";
  context.subscriptions.push(status);
  const showState = () => {
    if (workspace.ok) return status.hide();
    status.text = "$(warning) atf";
    status.tooltip = `${workspace.message}\nClick to check again.`;
    status.show();
  };
  showState();
  context.subscriptions.push(workspace.onDidRefresh(showState));

  // ---- picking what a command works on --------------------------------------------------------------------------------

  // { product, environment } from the node a menu passed, else asked. null: nothing to work on (already said why).
  const pickTarget = async (node, { placeHolder, offerInterview = false } = {}) => {
    const products = workspace.products();
    if (node?.product) {
      const p = products.find((x) => x.product === node.product);
      const envs = p?.environments.map((e) => e.name) ?? [DEFAULT_ENV];
      if (node.environment) return { product: node.product, environment: node.environment };
      if (envs.length === 1) return { product: node.product, environment: envs[0] };
      const env = await vscode.window.showQuickPick(envs, { placeHolder: `The environment of ${node.product}` });
      return env ? { product: node.product, environment: env } : null;
    }
    const items = products.flatMap((p) => p.environments.map((e) => ({ label: p.product, description: e.name === DEFAULT_ENV ? "" : e.name, target: { product: p.product, environment: e.name } })));
    if (offerInterview) items.push({ label: "$(comment-discussion) New run-config…", description: "atf interview: the orchestrator asks a few questions", interview: true });
    if (!items.length) {
      vscode.window.showInformationMessage("atf: no products yet. Create a run-config with npx atf config <product> --url <url>, or npx atf interview.");
      return null;
    }
    if (items.length === 1 && items[0].target) return items[0].target;
    const chosen = await vscode.window.showQuickPick(items, { placeHolder: placeHolder ?? "The product" });
    if (chosen?.interview) return { interview: true };
    return chosen?.target ?? null;
  };

  const hostArgs = () => {
    const host = vscode.workspace.getConfiguration("atf").get("host");
    return host && host !== "claude" ? ["--host", host] : [];
  };
  const needWorkspace = () => {
    if (workspace.ok) return true;
    vscode.window.showWarningMessage(workspace.message);
    return false;
  };
  const terminal = (args, name, opts) =>
    cli.runInTerminal(args, { name, ...opts }).catch((e) => {
      vscode.window.showErrorMessage(e.message);
    });

  // The stages (and their modules) the tree shows for a product's environment.
  const stagesOf = (product, environment) => {
    const found = new Map();
    walk(runs?.nodes() ?? [], (n) => {
      if (n.kind === "stage" && n.active && n.product === product && n.environment === environment) {
        if (!found.has(n.stage)) found.set(n.stage, new Set());
        if (n.module) found.get(n.stage).add(n.module);
      }
    });
    return found;
  };

  // ---- the commands -------------------------------------------------------------------------------------------------

  const commands = {
    "atf.refresh": () => {
      workspace.detect({ fire: true });
    },
    "atf.init": async () => {
      const folders = workspace.folders();
      if (!folders.length) return void vscode.window.showWarningMessage("atf: open a folder first; atf init creates the workspace in it.");
      let folder = workspace.root ?? workspace.folder ?? (folders.length === 1 ? folders[0] : null);
      if (!folder) folder = await vscode.window.showQuickPick(folders, { placeHolder: "The folder to create the atf workspace in" });
      if (!folder) return;
      if (!findFramework(folder)) return void vscode.window.showWarningMessage(`atf: ${folder} has no @testagentic/atf installed. Install it first: ${INSTALL_HINT}; then create the workspace.`);
      return terminal(["init"], "init", { cwd: folder });
    },
    "atf.sync": () => needWorkspace() && terminal(["sync"], "sync"),
    "atf.check": () => needWorkspace() && terminal(["check"], "check"),
    "atf.doctor": async (node) => {
      if (!needWorkspace()) return;
      const t = await pickTarget(node, { placeHolder: "The product to check" });
      if (t) return terminal(["doctor", t.product, ...envArgs(t.environment)], `doctor ${t.product}`);
    },
    "atf.run": async (node) => {
      if (!needWorkspace()) return;
      const t = await pickTarget(node, { placeHolder: "The product to run", offerInterview: true });
      if (t?.interview) return terminal(["interview", ...hostArgs()], "interview");
      if (t) return terminal(["run", t.product, ...envArgs(t.environment), ...hostArgs()], `run ${t.product}`);
    },
    "atf.resume": async (node) => {
      if (!needWorkspace()) return;
      const t = await pickTarget(node, { placeHolder: "The product whose run to resume" });
      if (!t) return;
      const known = stagesOf(t.product, t.environment);
      let stage = node?.kind === "stage" ? node.stage : null;
      if (!stage) stage = await vscode.window.showQuickPick(known.size ? [...known.keys()] : STAGES, { placeHolder: "The stage to resume (it and the stages that depend on it run again)" });
      if (!stage) return;
      let module = node?.kind === "stage" || node?.kind === "module" ? node.module : null;
      const modules = [...(known.get(stage) ?? [])];
      if (!module && node?.kind !== "stage" && modules.length) {
        const every = "$(list-flat) Every module";
        const pick = await vscode.window.showQuickPick([every, ...modules], { placeHolder: `The module to resume ${stage} for` });
        if (!pick) return;
        module = pick === every ? null : pick;
      }
      return terminal(["resume", t.product, "--stage", stage, ...(module ? ["--module", module] : []), ...envArgs(t.environment), ...hostArgs()], `resume ${t.product}`);
    },
  };
  for (const [id, fn] of Object.entries(commands)) context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // the workspace appears (atf init) or its package does (npm install): check again
  const marker = vscode.workspace.createFileSystemWatcher("**/atf/atf.json");
  const redetect = () => workspace.detect();
  marker.onDidCreate(redetect);
  marker.onDidDelete(redetect);
  marker.onDidChange(redetect);
  context.subscriptions.push(marker, vscode.window.onDidCloseTerminal(redetect), vscode.workspace.onDidChangeWorkspaceFolders(redetect));

  if (!workspace.ok) {
    const actions = workspace.state === "noWorkspace" && workspace.folder ? ["Create workspace (init)"] : ["Check again"];
    void Promise.resolve(vscode.window.showWarningMessage(workspace.message, ...actions)).then((a) => {
      if (a === "Create workspace (init)") return vscode.commands.executeCommand("atf.init");
      if (a === "Check again") return vscode.commands.executeCommand("atf.refresh");
    });
  }

  // the sheets return { refresh }: atf.refresh and a changed detection refresh their views too
  const sheets = registerSheets ? guarded("the clarifications and approval sheets", () => registerSheets(context, deps)) : null;
  if (typeof sheets?.refresh === "function") context.subscriptions.push(workspace.onDidRefresh(() => guarded("the sheets' refresh", () => sheets.refresh())));
  const report = registerReport ? guarded("the report", () => registerReport(context, deps)) : null;
  return { ...deps, runs, sheets, report };
}
