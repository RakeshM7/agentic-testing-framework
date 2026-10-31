// A fake of the slice of the `vscode` API that src/workspace.js, src/cli.js, src/runs.js and src/activate.js use, so
// node:test runs them without VS Code. It records what the code did (commands, terminals, messages, context keys).
import { readFileSync } from "node:fs";
import path from "node:path";

class EventEmitter {
  constructor() {
    this.listeners = new Set();
    this.event = (fn) => {
      this.listeners.add(fn);
      return { dispose: () => this.listeners.delete(fn) };
    };
  }
  fire(v) {
    for (const fn of [...this.listeners]) fn(v);
  }
  dispose() {
    this.listeners.clear();
  }
}

class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}
class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}
class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}
class RelativePattern {
  constructor(base, pattern) {
    this.base = base;
    this.pattern = pattern;
  }
}

// opts: folders (fs paths), shell (env.shell), config ({ nodePath, host }), quickPicks (answers, in order; a function
// gets the items), inputs (input box answers, in order; a function gets the options), shellIntegration (a terminal
// reports shell integration at once), messageAnswers (the button each message returns), onProgress(progress, token):
// called as a withProgress task starts (a test cancels through token.cancel()), inspect (atf settings by scope, for
// inspect(); config is what get() reads), external (command ids that exist outside the extension, e.g. VS Code Chat's),
// onExternal(id, args): what running one of those does (it may throw), openDialogs (showOpenDialog answers, in order:
// a folder path, or undefined for a cancel)
export function fakeVscode({ folders = [], shell = "/bin/zsh", config = {}, inspect = null, quickPicks = [], inputs = [], shellIntegration = false, messageAnswers = [], onProgress, external = [], onExternal, openDialogs = [] } = {}) {
  const rec = { commands: new Map(), executed: [], context: {}, terminals: [], messages: [], quickPicks: [], inputs: [], progress: [], opened: [], watchers: [], treeViews: [], statusBar: [], updates: [], openDialogs: [] };
  const terminalShell = new EventEmitter();
  const vscode = {
    rec,
    EventEmitter,
    TreeItem,
    ThemeIcon,
    ThemeColor,
    RelativePattern,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    TerminalLocation: { Panel: 1, Editor: 2 },
    QuickPickItemKind: { Separator: -1, Default: 0 },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    Uri: { file: (p) => ({ scheme: "file", fsPath: path.resolve(p), toString: () => `file://${p}` }) },
    env: { shell },
    commands: {
      registerCommand: (id, fn) => {
        if (rec.commands.has(id)) throw new Error(`command ${id} registered twice`);
        rec.commands.set(id, fn);
        return { dispose: () => rec.commands.delete(id) };
      },
      executeCommand: async (id, ...args) => {
        rec.executed.push([id, ...args]);
        if (id === "setContext") rec.context[args[0]] = args[1];
        else if (rec.commands.has(id)) return rec.commands.get(id)(...args);
        else if (external.includes(id)) return onExternal?.(id, ...args);
      },
      getCommands: async () => [...rec.commands.keys(), ...external, "setContext"],
    },
    workspace: {
      get workspaceFolders() {
        return folders.map((f, index) => ({ uri: vscode.Uri.file(f), name: path.basename(f), index }));
      },
      getConfiguration: () => ({
        get: (k) => config[k],
        inspect: (k) => (inspect ? { key: `atf.${k}`, ...(inspect[k] ?? {}) } : undefined),
        update: async (k, value, target) => {
          rec.updates.push([k, value, target]);
          config[k] = value;
        },
      }),
      createFileSystemWatcher: (pattern) => {
        const w = { pattern, create: new EventEmitter(), change: new EventEmitter(), del: new EventEmitter(), disposed: false };
        w.onDidCreate = w.create.event;
        w.onDidChange = w.change.event;
        w.onDidDelete = w.del.event;
        w.dispose = () => (w.disposed = true);
        rec.watchers.push(w);
        return w;
      },
      onDidChangeWorkspaceFolders: () => ({ dispose() {} }),
    },
    window: {
      createOutputChannel: (name) => {
        const ch = { name, lines: [], shown: 0, appendLine: (l) => ch.lines.push(l), show: () => ch.shown++, dispose() {} };
        rec.output = ch;
        return ch;
      },
      createTerminal: (opts) => {
        const t = { opts, sent: [], executed: [], shown: false, shellIntegration: undefined };
        t.show = () => (t.shown = true);
        t.sendText = (text, addNewLine) => t.sent.push([text, addNewLine]);
        t.dispose = () => {};
        rec.terminals.push(t);
        if (shellIntegration) {
          const si = { executeCommand: (line) => t.executed.push(line) };
          // as VS Code does: activates a moment after the terminal opens
          setTimeout(() => {
            t.shellIntegration = si;
            terminalShell.fire({ terminal: t, shellIntegration: si });
          }, 5);
        }
        return t;
      },
      onDidChangeTerminalShellIntegration: terminalShell.event,
      onDidCloseTerminal: () => ({ dispose() {} }),
      createTreeView: (id, opts) => {
        const v = { id, opts, message: undefined, dispose() {} };
        rec.treeViews.push(v);
        return v;
      },
      createStatusBarItem: () => {
        const s = { text: "", visible: false, show: () => (s.visible = true), hide: () => (s.visible = false), dispose() {} };
        rec.statusBar.push(s);
        return s;
      },
      showQuickPick: async (items, opts) => {
        const list = await items;
        rec.quickPicks.push({ items: list, opts });
        const a = quickPicks.shift();
        return typeof a === "function" ? a(list) : a;
      },
      showInputBox: async (opts) => {
        rec.inputs.push(opts);
        const a = inputs.shift();
        return typeof a === "function" ? a(opts) : a;
      },
      showOpenDialog: async (opts) => {
        rec.openDialogs.push(opts);
        const a = openDialogs.shift();
        return a === undefined ? undefined : [vscode.Uri.file(a)];
      },
      showTextDocument: async (uri, opts) => (rec.opened.push([uri.fsPath, opts]), {}),
      withProgress: async (opts, task) => {
        const p = { opts, reports: [] };
        rec.progress.push(p);
        const cancelled = new EventEmitter();
        const token = { isCancellationRequested: false, onCancellationRequested: cancelled.event, cancel: () => ((token.isCancellationRequested = true), cancelled.fire()) };
        const progress = { report: (r) => p.reports.push(r.message) };
        onProgress?.(progress, token);
        return task(progress, token);
      },
      showWarningMessage: async (m, ...actions) => (rec.messages.push(["warning", m, actions]), messageAnswers.shift()),
      showInformationMessage: async (m, ...actions) => (rec.messages.push(["info", m, actions]), messageAnswers.shift()),
      showErrorMessage: async (m, ...actions) => (rec.messages.push(["error", m, actions]), messageAnswers.shift()),
    },
  };
  return vscode;
}

// The extension's own version, as context.extension.packageJSON gives it.
export const MANIFEST_VERSION = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "package.json"), "utf8")).version;

// An ExtensionContext: subscriptions, the extension's manifest, secret storage (opts.secrets: what is stored) and
// globalState (opts.globalState: its values). rec: what was stored and updated, in order.
export function fakeContext({ version = MANIFEST_VERSION, secrets = {}, globalState = {} } = {}) {
  const changed = new EventEmitter();
  const rec = { secrets: [], globalState: [] };
  return {
    subscriptions: [],
    rec,
    extension: { packageJSON: { name: "atf-vscode", version } },
    secrets: {
      get: async (k) => secrets[k],
      store: async (k, v) => {
        rec.secrets.push(["store", k]);
        secrets[k] = v;
        changed.fire({ key: k });
      },
      delete: async (k) => {
        rec.secrets.push(["delete", k]);
        delete secrets[k];
        changed.fire({ key: k });
      },
      onDidChange: changed.event,
      stored: secrets,
    },
    globalState: {
      get: (k) => globalState[k],
      update: async (k, v) => {
        rec.globalState.push([k, v]);
        if (v === undefined) delete globalState[k];
        else globalState[k] = v;
      },
      keys: () => Object.keys(globalState),
      values: globalState,
    },
  };
}
