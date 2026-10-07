// Product-level clarifications CSV: artifacts/<product>/modules/<module>/clarifications.csv
// The ONLY code that writes this file. Agents and humans share it, so every agent write is a locked
// read-modify-write that preserves rows/cells it does not own, and human-entered Answers are never overwritten
// (unless the incoming requirement changed the behavior -- an explicit, recorded flag).
//
// Columns (fixed order): ID | Module | Question | Steps to execute | Answer | Clarification agent notes | Run ID
//   ID      <module>-<n>, n = per-module sequence, assigned here, never reused
//   Run ID  the run that CREATED the row; never changed afterwards

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseCsv, serializeCsv, withFileLock, writeAtomic } from "./csv.mjs";

export const HEADERS = ["ID", "Module", "Question", "Steps to execute", "Answer", "Clarification agent notes", "Run ID"];
const KEYS = ["id", "module", "question", "steps", "answer", "notes", "runId"];
export const UNRESOLVED_POLICIES = ["stop", "continue-flagged"];

export const csvPath = (productDir, module) => path.join(productDir, "modules", module, "clarifications.csv");
const clean = (s) => String(s ?? "").trim();
const normQuestion = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const isAnswered = (r) => clean(r.answer) !== "";

export function readRows(file) {
  if (!existsSync(file)) return [];
  const rows = parseCsv(readFileSync(file, "utf8"));
  if (!rows.length) return [];
  const header = rows[0].map(clean);
  if (HEADERS.some((h, i) => header[i] !== h)) throw new Error(`${file}: header must be exactly: ${HEADERS.join(" | ")}`);
  return rows.slice(1).map((r, i) => {
    if (r.slice(HEADERS.length).some((c) => clean(c))) throw new Error(`${file}: row ${i + 2} has values beyond the ${HEADERS.length} columns`);
    return Object.fromEntries(KEYS.map((k, j) => [k, r[j] ?? ""]));
  });
}

const write = (file, rows) => writeAtomic(file, serializeCsv([HEADERS, ...rows.map((r) => KEYS.map((k) => r[k] ?? ""))]));

function nextNumber(rows, module) {
  const re = new RegExp(`^${module}-(\\d+)$`);
  return rows.reduce((n, r) => Math.max(n, Number(re.exec(clean(r.id))?.[1] ?? 0)), 0) + 1;
}

// items: [{question, steps}] -> appends genuinely new questions (normalized-text de-dup within the module).
export function append(file, module, runId, items) {
  return withFileLock(file, () => {
    const rows = readRows(file);
    const seen = new Map(rows.map((r) => [normQuestion(r.question), r.id]));
    const added = [];
    const duplicates = [];
    let n = nextNumber(rows, module);
    for (const it of items) {
      if (!clean(it.question) || !clean(it.steps)) throw new Error("each item needs a non-empty 'question' and 'steps'");
      const k = normQuestion(it.question);
      if (seen.has(k)) {
        duplicates.push({ question: clean(it.question), existingId: seen.get(k) });
        continue;
      }
      const row = { id: `${module}-${n++}`, module, question: clean(it.question), steps: it.steps.trim(), answer: "", notes: "", runId };
      rows.push(row);
      seen.set(k, row.id);
      added.push(row.id);
    }
    if (added.length) write(file, rows);
    return { added, duplicates };
  });
}

function update(file, id, fn) {
  return withFileLock(file, () => {
    const rows = readRows(file);
    const row = rows.find((r) => clean(r.id) === id);
    if (!row) throw new Error(`${id}: no such row in ${file}`);
    fn(row);
    write(file, rows);
    return row;
  });
}

// question-writer: rewrite Question/Steps of a row that is still unanswered.
export function setSteps(file, id, { question, steps }) {
  return update(file, id, (row) => {
    if (isAnswered(row)) throw new Error(`${id} is already answered; Question/Steps are frozen`);
    if (question !== undefined) row.question = clean(question);
    if (steps !== undefined) row.steps = String(steps).trim();
  });
}

// clarification-writer (and module-explorer for requirement changes): record the outcome of a row.
//   answer -> confirmed behavior (or leave undefined when still unconfirmed)
//   notes  -> why still unconfirmed / what was tried / evidence path
// An answered row is trusted as is: changing it requires requirementChange=true, which is stamped into the notes.
export function record(file, id, { answer, notes, runId, requirementChange = false }) {
  return update(file, id, (row) => {
    if (isAnswered(row) && !requirementChange)
      throw new Error(`${id} is already answered (possibly by a human); it is trusted as is unless --requirement-change`);
    if (answer !== undefined) row.answer = String(answer).trim();
    if (notes !== undefined) row.notes = String(notes).trim();
    if (requirementChange) row.notes = [row.notes, `[${runId}] updated: incoming requirement changed this behavior`].filter(Boolean).join("\n");
  });
}

export function status(file) {
  const rows = readRows(file);
  const open = rows.filter((r) => !isAnswered(r));
  return { total: rows.length, answered: rows.length - open.length, unconfirmed: open.map((r) => clean(r.id)) };
}

// Stage-completion check used by run.mjs (contract CHECKS). Policy comes from the run-config.
export function checkComplete(file, { clarificationsPolicy = "stop" } = {}) {
  let rows;
  try {
    rows = readRows(file);
  } catch (e) {
    return [e.message];
  }
  const problems = [];
  for (const r of rows) {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*-\d+$/.test(clean(r.id))) problems.push(`row '${r.id}': ID must be <module>-<n>`);
    if (!clean(r.question) || !clean(r.steps)) problems.push(`${r.id}: Question and Steps to execute are required`);
    if (!clean(r.runId)) problems.push(`${r.id}: Run ID is required`);
    if (!isAnswered(r)) {
      if (clarificationsPolicy === "stop") problems.push(`${r.id}: unanswered -- a human must fill the Answer column (policy: stop)`);
      else if (!clean(r.notes)) problems.push(`${r.id}: unanswered rows need Clarification agent notes (policy: continue-flagged)`);
    }
  }
  return problems;
}
