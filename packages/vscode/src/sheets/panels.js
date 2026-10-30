// One webview panel per sheet file: the clarifications of a module, or a module's approval sheet. vscode is injected.
//
// Why a webview panel and not a custom editor: the manifest contributes no customEditors (SPEC), and a CustomTextEditor
// saves through VS Code's TextDocument -- its own save, without the framework's lock, the content check or the
// byte-exact cell splice this editor needs. The panel also joins what the CSV alone lacks: a row's evidence files, and
// for approval the current cases (coverage.json) and the recorded decisions (approvals.json). The CSV stays a plain
// file the human can still open as text or in Excel ("Open as text").
//
// Save: the model validates the edits (only the human-owned cells, only allowed values), splices them into the text
// as loaded, and save.js writes it atomically under the file's lock if the bytes on disk are still the ones loaded.
// Otherwise nothing is written and the human chooses: compare (a diff of the disk against their edited version) or
// reload (discarding the edits).
import path from "node:path";
import * as clar from "./clarifications.js";
import * as appr from "./approval.js";
import { validateWebviewMessage } from "./messages.js";
import { loadSheet, saveSheet } from "./save.js";
import { evidenceFiles, readJsonFile, resolveEvidence, sheetPaths } from "./scan.js";
import { makeNonce, renderHtml } from "./webview.js";

export const DIFF_SCHEME = "atf-sheet";

export class SheetPanel {
  // kind: "clarifications" | "approval"; host: { vscode, root, output, pending (Map for the diff provider), onDidSave }
  constructor(kind, product, module, host) {
    Object.assign(this, { kind, product, module, host });
    this.vscode = host.vscode;
    this.paths = sheetPaths(host.root, product, module);
    this.file = kind === "clarifications" ? this.paths.clarifications : this.paths.approval;
    this.loaded = null; // { text, hash, model, view, offered: Map(id -> evidence[]) }
    this.draft = [];
    this.notice = null;
    this.disposables = [];
    const title = `${kind === "clarifications" ? "Clarifications" : "Approval"} · ${product} · ${module}`;
    this.title = title;
    this.panel = this.vscode.window.createWebviewPanel(`atf.${kind}`, title, this.vscode.ViewColumn.Active, {
      enableScripts: true,
      enableForms: false,
      localResourceRoots: [], // the page loads nothing: its style and script are inline, with a nonce
    });
    this.panel.webview.html = renderHtml({ kind, title, nonce: makeNonce() });
    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m).catch((e) => this.status("error", e.message))),
      this.panel.onDidDispose(() => this.dispose())
    );
    this.watch();
  }

  get dirty() {
    return this.draft.length > 0;
  }

  watch() {
    const { vscode } = this;
    const dir = path.dirname(this.file);
    const names = this.kind === "clarifications" ? "clarifications.csv" : "{approval.csv,coverage.json,approvals.json}";
    const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), names));
    let timer = null;
    const changed = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.onDiskChange().catch((e) => this.status("error", e.message)), 250);
    };
    this.disposables.push(w, w.onDidChange(changed), w.onDidCreate(changed), w.onDidDelete(changed), { dispose: () => clearTimeout(timer) });
  }

  // A clean panel follows the disk; a dirty one keeps the human's edits and says the file moved under them (the save
  // will refuse and offer the diff).
  async onDiskChange() {
    const now = await loadSheet(this.file).catch(() => null);
    if (this.kind === "clarifications" && now && this.loaded && now.hash === this.loaded.hash) return;
    if (this.dirty && now?.hash !== this.loaded?.hash) return this.status("warning", "The file changed on disk since you opened it. Saving will let you compare or reload.");
    await this.load({ notice: { level: "info", text: "Reloaded: the files changed on disk." } });
  }

  async load({ notice = null } = {}) {
    this.notice = notice;
    let error = null;
    let readOnlyReason;
    try {
      const { text, hash } = await loadSheet(this.file);
      if (text === null) throw new Error(this.kind === "clarifications" ? "this module has no clarifications.csv yet" : "this module has no approval sheet yet: the test cases build renders it");
      if (this.kind === "clarifications") {
        const model = clar.readClarifications(text);
        const offered = new Map();
        const view = clar.view(model);
        for (const [i, r] of model.rows.entries()) {
          const files = await evidenceFiles(this.host.root, this.product, this.module, r);
          offered.set(view.rows[i].id, files);
          view.rows[i].evidence = files;
        }
        this.loaded = { text, hash, model, view, offered };
      } else {
        const sheet = appr.readApprovalSheet(text);
        const [coverage, approvals] = [await readJsonFile(this.paths.coverage), await readJsonFile(this.paths.approvals)];
        const comparison = appr.compare(sheet, coverage, approvals);
        this.loaded = { text, hash, model: sheet, comparison, view: appr.view(sheet, comparison) };
        if (sheet.missing.length) readOnlyReason = `the sheet has no ${sheet.missing.join(", ")} column`;
      }
    } catch (e) {
      this.loaded = null;
      error = `${path.basename(this.file)} can't be edited here: ${e.message}`;
    }
    this.post({
      type: "load", kind: this.kind, title: this.title, sheet: error ? null : this.loaded.view, draft: this.draft, error,
      readOnly: !!error || !!readOnlyReason, ...(readOnlyReason ? { readOnlyReason } : {}), notice: this.notice,
    });
  }

  post(m) {
    this.panel.webview.postMessage(m);
  }
  status(level, text) {
    this.post({ type: "status", level, text });
  }

  async onMessage(raw) {
    const v = validateWebviewMessage(raw, this.kind);
    if (!v.ok) {
      this.host.output?.appendLine?.(`atf sheets: refused a webview message: ${v.error}`);
      return;
    }
    const m = v.message;
    if (m.type === "ready") return this.load({ notice: this.notice });
    if (m.type === "draft") {
      this.draft = m.edits;
      return;
    }
    if (m.type === "revert") {
      this.draft = [];
      return this.load();
    }
    if (m.type === "reload") {
      if (this.dirty) {
        const pick = await this.vscode.window.showWarningMessage("Reload from disk and discard your unsaved edits?", { modal: true }, "Discard and reload");
        if (pick !== "Discard and reload") return;
      }
      this.draft = [];
      return this.load();
    }
    if (m.type === "openText") return this.vscode.window.showTextDocument(this.vscode.Uri.file(this.file), { preview: false });
    if (m.type === "openEvidence") {
      const abs = this.loaded?.offered ? resolveEvidence(this.host.root, this.product, this.module, this.loaded.offered.get(m.id) ?? [], m.file) : null;
      if (!abs) return this.status("error", `Not an evidence file of ${m.id}: ${m.file}`);
      return this.vscode.commands.executeCommand("vscode.open", this.vscode.Uri.file(abs));
    }
    if (m.type === "approveModule") return this.vscode.commands.executeCommand("atf.approveModule", { product: this.product, module: this.module });
    if (m.type === "save") return this.save(m.edits);
  }

  // -> the new text for the edits, or null after reporting the problems
  applied(edits) {
    try {
      return this.kind === "clarifications" ? clar.applyEdits(this.loaded.model, edits) : appr.applyEdits(this.loaded.model, edits, this.loaded.comparison);
    } catch (e) {
      this.status("error", `Nothing was saved:\n${(e.problems ?? [e.message]).join("\n")}`);
      return null;
    }
  }

  async save(edits) {
    if (!this.loaded) return this.status("error", "Nothing to save: the sheet could not be loaded.");
    this.draft = edits;
    const text = this.applied(edits);
    if (text === null) return;
    const r = await saveSheet(this.file, this.loaded.hash, text).catch((e) => ({ error: e.message }));
    if (r.error) return this.status("error", `Not saved: ${r.error}`);
    if (r.conflict) return this.conflict(text, r);
    this.draft = [];
    await this.load({ notice: { level: "info", text: r.saved ? `Saved ${path.basename(this.file)}.` : "Nothing to save: the sheet already says that." } });
    this.host.onDidSave?.();
    if (this.kind === "approval" && r.saved) this.status("info", "Saved. Nothing is approved yet: Approve module… records the saved sheet after you type the module slug.");
  }

  async conflict(text, r) {
    const { vscode } = this;
    const pick = await vscode.window.showWarningMessage(
      `${path.basename(this.file)} changed on disk since you opened it (a run or another editor wrote it). Nothing was saved.`,
      { modal: true },
      "Compare",
      "Reload (discard my edits)"
    );
    if (pick === "Compare") {
      const uri = vscode.Uri.from({ scheme: DIFF_SCHEME, path: `/${this.product}/${this.module}/${path.basename(this.file)}`, query: String(Date.now()) });
      this.host.pending.set(uri.toString(), text);
      await vscode.commands.executeCommand("vscode.diff", vscode.Uri.file(this.file), uri, `${path.basename(this.file)}: on disk ↔ your unsaved edits`);
      this.status("warning", "Not saved. Your edits are kept here: reload to see the disk's version (your edits are discarded), or keep editing and copy what you need.");
    } else if (pick === "Reload (discard my edits)") {
      this.draft = [];
      await this.load({ notice: { level: "info", text: "Reloaded from disk; your edits were discarded." } });
    } else this.status("warning", "Not saved: the file changed on disk. Compare or reload before saving.");
  }

  reveal() {
    this.panel.reveal();
  }

  close() {
    this.panel.dispose(); // fires onDidDispose -> dispose()
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const d of this.disposables.splice(0)) d?.dispose?.();
    this.host.onDidDispose?.(this);
  }
}
