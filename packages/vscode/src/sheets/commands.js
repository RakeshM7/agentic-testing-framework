// The sheets' command targets and the approve action. No vscode import: the deps are injected, so the tests check
// exactly what reaches the terminal.
//
// Approval is a human's act in their own terminal (D-053, restated by D-066; the user's decision of 2026-10-27 for
// this extension): "Approve module…" opens a VS Code terminal running `atf approve <product> <module>`, where the
// human types the module slug. The extension never runs it in the background (never cli.runJson), never answers the
// prompt, and never writes approvals.json.

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

// The exact arguments of the terminal command: ["approve", product, module].
export function approveArgs(target) {
  const t = targetOf(target);
  if (!t.product || !t.module) throw new Error("Approve module needs a product and a module");
  return ["approve", t.product, t.module];
}

// Opens the human's terminal on `atf approve`. confirmUnsaved(): asked only when an open approval editor for this
// module has unsaved edits (approve records the sheet as saved on disk); false cancels. -> true when the terminal opened
export async function approveModule(target, { cli, cwd, hasUnsaved = () => false, confirmUnsaved = async () => true }) {
  const args = approveArgs(target);
  if (hasUnsaved(args[1], args[2]) && !(await confirmUnsaved(args[1], args[2]))) return false;
  // cli.runInTerminal names the terminal "atf: <name>"
  await cli.runInTerminal(args, { name: `approve ${args[2]}`, ...(cwd ? { cwd } : {}) });
  return true;
}
