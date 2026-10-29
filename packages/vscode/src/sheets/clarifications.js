// The clarifications sheet (artifacts/<product>/modules/<module>/clarifications.csv) as the editor sees it, and the
// human's edits to it. Pure: text in, text out; no vscode, no fs.
//
// The contract (packages/core/docs/artifact-contract.md "clarifications.csv", D-009, D-048) gives a human exactly two
// cells per row, and there is no script command that records a human's answer -- `clarifications.mjs` is the agents'
// writer, and its header says "Humans edit the Answer and Answer status columns directly (in Excel or an editor)":
//   Answer         a human may write or rewrite it (agents never overwrite a non-empty one)
//   Answer status  agent-proposed is written only by the script, for an agent's answer; a human sets human-approved
//                  (approving the agent's answer as it stands) or human (after writing or rewriting the answer).
//                  Empty on an answered row counts as human.
// Every other column (ID, Module, Question, Steps to execute, Clarification agent notes, Run ID) is the script's or an
// agent's, so the editor shows them and never writes them. The rules below are the core's readRows/checkComplete rules,
// restated because the extension holds no framework code; the tests run the core's own reader over every edit.
import { parseSheet, setCells } from "./csv.js";

export const HEADERS = ["ID", "Module", "Question", "Steps to execute", "Answer", "Answer status", "Clarification agent notes", "Run ID"];
const KEYS = ["id", "module", "question", "steps", "answer", "answerStatus", "notes", "runId"];
// The 7-column layout from before D-048: read as is; an edit keeps it (the next script write upgrades it).
const LEGACY_HEADERS = HEADERS.filter((h) => h !== "Answer status");
export const ANSWER_STATUSES = ["agent-proposed", "human-approved", "human"];
export const MAX_ANSWER = 32000; // under Excel's 32,767-character cell limit, so the sheet still opens there

const clean = (s) => String(s ?? "").trim();
// An answer as it is stored: trimmed (the core's record() trims) with LF line breaks (the core's renderAnswer joins with
// LF); two answers are the same answer when these agree, so re-saving untouched text never rewrites a cell.
export const normAnswer = (s) => clean(String(s ?? "").replace(/\r\n?/g, "\n"));

// The core's normStatus: case, spaces and underscores ignored; "approved" means human-approved; empty on an answered
// row is human.
export function normStatus(raw, answered) {
  const s = clean(raw).toLowerCase().replace(/[\s_]+/g, "-");
  if (!answered) return s;
  if (!s) return "human";
  return s === "approved" ? "human-approved" : s;
}

// open: no answer. proposed: an answer downstream treats as an assumption (agent-proposed, or a status the contract
// does not know, which the stage check also refuses). answered: a human's answer or one a human approved.
export function rowState(r) {
  if (!clean(r.answer)) return "open";
  return ["human", "human-approved"].includes(r.answerStatus) ? "answered" : "proposed";
}

// -> { doc, layout: "current" | "legacy", rows: [{ record, id, ..., answerStatus, rawStatus, state, problems }] }
// Throws, like the core's readRows, on a header it does not know or values beyond the columns: such a file is not
// edited at all. The clarifications sheet is always comma-separated (the core reads it with ",").
export function readClarifications(text) {
  const doc = parseSheet(text, { delimiter: "," });
  const recs = doc.records.map((r, i) => ({ r, i })).filter(({ r }) => !r.blank);
  if (!recs.length) return { doc, layout: "current", rows: [] };
  const header = recs[0].r.cells.map((c) => clean(c.value));
  const same = (h) => header.length >= h.length && h.every((x, i) => header[i] === x) && header.slice(h.length).every((x) => !x);
  const layout = same(HEADERS) ? "current" : same(LEGACY_HEADERS) ? "legacy" : null;
  if (!layout) throw new Error(`header must be exactly: ${HEADERS.join(" | ")}`);
  const cols = layout === "current" ? HEADERS : LEGACY_HEADERS;
  const counts = new Map();
  const rows = recs.slice(1).map(({ r, i }, n) => {
    const values = r.cells.map((c) => c.value);
    if (values.slice(cols.length).some((v) => clean(v))) throw new Error(`row ${n + 2} has values beyond the ${cols.length} columns`);
    const row = { record: i, line: n + 2 };
    for (const [k, key] of KEYS.entries()) {
      const col = cols.indexOf(HEADERS[k]);
      row[key] = col < 0 ? "" : values[col] ?? "";
    }
    row.rawStatus = row.answerStatus;
    row.answerStatus = normStatus(row.rawStatus, !!clean(row.answer));
    row.state = rowState(row);
    row.problems = [];
    if (row.state !== "open" && !ANSWER_STATUSES.includes(row.answerStatus)) row.problems.push(`Answer status '${row.rawStatus}' is not one of ${ANSWER_STATUSES.join(", ")}`);
    counts.set(clean(row.id), (counts.get(clean(row.id)) ?? 0) + 1);
    return row;
  });
  for (const row of rows) if (counts.get(clean(row.id)) > 1) row.problems.push(`ID '${clean(row.id)}' appears more than once; fix the file before editing this row`);
  return { doc, layout, rows };
}

export function counts(model) {
  const n = (s) => model.rows.filter((r) => r.state === s).length;
  return { total: model.rows.length, open: n("open"), proposed: n("proposed"), answered: n("answered") };
}

// A human's edit of one row: { id, answer, approve }. `answer` is the whole Answer the human wants; `approve: true`
// approves the agent's proposed answer exactly as it stands. The Answer status follows from them, so the editor can
// never write a status the contract does not allow a human to write:
//   answer cleared             -> Answer "" and Answer status ""   (the row is open again)
//   answer changed             -> Answer status human              (a human rewrote it)
//   unchanged, approve         -> Answer status human-approved     (only a proposed answer; never with a changed text)
//   unchanged, no approve      -> nothing is written
// -> { problems: [], cells: [{ record, col, value }] } for the rows that change
export function planEdits(model, edits) {
  const problems = [];
  const cells = [];
  if (!Array.isArray(edits)) return { problems: ["edits must be a list"], cells };
  const byId = new Map();
  for (const r of model.rows) if (!byId.has(clean(r.id))) byId.set(clean(r.id), r);
  const answerCol = (model.layout === "current" ? HEADERS : LEGACY_HEADERS).indexOf("Answer");
  const statusCol = model.layout === "current" ? HEADERS.indexOf("Answer status") : -1;
  const seen = new Set();
  for (const e of edits) {
    const at = (p) => problems.push(`${e?.id ?? "?"}: ${p}`);
    if (!e || typeof e !== "object" || typeof e.id !== "string" || typeof e.answer !== "string" || typeof e.approve !== "boolean") {
      problems.push("each edit is { id, answer, approve }");
      continue;
    }
    const row = byId.get(e.id);
    if (!row) {
      at("no such row in the sheet (it may have been renumbered on disk; reload)");
      continue;
    }
    if (seen.has(e.id)) {
      at("edited twice in one save");
      continue;
    }
    seen.add(e.id);
    if (row.problems.some((p) => p.includes("more than once"))) {
      at(row.problems.join("; "));
      continue;
    }
    if (e.answer.includes("\u0000")) {
      at("the answer contains a NUL character");
      continue;
    }
    const answer = normAnswer(e.answer);
    if (answer.length > MAX_ANSWER) {
      at(`the answer is longer than ${MAX_ANSWER} characters`);
      continue;
    }
    const changed = answer !== normAnswer(row.answer);
    if (e.approve) {
      if (statusCol < 0) at("this sheet has the older layout without an Answer status column: an answer in it is already a human's");
      else if (changed) at("an approval is of the proposed answer as it stands; a rewritten answer is saved as the human's (status human)");
      else if (row.state !== "proposed") at(`only a proposed answer can be approved (this row is ${row.state})`);
      else cells.push({ record: row.record, col: statusCol, value: "human-approved" });
      continue;
    }
    if (!changed) continue;
    cells.push({ record: row.record, col: answerCol, value: answer });
    if (statusCol >= 0) cells.push({ record: row.record, col: statusCol, value: answer ? "human" : "" });
  }
  return { problems, cells };
}

// -> the sheet's new text, or throws with every problem (nothing is applied then)
export function applyEdits(model, edits) {
  const { problems, cells } = planEdits(model, edits);
  if (problems.length) throw Object.assign(new Error(problems.join("\n")), { problems });
  return cells.length ? setCells(model.doc, cells) : model.doc.text;
}

// The evidence a row names: its notes' "Evidence: <path>" lines (module-relative, as the script writes them). The
// editor lists the row's clarification-evidence/<ID>/ folder too; these are the paths the notes point a human at.
export function evidenceRefs(row) {
  return [...String(row.notes ?? "").matchAll(/^Evidence:\s*(\S+)\s*$/gm)].map((m) => m[1].replaceAll("\\", "/"));
}

// The plain view the webview renders (no offsets, no doc).
export function view(model) {
  return {
    layout: model.layout,
    counts: counts(model),
    rows: model.rows.map((r) => ({
      id: clean(r.id), question: r.question, steps: r.steps, answer: r.answer, answerStatus: r.answerStatus, notes: r.notes,
      runId: r.runId, state: r.state, problems: r.problems,
    })),
  };
}
