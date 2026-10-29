// The two views, atf.clarifications and atf.approvals: TreeDataProviders over scan.js. vscode is injected, so the tests
// drive them with a stub. The elements are plain objects { kind, product, module, id? }, the same shape the commands
// take, so a context-menu command (which VS Code calls with the element) and a click (the item's command arguments)
// reach the handler the same way.
import { approvalsLabel, clarificationsLabel } from "./scan.js";

export const CONTEXT = {
  clarificationProduct: "atf.clarificationProduct",
  clarificationModule: "atf.clarificationModule",
  clarificationRow: "atf.clarificationRow", // the spec's menu context
  approvalProduct: "atf.approvalProduct",
  approvalModule: "atf.approvalModule", // the spec's menu context: Open approval sheet, Approve module…
  approvalCase: "atf.approvalCase",
};

const firstLine = (s, max = 90) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

// The children of an element (undefined = the root), from the scan's data.
export function clarificationsChildren(data, el) {
  if (!el) return data.map((p) => ({ kind: "product", product: p.product, counts: p.counts }));
  if (el.kind === "product") return (data.find((p) => p.product === el.product)?.modules ?? []).map((m) => ({ kind: "module", product: m.product, module: m.module, counts: m.counts, error: m.error }));
  if (el.kind === "module") {
    const m = data.find((p) => p.product === el.product)?.modules.find((x) => x.module === el.module);
    return (m?.rows ?? []).map((r) => ({ kind: "row", product: el.product, module: el.module, id: r.id, question: r.question, state: r.state }));
  }
  return [];
}

export function approvalsChildren(data, el) {
  if (!el) return data.map((p) => ({ kind: "product", product: p.product, counts: p.counts }));
  if (el.kind === "product")
    return (data.find((p) => p.product === el.product)?.modules ?? []).map((m) => ({ kind: "module", product: m.product, module: m.module, counts: m.counts, stale: m.stale, exists: m.exists, error: m.error }));
  if (el.kind === "module") {
    const m = data.find((p) => p.product === el.product)?.modules.find((x) => x.module === el.module);
    return (m?.pending ?? []).map((c) => ({ kind: "case", product: el.product, module: el.module, id: c.id, title: c.title }));
  }
  return [];
}

const target = (el) => ({ product: el.product, module: el.module, ...(el.id ? { id: el.id } : {}) });

export function clarificationsItem(vscode, el) {
  const S = vscode.TreeItemCollapsibleState;
  if (el.kind === "product") {
    const item = new vscode.TreeItem(el.product, S.Expanded);
    item.description = clarificationsLabel(el.counts);
    item.contextValue = CONTEXT.clarificationProduct;
    item.iconPath = new vscode.ThemeIcon("package");
    return item;
  }
  if (el.kind === "module") {
    const item = new vscode.TreeItem(el.module, el.error ? S.None : (el.counts?.open ?? 0) + (el.counts?.proposed ?? 0) ? S.Collapsed : S.None);
    item.description = el.error ? `unreadable: ${firstLine(el.error, 60)}` : clarificationsLabel(el.counts);
    item.tooltip = el.error ?? undefined;
    item.contextValue = CONTEXT.clarificationModule;
    item.iconPath = new vscode.ThemeIcon(el.error ? "warning" : "question");
    item.command = { command: "atf.openClarifications", title: "Open clarifications", arguments: [target(el)] };
    return item;
  }
  const item = new vscode.TreeItem(el.id, S.None);
  item.description = `${el.state === "proposed" ? "awaiting approval · " : ""}${firstLine(el.question)}`;
  item.tooltip = el.question;
  item.contextValue = CONTEXT.clarificationRow;
  item.iconPath = new vscode.ThemeIcon(el.state === "proposed" ? "pass" : "circle-outline");
  item.command = { command: "atf.openClarifications", title: "Open clarifications", arguments: [target(el)] };
  return item;
}

export function approvalsItem(vscode, el) {
  const S = vscode.TreeItemCollapsibleState;
  if (el.kind === "product") {
    const item = new vscode.TreeItem(el.product, S.Expanded);
    item.description = approvalsLabel(el.counts, { stale: (el.counts?.stale ?? 0) > 0 });
    item.contextValue = CONTEXT.approvalProduct;
    item.iconPath = new vscode.ThemeIcon("package");
    return item;
  }
  if (el.kind === "module") {
    const item = new vscode.TreeItem(el.module, !el.error && el.counts?.pending ? S.Collapsed : S.None);
    item.description = el.error ? `unreadable: ${firstLine(el.error, 60)}` : !el.exists ? "no approval sheet yet" : approvalsLabel(el.counts, { stale: el.stale });
    item.tooltip = el.error ?? undefined;
    item.contextValue = CONTEXT.approvalModule;
    item.iconPath = new vscode.ThemeIcon(el.error || el.stale ? "warning" : "checklist");
    item.command = { command: "atf.openApproval", title: "Open approval sheet", arguments: [target(el)] };
    return item;
  }
  const item = new vscode.TreeItem(el.id, S.None);
  item.description = firstLine(el.title);
  item.tooltip = el.title;
  item.contextValue = CONTEXT.approvalCase;
  item.iconPath = new vscode.ThemeIcon("circle-outline");
  item.command = { command: "atf.openApproval", title: "Open approval sheet", arguments: [target(el)] };
  return item;
}

// A TreeDataProvider over `load()` (an async scan). The scan runs once per refresh, not once per expanded node.
export class SheetTree {
  constructor(vscode, { load, children, item, onError }) {
    this.vscode = vscode;
    this.load = load;
    this.childrenOf = children;
    this.itemOf = item;
    this.onError = onError ?? (() => {});
    this.data = null;
    this.emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this.emitter.event;
  }
  refresh() {
    this.data = null;
    this.emitter.fire(undefined);
  }
  async getChildren(el) {
    if (!this.data) {
      try {
        this.data = await this.load();
      } catch (e) {
        this.onError(e);
        this.data = [];
      }
    }
    return this.childrenOf(this.data, el);
  }
  getTreeItem(el) {
    return this.itemOf(this.vscode, el);
  }
  dispose() {
    this.emitter.dispose?.();
  }
}
