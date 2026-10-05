#!/usr/bin/env node
// Deterministic I/O for the clarification questionnaire used by full-product runs. Moved out of the
// orchestrator prompt so quoting, multi-line cells and Excel's BOM never depend on LLM judgment.
//
// Two kinds of file, with strictly separate writers so a human edit and an orchestrator edit can
// never overlap:
//   <clarifications>/questions.csv            MAIN questionnaire. Written ONLY by this script (the
//                                             orchestrator). The human never opens it for editing.
//   <clarifications>/answers/answers-NNN.csv  ANSWER SHEETS, same four headers. Created once by this
//                                             script when a batch of questions is appended, then owned
//                                             by the human: this script only READS them afterwards.
// A question counts as answered when its answer is non-empty in the main file (answers given in chat,
// or already merged) OR in its answer sheet. `merge` copies a fully answered sheet's answers into the
// main file in one atomic write.
//
//   node scripts/clarification-csv.mjs append <main> <items.json> <sheetsDir>
//        items.json = [{module, question, navigation}] -> appends new rows to main (a (module,
//        question) already in main is skipped) and creates the NEXT answer sheet containing exactly
//        those new rows. Never overwrites an existing sheet. {added, skipped, sheet}
//   node scripts/clarification-csv.mjs status <main> <sheetsDir>
//        -> {openTotal, modules: {<m>: {total, answered, open[]}}, sheets: [{file, total, answered,
//           complete, error?}]}
//   node scripts/clarification-csv.mjs answers <main> <sheetsDir> <module>
//        -> [{question, answer}] answered rows for that module
//   node scripts/clarification-csv.mjs answer <main> <module> <question> <answer>
//        -> records an answer given in chat, in the MAIN file (never in a human-owned sheet)
//   node scripts/clarification-csv.mjs merge <main> <sheetsDir>
//        -> for every sheet whose rows are ALL answered, writes its answers into main. {merged: [...]}
//
// Rows are never deleted or reordered; follow-up rounds are appended. Answered = non-empty after trim.

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const HEADERS = [
  "Module",
  "Question",
  "How to navigate the product to understand the question flow",
  "Answer by the user",
];
const SHEET_RE = /^answers-(\d+)\.csv$/; // ignores Excel lock files (~$...), editor temp files, etc.

export function parseCsv(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // Excel BOM
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (inQuotes) throw new Error("unterminated quoted field (file may be mid-save)");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === "")); // drop blank lines
}

export function serializeCsv(rows) {
  const cell = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const answered = (q) => norm(q.answer) !== "";

export function readQuestions(file) {
  if (!existsSync(file)) return [];
  const rows = parseCsv(readFileSync(file, "utf8"));
  if (!rows.length) return [];
  const header = rows[0].map(norm);
  if (HEADERS.some((h, i) => header[i] !== h)) {
    throw new Error(`${file}: header must be exactly: ${HEADERS.join(" | ")}`);
  }
  return rows.slice(1).map((r) => ({
    module: norm(r[0]),
    question: norm(r[1]),
    navigation: r[2] ?? "",
    answer: r[3] ?? "",
  }));
}

function writeAtomic(file, items) {
  mkdirSync(dirname(file), { recursive: true });
  const rows = [HEADERS, ...items.map((q) => [q.module, q.question, q.navigation, q.answer])];
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, serializeCsv(rows), "utf8");
  renameSync(tmp, file);
}

export function listSheets(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => ({ f, m: SHEET_RE.exec(f) }))
    .filter((x) => x.m)
    .sort((a, b) => Number(a.m[1]) - Number(b.m[1]))
    .map((x) => join(dir, x.f));
}

// A sheet the human is mid-save (or has damaged) must never crash a status check or be half-trusted:
// it is reported with `error` and its answers are ignored until it parses cleanly again.
export function readSheets(dir) {
  return listSheets(dir).map((file) => {
    try {
      return { file, items: readQuestions(file) };
    } catch (e) {
      return { file, items: [], error: e.message };
    }
  });
}

const key = (q) => `${q.module}\u0000${q.question}`;

// Main rows with each answer resolved: main's own answer if present, else the answer in its sheet.
export function combined(main, sheets) {
  const fromSheet = new Map();
  for (const s of sheets) for (const q of s.items) if (answered(q) && !fromSheet.has(key(q))) fromSheet.set(key(q), q.answer);
  return main.map((q) => (answered(q) ? q : { ...q, answer: fromSheet.get(key(q)) ?? "" }));
}

export function appendQuestions(mainFile, sheetsDir, incoming) {
  const items = readQuestions(mainFile);
  const seen = new Set(items.map(key));
  const addedItems = [];
  let skipped = 0;
  for (const q of incoming) {
    const row = { module: norm(q.module), question: norm(q.question), navigation: q.navigation ?? "", answer: "" };
    if (!row.module || !row.question) throw new Error("each item needs non-empty module and question");
    if (seen.has(key(row))) {
      skipped++;
      continue;
    }
    seen.add(key(row));
    items.push(row);
    addedItems.push(row);
  }
  writeAtomic(mainFile, items);
  let sheet = null;
  if (addedItems.length) {
    const last = listSheets(sheetsDir).reduce((n, f) => Math.max(n, Number(SHEET_RE.exec(f.split("/").pop())[1])), 0);
    sheet = join(sheetsDir, `answers-${String(last + 1).padStart(3, "0")}.csv`);
    if (existsSync(sheet)) throw new Error(`${sheet} already exists; refusing to overwrite a human-owned sheet`);
    writeAtomic(sheet, addedItems);
  }
  return { added: addedItems.length, skipped, sheet };
}

export function status(mainFile, sheetsDir) {
  const sheets = readSheets(sheetsDir);
  const main = readQuestions(mainFile);
  const items = combined(main, sheets);
  const modules = {};
  for (const q of items) {
    const m = (modules[q.module] ??= { total: 0, answered: 0, open: [] });
    m.total++;
    if (answered(q)) m.answered++;
    else m.open.push(q.question);
  }
  const resolved = new Set(items.filter(answered).map(key));
  return {
    openTotal: Object.values(modules).reduce((n, m) => n + m.open.length, 0),
    modules,
    sheets: sheets.map((s) => ({
      file: s.file,
      total: s.items.length,
      answered: s.items.filter((q) => resolved.has(key(q))).length,
      complete: !s.error && s.items.length > 0 && s.items.every((q) => resolved.has(key(q))),
      ...(s.error && { error: s.error }),
    })),
  };
}

export function answersFor(mainFile, sheetsDir, module) {
  const items = combined(readQuestions(mainFile), readSheets(sheetsDir));
  return items.filter((q) => q.module === norm(module) && answered(q)).map((q) => ({ question: q.question, answer: q.answer.trim() }));
}

// Chat answers go to the MAIN file only; a human-owned sheet is never written after creation.
export function setAnswer(mainFile, module, question, answer) {
  const items = readQuestions(mainFile);
  const hit = items.find((q) => q.module === norm(module) && q.question === norm(question));
  if (!hit) throw new Error(`no row for module '${module}' with that question`);
  hit.answer = answer;
  writeAtomic(mainFile, items);
}

export function mergeSheets(mainFile, sheetsDir) {
  const sheets = readSheets(sheetsDir);
  const main = readQuestions(mainFile);
  const resolved = new Set(combined(main, sheets).filter(answered).map(key));
  const bySheet = new Map();
  for (const s of sheets) {
    if (s.error || !s.items.length || !s.items.every((q) => resolved.has(key(q)))) continue; // only fully clarified sheets
    bySheet.set(s.file, s);
  }
  const merged = [];
  for (const [file, s] of bySheet) {
    let changed = 0;
    for (const q of s.items) {
      const row = main.find((m) => key(m) === key(q));
      if (row && !answered(row) && answered(q)) {
        row.answer = q.answer;
        changed++;
      }
    }
    merged.push({ sheet: file, rowsWritten: changed });
  }
  if (merged.some((m) => m.rowsWritten)) writeAtomic(mainFile, main);
  return { merged };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, main, a, b, c] = process.argv.slice(2);
  try {
    if (!cmd || !main) throw new Error("usage: clarification-csv.mjs append|status|answers|answer|merge <main.csv> ...");
    if (cmd === "append") console.log(JSON.stringify(appendQuestions(main, b, JSON.parse(readFileSync(a, "utf8")))));
    else if (cmd === "status") console.log(JSON.stringify(status(main, a), null, 2));
    else if (cmd === "answers") console.log(JSON.stringify(answersFor(main, a, b), null, 2));
    else if (cmd === "answer") {
      setAnswer(main, a, b, c ?? "");
      console.log(JSON.stringify({ ok: true }));
    } else if (cmd === "merge") console.log(JSON.stringify(mergeSheets(main, a)));
    else throw new Error(`unknown command ${cmd}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
