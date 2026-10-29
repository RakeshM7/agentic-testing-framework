// The sheet models: a human's edits change only the human-owned cells, invalid values are refused, the framework's own
// readers and approve accept what the editor wrote, and the approval sheet's staleness against the cases.
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import * as clar from "../src/sheets/clarifications.js";
import * as appr from "../src/sheets/approval.js";
import { parseSheet } from "../src/sheets/csv.js";
import { checkComplete, readRows, status } from "../../core/scripts/lib/clarifications.mjs";
import { PROPOSED, coreApprove, realSheets } from "./sheets-fixtures.mjs";

// The raw bytes of every cell but the given ones (by column name), row by row: what an edit must not touch.
function untouched(text, header, cols, { delimiter } = {}) {
  const doc = parseSheet(text, delimiter ? { delimiter } : {});
  const idx = cols.map((c) => header.indexOf(c));
  return doc.records.map((r, ri) => r.cells.map((c, ci) => (ri > 0 && idx.includes(ci) ? "*" : text.slice(c.start, c.end))).join("|")).join("\n") + `|bom=${doc.bom}`;
}

test("clarifications: the states and counts of a sheet the framework wrote", async () => {
  const { texts } = await realSheets();
  const m = clar.readClarifications(texts.clarifications);
  assert.equal(m.layout, "current");
  assert.deepEqual(m.rows.map((r) => [r.id, r.state, r.answerStatus]), [["contacts-1", "proposed", "agent-proposed"], ["contacts-2", "open", ""], ["contacts-3", "open", ""]]);
  assert.deepEqual(clar.counts(m), { total: 3, open: 2, proposed: 1, answered: 0 });
});

test("clarifications: answering, approving and rewriting change only Answer and Answer status; the core reads the result", async () => {
  const { files, texts } = await realSheets();
  const m = clar.readClarifications(texts.clarifications);
  const after = clar.applyEdits(m, [
    { id: "contacts-1", answer: PROPOSED, approve: true }, // approve the agent's answer as it stands
    { id: "contacts-2", answer: "Any address with one @ and a dot after it;\r\nthe form says \"Enter a valid email\".  ", approve: false },
    { id: "contacts-3", answer: "", approve: false }, // untouched: nothing written
  ]);
  assert.equal(untouched(after, clar.HEADERS, ["Answer", "Answer status"]), untouched(texts.clarifications, clar.HEADERS, ["Answer", "Answer status"]));
  writeFileSync(files.clarifications, after);
  const rows = readRows(files.clarifications);
  assert.deepEqual(rows.map((r) => [r.id, r.answerStatus]), [["contacts-1", "human-approved"], ["contacts-2", "human"], ["contacts-3", ""]]);
  assert.equal(rows[0].answer, PROPOSED);
  assert.equal(rows[1].answer, 'Any address with one @ and a dot after it;\nthe form says "Enter a valid email".', "trimmed, LF line breaks");
  assert.deepEqual(status(files.clarifications), { total: 3, answered: 2, proposed: [], unconfirmed: ["contacts-3"] });
  assert.deepEqual(checkComplete(files.clarifications, { clarificationsPolicy: "stop" }), ["contacts-3: unanswered -- a human must fill the Answer column (policy: stop)"]);

  // rewriting an approved answer makes it the human's; clearing one reopens the row
  const m2 = clar.readClarifications(after);
  const after2 = clar.applyEdits(m2, [{ id: "contacts-1", answer: "Name is required; the form stays open.", approve: false }, { id: "contacts-2", answer: "  ", approve: false }]);
  writeFileSync(files.clarifications, after2);
  assert.deepEqual(readRows(files.clarifications).map((r) => [r.id, r.answerStatus, r.answer]), [["contacts-1", "human", "Name is required; the form stays open."], ["contacts-2", "", ""], ["contacts-3", "", ""]]);
});

test("clarifications: invalid edits are refused, and nothing is applied", async () => {
  const { texts } = await realSheets();
  const m = clar.readClarifications(texts.clarifications);
  const refused = (edits, re) => {
    const { problems } = clar.planEdits(m, edits);
    assert.ok(problems.some((p) => re.test(p)), `${JSON.stringify(edits)} -> ${problems}`);
    assert.throws(() => clar.applyEdits(m, edits), re);
  };
  refused([{ id: "contacts-2", answer: "", approve: true }], /only a proposed answer can be approved/);
  refused([{ id: "contacts-1", answer: "my own words", approve: true }], /as it stands/);
  refused([{ id: "contacts-9", answer: "x", approve: false }], /no such row/);
  refused([{ id: "contacts-2", answer: "x", approve: "yes" }], /each edit is/);
  refused([{ id: "contacts-2", answer: 7, approve: false }], /each edit is/);
  refused([{ id: "contacts-2", answer: "a\u0000b", approve: false }], /NUL/);
  refused([{ id: "contacts-2", answer: "x".repeat(clar.MAX_ANSWER + 1), approve: false }], /longer than/);
  refused([{ id: "contacts-2", answer: "a", approve: false }, { id: "contacts-2", answer: "b", approve: false }], /twice/);
  // a problem anywhere refuses the whole save
  assert.throws(() => clar.applyEdits(m, [{ id: "contacts-3", answer: "fine", approve: false }, { id: "nope-1", answer: "x", approve: false }]));
});

test("clarifications: the older 7-column layout is kept; a duplicate ID or unknown header is not edited", () => {
  const legacy = "ID,Module,Question,Steps to execute,Answer,Clarification agent notes,Run ID\r\ncontacts-1,contacts,Q?,1. Do.,,,acme-run-1\r\n";
  const m = clar.readClarifications(legacy);
  assert.equal(m.layout, "legacy");
  assert.equal(clar.applyEdits(m, [{ id: "contacts-1", answer: "Yes.", approve: false }]), legacy.replace("1. Do.,,", "1. Do.,Yes.,"));
  assert.throws(() => clar.applyEdits(m, [{ id: "contacts-1", answer: "", approve: true }]), /older layout/);
  const dup = clar.readClarifications(`${clar.HEADERS.join(",")}\r\nc-1,c,Q,S,,,,r\r\nc-1,c,Q2,S,,,,r\r\n`);
  assert.match(clar.planEdits(dup, [{ id: "c-1", answer: "x", approve: false }]).problems[0], /more than once/);
  assert.throws(() => clar.readClarifications("ID;Module\r\n"), /header must be exactly/);
  assert.throws(() => clar.readClarifications(`${clar.HEADERS.join(",")}\r\nc-1,c,Q,S,,,,r,extra\r\n`), /beyond the 8 columns/);
  assert.deepEqual(clar.evidenceRefs({ notes: "[r] confirmed.\nEvidence: clarification-evidence/c-1/observation.md\nAwaiting approval" }), ["clarification-evidence/c-1/observation.md"]);
});

test("approval: Approved and Comment change only those cells, the core's approve records exactly them, in either delimiter", async () => {
  for (const delimiter of [",", ";"]) {
    const { root, product, module, files, ids, texts } = await realSheets();
    let base = texts.approval;
    if (delimiter === ";") {
      // Excel in a comma-decimal locale: the same sheet saved with ";" and a BOM
      const doc = parseSheet(base);
      base = "﻿" + doc.records.map((r) => r.cells.map((c) => (/[;"\r\n,]/.test(c.value) ? `"${c.value.replace(/"/g, '""')}"` : c.value)).join(";")).join("\r\n") + "\r\n";
      writeFileSync(files.approval, base);
    }
    const sheet = appr.readApprovalSheet(base);
    assert.equal(sheet.delimiter, delimiter);
    const coverage = JSON.parse(readFileSync(files.coverage, "utf8"));
    const cmp = appr.compare(sheet, coverage, null);
    assert.equal(cmp.stale, false);
    assert.deepEqual(cmp.counts, { cases: 3, pending: 3, approved: 0, rejected: 0, changes: 0, toRecord: 0 });
    const [list, create, edit] = ["list", "create", "edit"].map((k) => ids.get(k));
    const after = appr.applyEdits(sheet, [
      { id: list, approved: "yes", comment: "" },
      { id: create, approved: "changes", comment: "Say which fields are required; use \"Save\", not \"OK\"" },
      { id: edit, approved: "", comment: "" }, // untouched
    ], cmp);
    assert.equal(untouched(after, appr.APPROVAL_COLUMNS, ["Approved", "Comment"], { delimiter }), untouched(base, appr.APPROVAL_COLUMNS, ["Approved", "Comment"], { delimiter }));
    writeFileSync(files.approval, after);
    const r = await coreApprove(root, product, module);
    assert.equal(r.code, 0, JSON.stringify(r.out));
    assert.deepEqual([...r.out.recorded].sort(), [create, list].sort());
    const approvals = JSON.parse(readFileSync(files.approvals, "utf8"));
    assert.equal(approvals.cases[create].comment, 'Say which fields are required; use "Save", not "OK"');
    // the views read the result back: one approved, one changes, one pending, nothing left to record
    const cmp2 = appr.compare(appr.readApprovalSheet(after), coverage, approvals);
    assert.deepEqual(cmp2.counts, { cases: 3, pending: 1, approved: 1, rejected: 0, changes: 1, toRecord: 0 });
    assert.deepEqual(cmp2.pending, [edit]);
  }
});

test("approval: only yes, no, changes or blank; unknown rows and bad shapes refused; a synonym the human typed is kept", async () => {
  const { ids, texts, files } = await realSheets();
  const sheet = appr.readApprovalSheet(texts.approval);
  const cmp = appr.compare(sheet, JSON.parse(readFileSync(files.coverage, "utf8")), null);
  const list = ids.get("list");
  for (const bad of ["Yes", "approved", "maybe", "y"]) assert.match(appr.planEdits(sheet, [{ id: list, approved: bad, comment: "" }], cmp).problems[0], /must be one of yes, no, changes or blank/);
  assert.match(appr.planEdits(sheet, [{ id: "TC-contacts-99", approved: "yes", comment: "" }], cmp).problems[0], /no such row/);
  assert.match(appr.planEdits(sheet, [{ id: list, approved: "yes" }], cmp).problems[0], /each edit is/);
  assert.match(appr.planEdits(sheet, [{ id: list, approved: "no", comment: "a\u0000" }], cmp).problems[0], /NUL/);
  // "Y" means yes: choosing yes leaves the human's own spelling alone
  const y = appr.applyEdits(sheet, [{ id: list, approved: "yes", comment: "" }], cmp);
  const withY = appr.readApprovalSheet(y.replace(/,yes,/, ",Y,"));
  assert.equal(appr.applyEdits(withY, [{ id: list, approved: "yes", comment: "" }], cmp), withY.doc.text);
  assert.match(appr.planEdits({ ...sheet, missing: ["Version"] }, [], cmp).problems[0], /no 'Version' column/);
});

test("approval: a sheet stale against the cases is flagged, and a decision on a changed row is refused", async () => {
  const { ids, texts, files } = await realSheets();
  const sheet = appr.readApprovalSheet(texts.approval);
  const coverage = JSON.parse(readFileSync(files.coverage, "utf8"));
  const [list, create] = [ids.get("list"), ids.get("create")];
  // the case's content changed after the sheet was rendered, and a new case exists the sheet lacks
  coverage.cases.find((c) => c.id === create).hash = "f".repeat(64);
  coverage.cases.push({ id: "TC-contacts-99", title: "new", hash: "e".repeat(64) });
  const cmp = appr.compare(sheet, coverage, { cases: { [list]: { decision: "yes", hash: coverage.cases.find((c) => c.id === list).hash } } });
  assert.equal(cmp.stale, true);
  assert.deepEqual(cmp.changed, [create]);
  assert.deepEqual(cmp.missing, ["TC-contacts-99"]);
  assert.equal(cmp.rows.find((r) => r.id === list).recorded, "approved");
  assert.equal(cmp.rows.find((r) => r.id === list).toRecord, true, "the sheet's blank differs from the recorded yes: approve would clear it");
  assert.match(appr.planEdits(sheet, [{ id: create, approved: "yes", comment: "" }], cmp).problems[0], /changed since this row was rendered/);
  assert.deepEqual(appr.planEdits(sheet, [{ id: create, approved: "", comment: "noted" }], cmp).problems, [], "a comment on a stale row is still the human's");
  assert.equal(appr.compare(sheet, null, null).built, false);
  assert.equal(appr.versionMatch("V" + coverage.cases[0].hash.slice(0, 12).toUpperCase(), coverage.cases[0].hash), "match");
  assert.equal(appr.versionMatch("1.2E+11", coverage.cases[0].hash), "unreadable");
});
