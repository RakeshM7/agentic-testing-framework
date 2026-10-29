import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HEADERS, append, checkComplete, isAuthoritative, readRecord, readRows, record, recordOutcome, renderSummary, setSteps, status, summaryPath } from "./lib/clarifications.mjs";
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
  assert.deepEqual(status(file), { total: 3, answered: 1, proposed: [], unconfirmed: ["contacts-2", "contacts-3"] });
  assert.equal(after[0].answerStatus, "human", "an answer a human typed with no status counts as human");
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
  assert.match(md, /Answered: 2 \/ 4 \(awaiting approval: 1\) · Unconfirmed: 2/);
  assert.match(md, /## Awaiting approval\n.*\n- contacts-1\n/);
  assert.match(md, /\| contacts-1 \| .* _\(agent-proposed: awaiting human approval\)_ \|/);
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

// ---- Answer status (D-048) -------------------------------------------------------------------------------------------

test("a file in the older 7-column layout is read as is and rewritten with Answer status on the next write", () => {
  const file = fresh();
  mkdirSync(path.dirname(file), { recursive: true });
  const legacy = HEADERS.filter((h) => h !== "Answer status");
  writeFileSync(file, serializeCsv([legacy, ["contacts-1", "contacts", "Is email required?", "1. Sign in.", "Yes", "seen", "run-a"], ["contacts-2", "contacts", "Max length?", "1. Sign in.", "", "", "run-a"]]));
  const [a, b] = readRows(file);
  assert.deepEqual([a.answer, a.answerStatus, a.notes, a.runId], ["Yes", "human", "seen", "run-a"], "an existing answer is trusted as a human one");
  assert.equal(b.answerStatus, "");
  append(file, "contacts", "run-b", items("Can a contact be merged?"));
  const raw = parseCsv(readFileSync(file, "utf8"));
  assert.deepEqual(raw[0], HEADERS);
  assert.deepEqual(raw[1], ["contacts-1", "contacts", "Is email required?", "1. Sign in.", "Yes", "human", "seen", "run-a"]);
});

test("an agent's answer is agent-proposed until a human approves it; unknown statuses fail the stage check", () => {
  const file = fresh();
  append(file, "contacts", "run-a", items("Is email required?"));
  const row = record(file, "contacts-1", { answer: "Yes", runId: "run-a" });
  assert.equal(row.answerStatus, "agent-proposed");
  assert.equal(isAuthoritative(readRows(file)[0]), false);
  assert.deepEqual(status(file).proposed, ["contacts-1"]);
  assert.deepEqual(checkComplete(file), [], "agent-proposed counts as answered: the run goes on");

  const raw = parseCsv(readFileSync(file, "utf8"));
  raw[1][HEADERS.indexOf("Answer status")] = "Approved"; // a human approves in Excel
  writeFileSync(file, serializeCsv(raw));
  assert.equal(readRows(file)[0].answerStatus, "human-approved");
  assert.equal(isAuthoritative(readRows(file)[0]), true);

  raw[1][HEADERS.indexOf("Answer status")] = "maybe";
  writeFileSync(file, serializeCsv(raw));
  assert.match(checkComplete(file).join("\n"), /contacts-1: Answer status 'maybe' must be one of agent-proposed \| human-approved \| human/);
});

// ---- outcome.json -> recordOutcome (D-048) ---------------------------------------------------------------------------

function outcomeFixture({ mode = "readonly", ledger = [] } = {}) {
  const file = fresh();
  const productDir = path.resolve(path.dirname(file), "..", "..");
  append(file, "contacts", "run-a", items("Is Email required when creating a contact?", "Can a contact be merged?"));
  const ev = (id, name, text) => {
    const p = path.join(path.dirname(file), "clarification-evidence", id, name);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, text);
    return `clarification-evidence/${id}/${name}`;
  };
  const ctx = (id) => ({ id, module: "contacts", runId: "run-a", mode, ledgerEntries: ledger, sourceIds: new Set(["S1"]), productDir });
  return { file, ev, ctx };
}
const confirmed = (ev) => ({
  verdict: "confirmed",
  answer: {
    context: "Signed in as the run's user, on the \"New contact\" form",
    action: "Clicked \"Save\" with \"Email\" empty, twice",
    result: "Not saved; \"Email is required\" appears under \"Email\"; POST /api/contacts returns 422",
    scope: "Create form only; the edit form was not checked",
  },
  basis: ["network", "observed"],
  quotes: ["422"],
  evidence: [
    ev("contacts-1", "observation.md", "# contacts-1\nVerdict: confirmed\nMode: readonly\n"),
    ev("contacts-1", "snapshot-3.md", "- textbox \"Email\" [required]\n- alert: Email   is required\n- button \"Save\"\n"),
    ev("contacts-1", "network-3.txt", "[POST] https://app.acme.test/api/contacts => [422] Unprocessable Entity\n"),
  ],
  followUps: [{ question: "Is Email required when editing a contact?", steps: "1. Sign in.\n2. Open a contact.\n3. Observe whether the contact saves." }],
});
const problemsOf = (fn) => {
  try {
    fn();
  } catch (e) {
    return e.message;
  }
  return "";
};

test("a confirmed outcome backed by its captures is recorded: structured answer, agent-proposed, follow-ups, record.json", () => {
  const { file, ev, ctx } = outcomeFixture();
  const r = recordOutcome(file, confirmed(ev), ctx("contacts-1"));
  assert.deepEqual([r.verdict, r.answerStatus, r.followUps.added], ["confirmed", "agent-proposed", ["contacts-3"]]);
  const [row, , follow] = readRows(file);
  assert.equal(row.answer, [
    "Basis: network, observed",
    "Context: Signed in as the run's user, on the \"New contact\" form",
    "Action: Clicked \"Save\" with \"Email\" empty, twice",
    "Result: Not saved; \"Email is required\" appears under \"Email\"; POST /api/contacts returns 422",
    "Scope: Create form only; the edit form was not checked",
  ].join("\n"));
  assert.match(row.notes, /^\[run-a\] confirmed by clarification-explorer \(network, observed\)\.\nEvidence: clarification-evidence\/contacts-1\/observation\.md\nAwaiting approval/);
  assert.match(follow.notes, /raised while exploring contacts-1; explored in the next run\.\nNext step:/);
  assert.equal(follow.runId, "run-a");
  const rec = readRecord(file, "contacts-1");
  assert.deepEqual([rec.runId, rec.verdict, rec.mode, rec.followUps.added], ["run-a", "confirmed", "readonly", ["contacts-3"]]);
  assert.match(problemsOf(() => recordOutcome(file, confirmed(ev), ctx("contacts-1"))), /already answered/);
});

test("an outcome that does not hold up against its evidence is refused with every problem, and nothing is written", () => {
  const { file, ev, ctx } = outcomeFixture({ mode: "full-run" });
  const o = confirmed(ev);
  o.answer.result = "Not saved; \"Please enter an email\" appears; POST /api/contacts returns 422";
  o.basis = ["network", "dom", "documented:S9"];
  o.evidence = o.evidence.filter((e) => !e.endsWith("snapshot-3.md")).concat("clarification-evidence/contacts-1/step-9.png");
  o.created = [{ type: "contact", ref: "ATF contacts-1" }];
  o.extra = true;
  const err = problemsOf(() => recordOutcome(file, o, ctx("contacts-1")));
  for (const re of [
    /unknown key 'extra'/,
    /evidence 'clarification-evidence\/contacts-1\/step-9.png' does not exist/,
    /basis dom needs a snapshot/,
    /basis documented:S9: no such source/,
    /quote "Please enter an email" appears in no captured text file/,
    /created contact 'ATF contacts-1' is not in state\/ledger.jsonl/,
  ])
    assert.match(err, re);
  assert.equal(readRows(file)[0].answer, "");
  assert.equal(existsSync(path.join(path.dirname(file), "clarification-evidence", "contacts-1", "record.json")), false);

  const mismatch = confirmed(ev);
  ev("contacts-1", "observation.md", "Verdict: unconfirmed\n");
  assert.match(problemsOf(() => recordOutcome(file, mismatch, ctx("contacts-1"))), /says 'Verdict: unconfirmed', the outcome says 'confirmed'/);
});

test("unconfirmed and blocked outcomes need a reason that fits the verdict and mode, a summary and a next step", () => {
  const { file, ev, ctx } = outcomeFixture();
  const obs = ev("contacts-2", "observation.md", "# contacts-2\nVerdict: unconfirmed\nReason: needs-full-run\n");
  const base = { verdict: "unconfirmed", reason: "needs-full-run", summary: "Merging needs a submit; readonly blocks it.", nextStep: "Re-run in full-run.", evidence: [obs] };
  assert.match(problemsOf(() => recordOutcome(file, { ...base, reason: "auth" }, ctx("contacts-2"))), /needs reason one of needs-full-run/);
  assert.match(problemsOf(() => recordOutcome(file, { ...base, verdict: "blocked", reason: "no-valid-record" }, ctx("contacts-2"))), /set by the orchestration script only/);
  assert.match(problemsOf(() => recordOutcome(file, { ...base, nextStep: "" }, ctx("contacts-2"))), /needs a non-empty nextStep/);
  assert.match(problemsOf(() => recordOutcome(file, { ...base, answer: { context: "x" } }, ctx("contacts-2"))), /has no answer/);
  assert.match(problemsOf(() => recordOutcome(file, base, { ...ctx("contacts-2"), mode: "full-run" })), /this run is full-run/);
  recordOutcome(file, base, ctx("contacts-2"));
  const row = readRows(file)[1];
  assert.deepEqual([row.answer, row.answerStatus], ["", ""]);
  assert.equal(row.notes, "[run-a] unconfirmed (needs-full-run): Merging needs a submit; readonly blocks it.\nEvidence: clarification-evidence/contacts-2/observation.md\nNext step: Re-run in full-run.");
  assert.deepEqual(renderSummary(file, "contacts").unconfirmed.find((u) => u.id === "contacts-2"), { id: "contacts-2", next: "Re-run in full-run." });
});

test("entities created in a full-run must be in this run's ledger", () => {
  const ledger = [{ event: "created", runId: "run-a", type: "contact", ref: "ATF contacts-1" }];
  const { file, ev, ctx } = outcomeFixture({ mode: "full-run", ledger });
  const o = { ...confirmed(ev), created: [{ type: "contact", ref: "ATF contacts-1" }] };
  assert.equal(recordOutcome(file, o, ctx("contacts-1")).verdict, "confirmed");
});
