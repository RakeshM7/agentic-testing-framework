// A fake of the slice of the `vscode` API that src/workspace.js, src/cli.js, src/runs.js and src/activate.js use, so
// node:test runs them without VS Code. It records what the code did (commands, terminals, messages, context keys).
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
// gets the items), shellIntegration (a terminal reports shell integration at once)
export function fakeVscode({ folders = [], shell = "/bin/zsh", config = {}, quickPicks = [], shellIntegration = false, messageAnswers = [] } = {}) {
  const rec = { commands: new Map(), executed: [], context: {}, terminals: [], messages: [], quickPicks: [], watchers: [], treeViews: [], statusBar: [] };
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
      },
    },
    workspace: {
      get workspaceFolders() {
        return folders.map((f, index) => ({ uri: vscode.Uri.file(f), name: path.basename(f), index }));
      },
      getConfiguration: () => ({ get: (k) => config[k] }),
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
        const ch = { name, lines: [], appendLine: (l) => ch.lines.push(l), dispose() {} };
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
      showWarningMessage: async (m, ...actions) => (rec.messages.push(["warning", m, actions]), messageAnswers.shift()),
      showInformationMessage: async (m, ...actions) => (rec.messages.push(["info", m, actions]), messageAnswers.shift()),
      showErrorMessage: async (m, ...actions) => (rec.messages.push(["error", m, actions]), messageAnswers.shift()),
    },
  };
  return vscode;
}

export const fakeContext = () => ({ subscriptions: [] });
