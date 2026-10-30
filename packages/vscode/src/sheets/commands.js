// The sheets' command targets and the approve action. No vscode import: the deps are injected, so the tests check
// exactly what is asked, written and run.
//
// Approval is a human's act (D-053, restated by D-066), confirmed inside the extension (user, 2026-10-29, superseding
// the terminal route of 2026-10-27): "Approve module…" shows what the saved approval.csv decides, asks the human to
// type the module slug (only an exact match enables OK), then cli.confirmedRun writes the framework's one-time
// confirmation file (testcases/approval-confirm.json, scripts/lib/confirm.mjs) and runs `testcases.mjs approve
// <product> <module> --confirm-file <it>`. The script checks the confirmation and the sheet again, records
// approvals.json and deletes the file. The extension never writes approvals.json, and never approves without the slug
// typed: nothing is written or run on a cancel or a wrong slug.
import { readFile } from "node:fs/promises";
import { lastJson } from "../cli.js";
import { approvalEnvironment } from "../workspace.js";
import { readApprovalSheet } from "./approval.js";
import { decodeSheet } from "./csv.js";
import { sheetPaths } from "./scan.js";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const isSlug = (s) => typeof s === "string" && SLUG.test(s);
export const isRowId = (s) => typeof s === "string" && /^[a-z0-9]+(-[a-z0-9]+)*-\d+$/.test(s);

// A command's argument -- a tree element, a click's { product, module, id? }, or nothing from the palette -- as
// { product?, module?, id? } with only well-formed slugs kept (anything else is asked for again, never used in a path
// or a command line).
export function targetOf(arg) {
  const t = arg && typeof arg === "object" ? arg : {};
  const out = {};
  if (isSlug(t.product)) out.product = t.product;
  if (out.product && isSlug(t.module)) out.module = t.module;
  if (out.module && typeof t.id === "string" && t.id.length <= 200) out.id = t.id;
  return out;
}

// The exact arguments of the approve command: ["approve", product, module] (confirmedRun adds --confirm-file).
export function approveArgs(target) {
  const t = targetOf(target);
  if (!t.product || !t.module) throw new Error("Approve module needs a product and a module");
  return ["approve", t.product, t.module];
}

// The decisions a saved approval.csv holds, as approve reads them: yes, no, changes, blank (a blank clears an earlier
// decision), and cells approve will refuse. -> { yes, no, changes, blank, invalid, rows } | { error }
export function approvalDecisions(text) {
  const sheet = readApprovalSheet(text);
  if (sheet.missing.length) return { error: `approval.csv has no ${sheet.missing.map((c) => `'${c}'`).join(", ")} column` };
  const n = { yes: 0, no: 0, changes: 0, blank: 0, invalid: 0, rows: sheet.rows.length };
  for (const r of sheet.rows) n[r.decision === null ? "invalid" : r.decision === "" ? "blank" : r.decision]++;
  return n;
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function decisionsText(d) {
  return [`${d.yes} yes`, `${d.no} no`, `${d.changes} changes`].join(", ") + (d.blank ? `; ${plural(d.blank, "blank row")} (a blank clears an earlier decision)` : "") + (d.invalid ? `; ${plural(d.invalid, "unreadable decision")}, which approve will report` : "");
}

// What the script answered, in words: { level: info | warning | error, text }.
export function approveOutcome(module, code, out) {
  if (!out) return { level: "error", text: `atf approve ${module}: no answer (exit ${code})` };
  if (out.errors?.length) return { level: "error", text: `atf approve ${module}: ${out.errors.join("; ")}` };
  const rec = out.recorded ?? [];
  const cleared = out.cleared ?? [];
  const now = out.approved !== undefined ? ` Now ${out.approved} approved, ${out.rejected} rejected, ${out.changes} sent back for changes, ${out.awaiting} awaiting.` : "";
  const did = rec.length || cleared.length ? `recorded ${plural(rec.length, "decision")}${cleared.length ? `, cleared ${cleared.length}` : ""}.` : "nothing new to record.";
  const problems = out.problems ?? [];
  if (!problems.length) return { level: code === 0 ? "info" : "error", text: `atf approve ${module}: ${did}${now}` };
  return { level: rec.length || cleared.length ? "warning" : "error", text: `atf approve ${module}: ${rec.length || cleared.length ? did : "nothing was recorded."} ${problems.join("; ")}${now}` };
}

// "Approve module…". deps: vscode (window, ProgressLocation), cli (confirmedRun), root (the workspace), output (the
// atf channel), hasUnsaved(product, module) / confirmUnsaved(product, module): asked only when an open approval editor
// for this module has unsaved edits (approve records the sheet as saved on disk); false cancels. refresh(): the views
// after a run. readText(file): tests may inject it. -> true when the approve command ran
export async function approveModule(target, { vscode, cli, root, output, hasUnsaved = () => false, confirmUnsaved = async () => true, refresh = () => {}, readText = async (f) => decodeSheet(await readFile(f)) }) {
  const [, product, module] = approveArgs(target);
  if (hasUnsaved(product, module) && !(await confirmUnsaved(product, module))) return false;
  const w = vscode.window;
  let text;
  try {
    text = await readText(sheetPaths(root, product, module).approval);
  } catch (e) {
    w.showErrorMessage(`atf approve ${module}: can't read its approval.csv (${e.code ?? e.message})`);
    return false;
  }
  const d = approvalDecisions(text);
  if (d.error) {
    w.showErrorMessage(`atf approve ${module}: ${d.error}; nothing was recorded`);
    return false;
  }
  // 1. what will be recorded
  const go = await w.showInformationMessage(
    `Record the decisions for module ${module}?`,
    { modal: true, detail: `${product} · ${module}: the saved approval.csv has ${decisionsText(d)}. Each decision is pinned to its test case's current version; only approved cases are automated.` },
    "Continue…",
  );
  if (go !== "Continue…") return false;
  // 2. the typed slug: only an exact match enables OK
  const typed = await w.showInputBox({
    title: `Approve module ${module}`,
    prompt: `Type the module slug ${module} to record these decisions`,
    ignoreFocusOut: true,
    validateInput: (v) => (v === module ? null : `Type ${module} exactly to confirm`),
  });
  if (typed !== module) return false; // cancelled: nothing written, nothing run
  // 3. the confirmation file and the script, at once, in the environment whose last run lists the module
  const lines = [];
  let result;
  let error;
  await w.withProgress({ location: vscode.ProgressLocation.Notification, title: `Recording the decisions for ${module}…`, cancellable: true }, async (_progress, token) => {
    try {
      result = await cli.confirmedRun("approve", { product, module, environment: approvalEnvironment(root, product, module) }, { typed, token, onLine: (line, stream) => lines.push({ line, stream }) });
    } catch (e) {
      error = e;
    }
  });
  // 4. the result, and the views
  const showOutput = async (p) => {
    if ((await p) === "Show output") output?.show?.(true);
  };
  if (error) {
    void showOutput(w.showErrorMessage(`atf approve ${module}: ${error.message}`, "Show output"));
    return false;
  }
  if (result.cancelled) {
    w.showWarningMessage(`atf approve ${module} was cancelled.`);
    return true;
  }
  const o = approveOutcome(module, result.code, lastJson(lines));
  const show = o.level === "info" ? w.showInformationMessage : o.level === "warning" ? w.showWarningMessage : w.showErrorMessage;
  void showOutput(show(o.text, "Show output"));
  refresh();
  return true;
}
