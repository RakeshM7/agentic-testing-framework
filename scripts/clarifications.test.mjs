import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HEADERS, append, readRows, record, renderSummary, setSteps, status, summaryPath } from "./lib/clarifications.mjs";
import { parseCsv, serializeCsv } from "./lib/csv.mjs";

const fresh = () => path.join(mkdtempSync(path.join(tmpdir(), "clar-")), "modules", "contacts", "clarifications.csv");
const items = (...qs) => qs.map((q) => ({ question: q, steps: "1. Sign in.\n2. Open Contacts from the left menu.\n3. Click 'New contact'." }));

test("append assigns <module>-<n> ids, stamps the creating run, and writes the exact header", () => {
  const file = fresh();
  const r = append(file, "contacts", "run-a", items("Is email required?", "Can two contacts share an email?"));
  assert.deepEqual(r.added, ["contacts-1", "contacts-2"]);
  const raw = parseCsv(readFileSync(file, "utf8"));
  assert.deepEqual(raw[0], HEADERS);
  assert.equal(readRows(file)[1].runId, "run-a");
  assert.match(readRows(file)[0].steps, /\n2\. Open Contacts/, "multi-line steps survive the round trip");
});

test("new rows de-duplicate against existing questions; numbering continues and is never reused", () => {
  const file = fresh();
  append(file, "contacts", "run-a", items("Is email required?"));
  const r = append(file, "contacts", "run-b", items("is EMAIL required", "Can a contact be merged?"));
  assert.deepEqual(r.added, ["contacts-2"]);
  assert.equal(r.duplicates[0].existingId, "contacts-1");
  assert.equal(readRows(file)[0].runId, "run-a", "Run ID stays the creating run");
});

test("human answers typed into the CSV (Excel BOM) are preserved by later agent writes", () => {
  const file = fresh();
  append(file, "contacts", "run-a", items("Is email required?", "Max name length?"));
  const rows = parseCsv(readFileSync(file, "utf8"));
  rows[1][4] = "Yes, email is mandatory"; // human fills Answer of contacts-1
  writeFileSync(file, "﻿" + serializeCsv(rows));
  append(file, "contacts", "run-a", items("Can a contact be deleted?"));
  record(file, "contacts-2", { notes: "Field has no visible limit; could not confirm", runId: "run-a" });
  const after = readRows(file);
  assert.equal(after[0].answer, "Yes, email is mandatory");
  assert.equal(after.length, 3);
  assert.deepEqual(status(file), { total: 3, answered: 1, unconfirmed: ["contacts-2", "contacts-3"] });
});

test("answered rows are trusted as is; only a requirement change may update them, and it is recorded", () => {
  const file = fresh();
  append(file, "contacts", "run-a", items("Is email required?"));
  record(file, "contacts-1", { answer: "Yes", runId: "run-a" });
  assert.throws(() => record(file, "contacts-1", { answer: "No", runId: "run-b" }), /trusted as is/);
  assert.throws(() => setSteps(file, "contacts-1", { steps: "x" }), /frozen/);
  record(file, "contacts-1", { answer: "No (optional since v2 requirement)", runId: "run-b", requirementChange: true });
  const [row] = readRows(file);
  assert.equal(row.answer, "No (optional since v2 requirement)");
  assert.match(row.notes, /\[run-b\] updated: incoming requirement changed/);
  assert.equal(row.runId, "run-a");
});

test("the summary is rendered from the CSV: totals, every row, and a next step for each unanswered row", () => {
  const empty = fresh();
  const none = renderSummary(empty, "contacts");
  assert.deepEqual([none.total, none.unconfirmed], [0, []]);
  assert.match(readFileSync(summaryPath(empty), "utf8"), /## Needs a human\nNone\./, "written even when the module has no rows");

  const file = fresh();
  append(file, "contacts", "run-a", items("Is email required?", "Can a contact be merged?", "Is a phone | fax kept?", "Who sees deleted contacts?"));
  record(file, "contacts-1", { answer: "Yes, creating a contact without an email shows 'Email is required'.", notes: "Confirmed by observation", runId: "run-a" });
  record(file, "contacts-2", { notes: "Merge needs a full-run.\nNext step: re-run in full-run, or answer from the admin guide.", runId: "run-a" });
  record(file, "contacts-3", { notes: "Blocked: CAPTCHA on save.", runId: "run-a" });
  // a human answers contacts-4 in Excel; the summary shows their answer
  const raw = parseCsv(readFileSync(file, "utf8"));
  raw[4][4] = "Only admins";
  writeFileSync(file, serializeCsv(raw));

  const s = renderSummary(file, "contacts");
  assert.deepEqual([s.total, s.answered], [4, 2]);
  assert.deepEqual(s.unconfirmed, [
    { id: "contacts-2", next: "re-run in full-run, or answer from the admin guide." },
    { id: "contacts-3", next: "Blocked: CAPTCHA on save." },
  ]);
  const md = readFileSync(s.file, "utf8");
  assert.match(md, /Answered: 2 \/ 4 · Unconfirmed: 2/);
  assert.match(md, /\| contacts-4 \| Who sees deleted contacts\? \| Only admins \|/);
  assert.match(md, /\| contacts-3 \| Is a phone \\\| fax kept\? \| Unconfirmed \|/, "pipes in cells are escaped");
  assert.match(md, /- contacts-2: re-run in full-run/);
});

test("unanswered rows can be refined, answered rows cannot", () => {
  const file = fresh();
  append(file, "contacts", "run-a", items("email req?"));
  setSteps(file, "contacts-1", { question: "Is the Email field required when creating a contact?", steps: "1. Sign in.\n2. Open Contacts." });
  assert.equal(readRows(file)[0].question, "Is the Email field required when creating a contact?");
  assert.throws(() => setSteps(file, "contacts-9", { steps: "x" }), /no such row/);
  record(file, "contacts-1", { answer: "Yes", runId: "run-a" });
  assert.throws(() => setSteps(file, "contacts-1", { steps: "1. Sign in." }), /frozen/);
});

test("a corrupted header or extra filled columns are rejected, not silently misread", () => {
  const file = fresh();
  append(file, "contacts", "run-a", items("q?"));
  writeFileSync(file, readFileSync(file, "utf8").replace("Steps to execute", "Steps"));
  assert.throws(() => readRows(file), /header must be exactly/);
});
