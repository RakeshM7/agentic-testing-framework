// The clarifications and test case approval sheets (P-12): the two views, the two editors and the approve action.
// registerSheets(context, deps) with deps = { vscode, workspace, cli, output } (SPEC). Returns { refresh, dispose },
// so the extension's atf.refresh can refresh these views too.
//
// What it writes, and how (P-12: "only through their scripts, or as a human edit to a file a human may edit"):
// - clarifications.csv: the Answer and Answer status cells only, as the human's own edit. No script records a human
//   answer (clarifications.mjs is the agents' writer and says humans edit those two columns directly).
// - approval.csv: the Approved and Comment cells only, as the human's own edit (the sheet is human-only).
// - Nothing else. approvals.json is written only by `atf approve`, which atf.approveModule opens in a terminal the
//   human sees and types the module slug into; the extension never answers it and never runs it in the background.
// The hooks stay the only enforcement: nothing here registers, replaces or bypasses them.
import * as cmd from "./commands.js";
import { DIFF_SCHEME, SheetPanel } from "./panels.js";
import { listModules, scanApprovals, scanClarifications, sheetPaths } from "./scan.js";
import { SheetTree, approvalsChildren, approvalsItem, clarificationsChildren, clarificationsItem } from "./trees.js";
import { existsSync } from "node:fs";

// The workspace root from Basil's workspace object, read on each use (a folder can be added or the marker created
// later). The same reading as the report's.
export function rootOf(workspace) {
  const ws = typeof workspace?.current === "function" ? workspace.current() : workspace;
  const root = ws?.root ?? ws?.workspaceRoot;
  return typeof root === "string" ? root : root?.fsPath ?? null;
}

export function registerSheets(context, deps) {
  const { vscode, output } = deps;
  const log = (m) => output?.appendLine?.(`atf sheets: ${m}`);
  const root = () => rootOf(deps.workspace);
  const panels = new Map(); // `${kind}:${product}/${module}` -> SheetPanel
  const pending = new Map(); // diff uri -> the human's unsaved text (read-only virtual documents)
  const subs = [];

  const clarTree = new SheetTree(vscode, { load: async () => (root() ? scanClarifications(root()) : []), children: clarificationsChildren, item: clarificationsItem, onError: (e) => log(e.message) });
  const apprTree = new SheetTree(vscode, { load: async () => (root() ? scanApprovals(root()) : []), children: approvalsChildren, item: approvalsItem, onError: (e) => log(e.message) });
  const refresh = () => {
    clarTree.refresh();
    apprTree.refresh();
    ensureWatcher();
  };

  // Refresh both views when a sheet or what the approval view counts changes (debounced: a build rewrites several).
  let watcher = null;
  let watchedRoot = null;
  let timer = null;
  function ensureWatcher() {
    const r = root();
    if (r === watchedRoot) return;
    watcher?.dispose();
    watcher = null;
    watchedRoot = r;
    if (!r) return;
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(r), "artifacts/*/modules/*/{clarifications.csv,testcases/approval.csv,testcases/coverage.json,testcases/approvals.json}"));
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        clarTree.refresh();
        apprTree.refresh();
      }, 300);
    };
    const parts = [w, w.onDidChange(changed), w.onDidCreate(changed), w.onDidDelete(changed)];
    watcher = { dispose: () => parts.forEach((d) => d.dispose()) };
  }
  ensureWatcher();

  // Asks for what a palette invocation lacks. modulesWith(product, module) filters the modules offered.
  async function pick(arg, has, placeHolder) {
    const r = root();
    if (!r) {
      vscode.window.showWarningMessage("No atf workspace is open (a folder holding atf/atf.json).");
      return null;
    }
    const t = cmd.targetOf(arg);
    if (t.product && t.module) return t;
    const all = (await listModules(r)).filter((m) => (!t.product || m.product === t.product) && has(sheetPaths(r, m.product, m.module)));
    if (!all.length) {
      vscode.window.showInformationMessage(`No module has ${placeHolder} yet.`);
      return null;
    }
    if (all.length === 1) return all[0];
    const choice = await vscode.window.showQuickPick(all.map((m) => ({ label: m.module, description: m.product, target: m })), { placeHolder: `Choose a module for ${placeHolder}` });
    return choice?.target ?? null;
  }

  function open(kind, target) {
    const key = `${kind}:${target.product}/${target.module}`;
    let p = panels.get(key);
    if (p) return p.reveal();
    p = new SheetPanel(kind, target.product, target.module, {
      vscode, root: root(), output, pending,
      onDidSave: () => refresh(),
      onDidDispose: (x) => panels.get(key) === x && panels.delete(key),
    });
    panels.set(key, p);
  }

  const unsaved = (product, module) => !!panels.get(`approval:${product}/${module}`)?.dirty;

  subs.push(
    vscode.window.registerTreeDataProvider("atf.clarifications", clarTree),
    vscode.window.registerTreeDataProvider("atf.approvals", apprTree),
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, { provideTextDocumentContent: (uri) => pending.get(uri.toString()) ?? "" }),
    vscode.commands.registerCommand("atf.openClarifications", async (arg) => {
      const t = await pick(arg, (p) => existsSync(p.clarifications), "clarifications");
      if (t) open("clarifications", t);
    }),
    vscode.commands.registerCommand("atf.openApproval", async (arg) => {
      const t = await pick(arg, (p) => existsSync(p.approval) || existsSync(p.coverage), "an approval sheet");
      if (t) open("approval", t);
    }),
    vscode.commands.registerCommand("atf.approveModule", async (arg) => {
      const t = await pick(arg, (p) => existsSync(p.approval), "an approval sheet");
      if (!t) return;
      try {
        await cmd.approveModule(t, {
          cli: deps.cli,
          cwd: root(),
          hasUnsaved: unsaved,
          confirmUnsaved: async (product, module) =>
            (await vscode.window.showWarningMessage(
              `The approval sheet of ${module} has unsaved edits. atf approve records the sheet as saved on disk, without them.`,
              { modal: true },
              "Approve the saved sheet"
            )) === "Approve the saved sheet",
        });
      } catch (e) {
        vscode.window.showErrorMessage(`atf approve: ${e.message}`);
      }
    }),
    clarTree,
    apprTree,
    { dispose: () => { clearTimeout(timer); watcher?.dispose(); for (const p of [...panels.values()]) p.close(); } }
  );
  context?.subscriptions?.push(...subs);
  return { refresh, dispose: () => subs.forEach((d) => d.dispose?.()) };
}
