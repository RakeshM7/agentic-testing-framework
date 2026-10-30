// The confirmation file: a human's typed confirmation of a human-only command, written by the VS Code extension's dialog
// instead of typed at an interactive terminal (the user's decision, 2026-10-29). The commands are `testcases.mjs approve`,
// `testcases.mjs import … --approved` and `ledger.mjs sweep`. The human types the slug in the extension's dialog; the
// extension writes this one-time JSON file at the ONE path the framework defines for that action and runs the script
// with `--confirm-file <path>`:
//   {action: approve | import-approved | sweep, product, module (approve and import-approved only), environment
//    (sweep: required; otherwise checked when present), typed: what the human typed, nonce: 16-128 of [A-Za-z0-9_-],
//    createdAt, expiresAt: ISO 8601 times at most MAX_LIFETIME_MS apart}
// The script reads only the defined path (a --confirm-file naming any other is refused, and that other file is never
// read or deleted), deletes the file before acting whatever the outcome (use once), and accepts it only when the action,
// product, module and environment are the command's, `typed` is the slug the terminal prompt would require, the file
// has not expired and was not created in the future (beyond CLOCK_SKEW_MS). Anything else refuses, with the reason.
// Where the files live, and why only a human can write them: approval-confirm.json in the module's testcases/ folder,
// which the guard's human-only path rule (testcases/approv*) refuses to every tool call; sweep-confirm.json in the
// environment's state folder, a name the guard refuses to every tool call wherever it is (scripts/lib/guard.mjs). The
// guard also still refuses the commands themselves, --confirm-file or not, so an agent can neither write a
// confirmation nor run the command that would read one. Without --confirm-file nothing changes: the terminal prompt.
import { lstatSync, readFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { SLUG_RE } from "./contract.mjs";

export const APPROVAL_CONFIRM = "approval-confirm.json";
export const SWEEP_CONFIRM = "sweep-confirm.json";
export const CONFIRM_ACTIONS = ["approve", "import-approved", "sweep"];
export const MAX_LIFETIME_MS = 120_000;
export const CLOCK_SKEW_MS = 5_000;
const MAX_BYTES = 4096; // a confirmation is a few hundred bytes; anything bigger is not one
const KEYS = ["action", "product", "module", "environment", "typed", "nonce", "createdAt", "expiresAt"];
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

// Windows paths compare without case; elsewhere a different case is a different path, so it is refused.
const samePath = (a, b, platform = process.platform) => (platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
const rel = (root, f) => path.relative(root, f).replaceAll("\\", "/");

// Deletes the confirmation at its defined path (a link is removed, never followed; a folder is left alone).
// -> whether a file was removed
export function discardConfirmation(file) {
  try {
    if (lstatSync(file).isDirectory()) return false;
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

// given: the --confirm-file argument (relative to root); file: the path the framework defines for this action;
// want: {action, product, module? (approve, import-approved), environment (the session's)}; slug: what the human must
// have typed (the module for approve and import-approved, the product for sweep). The file is deleted on every outcome.
// -> {interactive: {isTTY: true, ask}} (answers the terminal prompt with what the human typed) | {problem}
export function consumeConfirmation(given, { file, root, want, slug, now = Date.now(), platform = process.platform }) {
  const at = rel(root, file);
  const refuse = (why) => ({ problem: `confirmation refused: ${why}${discardConfirmation(file) ? ` (${at} was deleted)` : ""}` });
  if (!CONFIRM_ACTIONS.includes(want.action)) throw new Error(`unknown confirmation action '${want.action}'`);
  for (const k of ["product", ...(want.module !== undefined ? ["module"] : [])])
    if (!SLUG_RE.test(String(want[k]))) return { problem: `confirmation refused: the ${k} '${want[k]}' is not a slug` };
  if (typeof given !== "string" || !given || !samePath(path.resolve(root, given), path.resolve(file), platform))
    return refuse(`--confirm-file must be ${at}, the one path for this ${want.action} (got '${given}'); no other file is read`);
  let st;
  try {
    st = lstatSync(file);
  } catch {
    return { problem: `confirmation refused: there is no confirmation file at ${at} (the dialog writes it just before running the command; it is used once)` };
  }
  if (!st.isFile()) return refuse(`${at} is not a regular file`);
  if (st.size > MAX_BYTES) return refuse(`${at} is larger than ${MAX_BYTES} bytes`);
  let text;
  try {
    text = readFileSync(file, "utf8");
    unlinkSync(file); // use once: gone before anything is checked or done
  } catch (e) {
    return refuse(`${at} could not be read and deleted (${e.code ?? e.message})`);
  }
  const no = (why) => ({ problem: `confirmation refused: ${why} (${at} was deleted)` });
  let c;
  try {
    c = JSON.parse(text);
  } catch {
    return no(`${at} is not valid JSON`);
  }
  if (!c || typeof c !== "object" || Array.isArray(c)) return no(`${at} is not a JSON object`);
  const extra = Object.keys(c).filter((k) => !KEYS.includes(k));
  if (extra.length) return no(`unknown key(s) ${extra.map((k) => `'${k}'`).join(", ")} (allowed: ${KEYS.join(", ")})`);
  if (c.action !== want.action) return no(`the confirmation is for '${c.action}', not '${want.action}'`);
  if (c.product !== want.product) return no(`the confirmation is for product '${c.product}', not '${want.product}'`);
  if (want.module === undefined ? c.module !== undefined : c.module !== want.module)
    return no(want.module === undefined ? `a ${want.action} confirmation names no module (got '${c.module}')` : `the confirmation is for module '${c.module}', not '${want.module}'`);
  if (want.action === "sweep" ? c.environment !== want.environment : c.environment !== undefined && c.environment !== want.environment)
    return no(`the confirmation is for environment '${c.environment}', not this session's '${want.environment}' (ATF_ENV)`);
  if (typeof c.typed !== "string" || c.typed.trim() !== slug) return no(`not confirmed: the slug typed was not '${slug}'`);
  if (typeof c.nonce !== "string" || !NONCE.test(c.nonce)) return no("the nonce must be 16 to 128 letters, digits, '-' or '_'");
  const [created, expires] = [c.createdAt, c.expiresAt].map((t) => (typeof t === "string" && ISO.test(t) ? Date.parse(t) : NaN));
  if (!Number.isFinite(created) || !Number.isFinite(expires)) return no("createdAt and expiresAt must be ISO 8601 times");
  if (expires <= created || expires - created > MAX_LIFETIME_MS) return no(`expiresAt must be after createdAt and at most ${MAX_LIFETIME_MS / 1000} seconds later`);
  if (created > now + CLOCK_SKEW_MS) return no(`createdAt ${c.createdAt} is in the future`);
  if (now > expires) return no(`the confirmation expired at ${c.expiresAt}; confirm again`);
  return { interactive: { isTTY: true, confirmedBy: "file", ask: async () => c.typed } };
}
