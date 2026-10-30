// The test case approval sheet (artifacts/<product>/modules/<m>/testcases/approval.csv) as the editor sees it, and the
// human's edits to it. Pure: text and parsed JSON in, text out; no vscode, no fs.
//
// The contract (artifact-contract.md "Test cases", agent-handoffs.md §3, D-053 as restated by D-066): the sheet is
// human-only. `testcases.mjs build` renders it -- TC ID, Title, Key steps, Expected, Priority, Approved, Comment,
// Rendered in run, Version (`v` + 12 hex of the case's content hash) -- keeping a human's entries for unchanged cases.
// The human fills Approved (yes, no, changes or blank) and Comment, in Excel or an editor (`,` or `;`), then runs
// `atf approve <product> <module>` in a terminal, or "Approve module…" here, typing the module slug either way (here
// through the framework's one-time confirmation file, commands.js). The approve script alone writes approvals.json,
// each decision pinned to the case's hash; this editor never writes it and writes only the Approved and Comment cells. Staleness is the contract's own: a row whose Version is not the current
// case's (coverage.json `cases[].hash`) is refused by approve, so the editor flags it and takes no decision on it.
// normApproval and versionMatch restate the core's (scripts/lib/testcases.mjs), since the extension holds no framework
// code; the tests run the core's approve over sheets this module wrote.
import { detectDelimiter, parseSheet, setCells } from "./csv.js";

export const APPROVAL_COLUMNS = ["TC ID", "Title", "Key steps", "Expected", "Priority", "Approved", "Comment", "Rendered in run", "Version"];
const REQUIRED = ["TC ID", "Approved", "Version"];
export const DECISIONS = ["", "yes", "no", "changes"]; // what the editor writes; the core also reads synonyms (below)
export const MAX_COMMENT = 32000;

const clean = (s) => String(s ?? "").trim();
const normText = (s) => clean(String(s ?? "").replace(/\r\n?/g, "\n"));

// Excel-friendly, as the core reads it. -> "yes" | "no" | "changes" | "" | null (not understood)
export function normApproval(v) {
  const s = clean(v).toLowerCase().replace(/[\s_]+/g, "-");
  if (!s) return "";
  if (["yes", "y", "approved", "approve", "ok", "x", "true", "1"].includes(s)) return "yes";
  if (["no", "n", "rejected", "reject", "false", "0"].includes(s)) return "no";
  if (["changes", "change", "changes-requested", "change-requested", "request-changes", "needs-changes"].includes(s)) return "changes";
  return null;
}

export const versionOf = (hash) => `v${String(hash).slice(0, 12)}`;
// The core's tolerant Version match: `v` optional, case and spaces ignored, an Excel-numbered cell only when it is
// exactly the digits. -> "match" | "differs" | "unreadable"
export function versionMatch(cell, hash) {
  const want = versionOf(hash).slice(1);
  const v = clean(cell).toLowerCase().replace(/^v/, "");
  if (/^[0-9a-f]{12}$/.test(v)) return v === want ? "match" : "differs";
  if (/^\d{1,12}$/.test(v)) return v.padStart(12, "0") === want ? "match" : "differs";
  return "unreadable";
}

// -> { doc, delimiter, col: {name -> index}, missing: [required columns not found], rows: [...] }
// Any column order, header case-insensitive, `,` or `;`, as the core reads it. Rows without a TC ID are skipped.
export function readApprovalSheet(text) {
  const delimiter = detectDelimiter(text);
  const doc = parseSheet(text, { delimiter });
  const recs = doc.records.map((r, i) => ({ r, i })).filter(({ r }) => !r.blank);
  const header = (recs[0]?.r.cells ?? []).map((c) => clean(c.value).toLowerCase());
  const col = Object.fromEntries(APPROVAL_COLUMNS.map((name) => [name, header.indexOf(name.toLowerCase())]));
  const get = (r, name) => (col[name] < 0 ? "" : clean(r.cells[col[name]]?.value));
  const raw = (r, name) => (col[name] < 0 ? "" : r.cells[col[name]]?.value ?? "");
  const rows = recs
    .slice(1)
    .map(({ r, i }, n) => ({
      record: i, line: n + 2, id: get(r, "TC ID"), title: raw(r, "Title"), keySteps: raw(r, "Key steps"), expected: raw(r, "Expected"),
      priority: get(r, "Priority"), approved: get(r, "Approved"), decision: normApproval(get(r, "Approved")), comment: get(r, "Comment"),
      run: get(r, "Rendered in run"), version: get(r, "Version"),
    }))
    .filter((r) => r.id);
  return { doc, delimiter, col, missing: REQUIRED.filter((c) => col[c] < 0), rows };
}

// The sheet against the current cases (coverage.json) and the recorded decisions (approvals.json, read only).
// coverage/approvals: parsed JSON or null. Per row:
//   sheet     current | changed (Version is an earlier content: approve refuses it) | unreadable (Excel mangled the
//             Version: approve reports it) | not-a-case (no such current case) | unknown (no coverage.json)
//   recorded  approved | rejected | changes (a decision on exactly this content) | awaiting | invalidated (a decision on
//             an earlier content) -- the core's approvalStatus
//   toRecord  the sheet's decision differs from the recorded one, so `approve` would record or clear it
// stale: the sheet no longer describes the cases (a changed or extra row, or a current case it lacks): the next
// testcases build re-renders it, keeping the human's entries for unchanged cases.
export function compare(sheet, coverage, approvals) {
  const cases = new Map((coverage?.cases ?? []).map((c) => [c.id, c]));
  const recorded = approvals?.cases ?? {};
  const rows = sheet.rows.map((r) => {
    const c = cases.get(r.id);
    const sheetState = !coverage ? "unknown" : !c ? "not-a-case" : { match: "current", differs: "changed", unreadable: "unreadable" }[versionMatch(r.version, c.hash)];
    const a = recorded[r.id];
    const rec = !c ? (a ? "invalidated" : "awaiting") : !a ? "awaiting" : a.hash !== c.hash ? "invalidated" : { yes: "approved", no: "rejected", changes: "changes" }[a.decision] ?? "awaiting";
    const recDecision = c && a && a.hash === c.hash ? a.decision : "";
    const toRecord = sheetState === "current" && r.decision !== null && r.decision !== recDecision;
    return { id: r.id, sheet: sheetState, recorded: rec, toRecord };
  });
  const inSheet = new Set(sheet.rows.map((r) => r.id));
  const missing = [...cases.keys()].filter((id) => !inSheet.has(id));
  const changed = rows.filter((r) => r.sheet === "changed" || r.sheet === "not-a-case").map((r) => r.id);
  const unreadable = rows.filter((r) => r.sheet === "unreadable").map((r) => r.id);
  // pending: current cases with no decision on their current content (the core's "awaiting")
  const pending = [...cases.values()].filter((c) => !recorded[c.id] || recorded[c.id].hash !== c.hash).map((c) => c.id);
  const n = (s) => rows.filter((r) => r.recorded === s && cases.has(r.id)).length;
  return {
    built: !!coverage, rows, missing, changed, unreadable, pending, stale: !!coverage && (missing.length > 0 || changed.length > 0),
    counts: { cases: cases.size, pending: pending.length, approved: n("approved"), rejected: n("rejected"), changes: n("changes"), toRecord: rows.filter((r) => r.toRecord).length },
  };
}

// A human's edit of one row: { id, approved, comment } -- the whole Approved and Comment the human wants. Approved is
// one of DECISIONS exactly. A decision is refused on a row approve would refuse (changed or not a current case), so
// the editor never stores a decision that can't be recorded; clearing one and editing a comment stay allowed.
// An Approved cell whose spelling already means the same decision ("Y" for yes) is left as the human wrote it.
// -> { problems: [], cells: [{ record, col, value }] }
export function planEdits(sheet, edits, comparison = null) {
  const problems = [];
  const cells = [];
  if (!Array.isArray(edits)) return { problems: ["edits must be a list"], cells };
  if (sheet.missing.length) return { problems: [`the sheet has no ${sheet.missing.map((c) => `'${c}'`).join(", ")} column; it is rendered by the test cases build`], cells };
  const ids = new Map();
  for (const r of sheet.rows) ids.set(r.id, (ids.get(r.id) ?? 0) + 1);
  const byId = new Map(sheet.rows.map((r) => [r.id, r]));
  const state = new Map((comparison?.rows ?? []).map((r) => [r.id, r.sheet]));
  const seen = new Set();
  for (const e of edits) {
    const at = (p) => problems.push(`${e?.id ?? "?"}: ${p}`);
    if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.approved !== "string" || typeof e.comment !== "string") {
      problems.push("each edit is { id, approved, comment }");
      continue;
    }
    const row = byId.get(e.id);
    if (!row) {
      at("no such row in the sheet (reload: it may have been re-rendered)");
      continue;
    }
    if (ids.get(e.id) > 1) {
      at("this TC ID appears more than once in the sheet; fix the file before editing it");
      continue;
    }
    if (seen.has(e.id)) {
      at("edited twice in one save");
      continue;
    }
    seen.add(e.id);
    if (!DECISIONS.includes(e.approved)) {
      at(`Approved must be one of yes, no, changes or blank, not '${e.approved}'`);
      continue;
    }
    if (e.comment.includes("\u0000")) {
      at("the comment contains a NUL character");
      continue;
    }
    const comment = normText(e.comment);
    if (comment.length > MAX_COMMENT) {
      at(`the comment is longer than ${MAX_COMMENT} characters`);
      continue;
    }
    const decisionChanged = row.decision !== e.approved;
    const commentChanged = comment !== normText(row.comment);
    if (decisionChanged && e.approved) {
      const st = state.get(e.id);
      if (st === "changed") {
        at("the case changed since this row was rendered (its Version is an earlier content): approve would refuse a decision on it; the next test cases build re-renders the row");
        continue;
      }
      if (st === "not-a-case") {
        at("not a current test case: approve would refuse a decision on it");
        continue;
      }
    }
    if (commentChanged && sheet.col.Comment < 0) {
      at("the sheet has no Comment column");
      continue;
    }
    if (decisionChanged) cells.push({ record: row.record, col: sheet.col.Approved, value: e.approved });
    if (commentChanged) cells.push({ record: row.record, col: sheet.col.Comment, value: comment });
  }
  return { problems, cells };
}

// -> the sheet's new text, or throws with every problem (nothing is applied then)
export function applyEdits(sheet, edits, comparison = null) {
  const { problems, cells } = planEdits(sheet, edits, comparison);
  if (problems.length) throw Object.assign(new Error(problems.join("\n")), { problems });
  return cells.length ? setCells(sheet.doc, cells) : sheet.doc.text;
}

// The plain view the webview renders.
export function view(sheet, comparison) {
  const st = new Map(comparison.rows.map((r) => [r.id, r]));
  return {
    delimiter: sheet.delimiter, missing: sheet.missing,
    stale: comparison.stale, built: comparison.built, missingCases: comparison.missing, changed: comparison.changed, unreadable: comparison.unreadable,
    counts: comparison.counts,
    rows: sheet.rows.map((r) => ({
      id: r.id, title: r.title, keySteps: r.keySteps, expected: r.expected, priority: r.priority, approved: r.decision ?? r.approved,
      understood: r.decision !== null, comment: r.comment, run: r.run, version: r.version,
      sheet: st.get(r.id)?.sheet ?? "unknown", recorded: st.get(r.id)?.recorded ?? "awaiting", toRecord: !!st.get(r.id)?.toRecord,
    })),
  };
}
