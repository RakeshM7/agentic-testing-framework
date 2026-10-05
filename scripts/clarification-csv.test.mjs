import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  HEADERS, parseCsv, serializeCsv, appendQuestions, readQuestions, status, answersFor, setAnswer, mergeSheets,
} from "./clarification-csv.mjs";

function fixture() {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), "clar-")), "clarifications");
  return { main: path.join(dir, "questions.csv"), sheets: path.join(dir, "answers") };
}
const Q = (module, question) => ({ module, question, navigation: `nav ${question}` });
const fillSheet = (file, answersByQuestion) => {
  const items = readQuestions(file);
  for (const q of items) q.answer = answersByQuestion[q.question] ?? q.answer;
  writeFileSync(file, serializeCsv([HEADERS, ...items.map((q) => [q.module, q.question, q.navigation, q.answer])]));
};

test("round-trips commas, quotes and newlines", () => {
  const rows = [HEADERS, ["deals", 'Is "Won" final, or reopenable?', "Deals >\n+ New Deal", ""]];
  assert.deepEqual(parseCsv(serializeCsv(rows)), rows);
});

test("parser tolerates Excel BOM and CRLF; an unterminated quote (mid-save) throws", () => {
  assert.equal(parseCsv("﻿" + HEADERS.join(",") + "\r\ndeals,Q1,nav,yes\r\n")[1][3], "yes");
  assert.throws(() => parseCsv('a,"b'), /unterminated/);
});

test("append writes main plus a NEW answer sheet holding exactly the new rows, same headers", () => {
  const { main, sheets } = fixture();
  const r1 = appendQuestions(main, sheets, [Q("deals", "Q1"), Q("contacts", "Q2")]);
  assert.equal(r1.added, 2);
  assert.match(r1.sheet, /answers-001\.csv$/);
  assert.equal(readFileSync(r1.sheet, "utf8").split("\r\n")[0], HEADERS.join(","));
  assert.equal(readQuestions(r1.sheet).length, 2);

  const r2 = appendQuestions(main, sheets, [Q("deals", "Q1"), Q("deals", "Q3")]); // Q1 duplicate
  assert.deepEqual([r2.added, r2.skipped], [1, 1]);
  assert.match(r2.sheet, /answers-002\.csv$/);
  assert.deepEqual(readQuestions(r2.sheet).map((q) => q.question), ["Q3"]);
  assert.equal(readQuestions(main).length, 3);
});

test("a later append never touches an earlier, human-owned sheet", () => {
  const { main, sheets } = fixture();
  const s1 = appendQuestions(main, sheets, [Q("a", "Q1")]).sheet;
  fillSheet(s1, { Q1: "my answer" });
  const before = readFileSync(s1, "utf8");
  const mtime = statSync(s1).mtimeMs;
  appendQuestions(main, sheets, [Q("a", "Q2")]);
  mergeSheets(main, sheets);
  assert.equal(readFileSync(s1, "utf8"), before);
  assert.equal(statSync(s1).mtimeMs, mtime);
});

test("append with nothing new creates no sheet", () => {
  const { main, sheets } = fixture();
  appendQuestions(main, sheets, [Q("a", "Q1")]);
  const r = appendQuestions(main, sheets, [Q("a", "  Q1 ")]);
  assert.deepEqual([r.added, r.sheet], [0, null]);
});

test("status counts answers from sheets and from main; blank/whitespace stays open", () => {
  const { main, sheets } = fixture();
  const s = appendQuestions(main, sheets, [Q("a", "Q1"), Q("a", "Q2"), Q("b", "Q3")]).sheet;
  fillSheet(s, { Q1: "x", Q2: "   " });
  setAnswer(main, "b", "Q3", "via chat");
  const st = status(main, sheets);
  assert.equal(st.openTotal, 1);
  assert.deepEqual(st.modules.a, { total: 2, answered: 1, open: ["Q2"] });
  assert.equal(st.modules.b.answered, 1);
  assert.equal(st.sheets[0].complete, false);
  assert.deepEqual(answersFor(main, sheets, "a"), [{ question: "Q1", answer: "x" }]);
});

test("merge writes a sheet into main only when every row of that sheet is answered", () => {
  const { main, sheets } = fixture();
  const s = appendQuestions(main, sheets, [Q("a", "Q1"), Q("b", "Q2")]).sheet;
  fillSheet(s, { Q1: "one" });
  assert.deepEqual(mergeSheets(main, sheets).merged, []);
  assert.equal(readQuestions(main).every((q) => q.answer === ""), true); // main untouched while incomplete

  fillSheet(s, { Q2: "two" });
  const m = mergeSheets(main, sheets);
  assert.equal(m.merged.length, 1);
  assert.deepEqual(readQuestions(main).map((q) => q.answer), ["one", "two"]);
  assert.deepEqual(mergeSheets(main, sheets).merged.map((x) => x.rowsWritten), [0]); // idempotent
});

test("a chat answer fills the gap so the sheet can complete; main's answer wins", () => {
  const { main, sheets } = fixture();
  const s = appendQuestions(main, sheets, [Q("a", "Q1"), Q("a", "Q2")]).sheet;
  fillSheet(s, { Q1: "sheet one" });
  setAnswer(main, "a", "Q2", "chat two");
  mergeSheets(main, sheets);
  assert.deepEqual(readQuestions(main).map((q) => q.answer), ["sheet one", "chat two"]);
});

test("a half-saved or damaged sheet is reported, ignored, and does not crash status", () => {
  const { main, sheets } = fixture();
  const s = appendQuestions(main, sheets, [Q("a", "Q1")]).sheet;
  writeFileSync(s, 'Module,Question\r\na,"Q1');
  const st = status(main, sheets);
  assert.match(st.sheets[0].error, /unterminated|header/);
  assert.equal(st.openTotal, 1);
  assert.deepEqual(mergeSheets(main, sheets).merged, []);
});

test("only answers-NNN.csv files count as sheets (Excel lock/temp files are ignored)", () => {
  const { main, sheets } = fixture();
  const s = appendQuestions(main, sheets, [Q("a", "Q1")]).sheet;
  writeFileSync(path.join(path.dirname(s), "~$answers-001.csv"), "garbage");
  writeFileSync(path.join(path.dirname(s), "answers-001.csv.tmp"), "garbage");
  assert.equal(status(main, sheets).sheets.length, 1);
});

test("a wrong header in main is rejected rather than silently overwritten", () => {
  const { main, sheets } = fixture();
  appendQuestions(main, sheets, []);
  assert.equal(existsSync(main), true);
  writeFileSync(main, "Module,Question\r\nx,y\r\n");
  assert.throws(() => readQuestions(main), /header must be exactly/);
});

test("setAnswer errors on an unknown question", () => {
  const { main, sheets } = fixture();
  appendQuestions(main, sheets, [Q("a", "Q1")]);
  assert.throws(() => setAnswer(main, "a", "nope", "x"), /no row/);
});
