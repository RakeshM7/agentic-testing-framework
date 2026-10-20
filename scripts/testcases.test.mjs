// scripts/testcases.mjs: test cases built from coverage items, rendered from structured cases, approved by a human.
// The fixtures are written in the G2 (explore model.json, interactions.json with field constraints, flows) and G1
// (knowledge rule-facts.json) formats, and validated against those schemas first.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { main } from "./testcases.mjs";
import { gate } from "./gate.mjs";
import { append, csvPath, record } from "./lib/clarifications.mjs";
import { loadJson, paths, validateData } from "./lib/contract.mjs";
import { parseCsv, serializeCsv } from "./lib/csv.mjs";
import { APPROVAL_COLUMNS, CASE_COLUMNS, MAX_COVERS, caseHash, checkTestcases, conditionsOf, countCases, decisionTable, normApproval, parseCases, testcaseContext, testcasesUnverified, versionMatch, versionOf } from "./lib/testcases.mjs";
import { buildCatalogue, humanEdit, put, startRun } from "./test-helpers.mjs";

const MOD = "artifacts/acme/modules/contacts";
const URL = "https://app.acme.test/contacts";
const MODEL = {
  module: "contacts", runId: "acme-run-1", mode: "readonly",
  budgets: { max_states: 150, max_pages: 40, states: 2, pages: 1, reached: { states: false, pages: false } },
  prefixes: ["/contacts"],
  pages: [{ id: "PG-contacts-1", slug: "contacts", template: "/contacts", url: URL, title: "Contacts", states: ["ST-contacts-1", "ST-contacts-2"] }],
  states: [
    { id: "ST-contacts-1", fingerprint: "0123456789abcdef", page: "PG-contacts-1", url: URL, title: "Contacts", snapshot: "pages/contacts/states/ST-contacts-1.md", reach: { from: "ST-contacts-1", url: URL, steps: [] }, frontier: 2 },
    { id: "ST-contacts-2", fingerprint: "fedcba9876543210", page: "PG-contacts-1", url: URL, title: "Contacts", snapshot: "pages/contacts/states/ST-contacts-2.md", reach: { from: "ST-contacts-1", url: URL, steps: ['button "New contact"'] }, frontier: 3 },
  ],
  transitions: [{ from: "ST-contacts-1", actions: ['button "New contact"'], items: ["FR-contacts-1"], to: "ST-contacts-2" }],
  frontier: [{ id: "FR-contacts-1", state: "ST-contacts-1", role: "button", name: "New contact", kind: "control", status: "mapped", refs: ["ST-contacts-2"], by: "script" }],
};
const field = (n, state, role, name, kind, extra = {}) => ({ id: `FR-contacts-${n}`, state, page: "contacts", element: `${role} ${JSON.stringify(name)}`, role, name, kind, mutates: false, tried: false, status: "excluded", reason: "not-allowed-in-mode", ...extra });
const INTERACTIONS = [
  { ...field(1, "ST-contacts-1", "button", "New contact", "button"), tried: true, status: "mapped", reason: undefined },
  field(2, "ST-contacts-2", "textbox", "Email *", "input", { required: true, inputType: "text", maxlength: 50 }),
  field(3, "ST-contacts-2", "combobox", "Stage", "select", { options: ["Lead", "Customer"], inputType: "select" }),
  field(4, "ST-contacts-2", "checkbox", "Subscribed", "checkbox", { status: "pending", reason: undefined }),
  field(5, "ST-contacts-1", "searchbox", "Search", "input", { reason: "duplicate-of" }),
].map((i) => JSON.parse(JSON.stringify(i)));
const RULE_FACTS = {
  module: "contacts",
  facts: [
    { file: "modules/contacts/notes.md", line: 9, category: "rules", text: '- Record names are unique per account [S1 "must be unique within the account"].', citations: [{ source: "S1", quote: "must be unique within the account", evidence: "script-fetched" }], evidence: "script-fetched" },
    { file: "modules/contacts/notes.md", line: 10, category: "rules", text: '- A deal can be closed only when it has an owner and an amount [S2 "closed only when it has an owner and an amount"].', citations: [{ source: "S2", quote: "closed only when it has an owner and an amount", evidence: "agent-capture" }], evidence: "agent-capture" },
  ],
};

// steps: the run's steps (decision 11 derives the case types from them). The UI-only default keeps these fixtures free of
// the @api / @performance items a run with playwright-api or k6 enumerates from the endpoint catalogue.
function setup({ format, maxCases, g2 = true, steps = ["explore", "clarifications", "testcases", "playwright-ui"] } = {}) {
  const extra = format || maxCases ? [`testcases: {${[format && `output_format: ${format}`, maxCases && `max_cases: ${maxCases}`].filter(Boolean).join(", ")}}`] : [];
  if (steps) extra.push(`steps: [${steps.join(", ")}]`);
  const { root } = startRun({ extra });
  if (g2) {
    put(root, `${MOD}/explore/model.json`, JSON.stringify(MODEL));
    put(root, `${MOD}/explore/interactions.json`, JSON.stringify(INTERACTIONS));
  }
  put(root, `${MOD}/explore/flows/create-contact.md`, "# Create a contact\n\nST-contacts-1 -> ST-contacts-2: the dialog opens.\n");
  put(root, `${MOD}/explore/pages/contacts/states/ST-contacts-2.md`, '- dialog "New contact":\n  - textbox "Email *"\n  - alert: Email is required\n');
  put(root, "artifacts/acme/knowledge/modules/contacts/rule-facts.json", JSON.stringify(RULE_FACTS));
  put(root, "artifacts/acme/knowledge/modules/contacts/notes.md", ["# notes", ...Array.from({ length: 11 }, (_, i) => `line ${i + 2}`)].join("\n"));
  const csv = csvPath(paths("acme", root).productDir, "contacts");
  append(csv, "contacts", "acme-run-1", [1, 2, 3].map((n) => ({ question: `What happens on save ${n}?`, steps: "1. Open Contacts." })));
  record(csv, "contacts-1", { answer: 'Saving shows "Contact created".', runId: "acme-run-1" });
  humanEdit(csv, "contacts-1", { status: "human" });
  record(csv, "contacts-2", { answer: "Duplicates are refused.", runId: "acme-run-1" }); // agent-proposed
  // the human at an interactive terminal, typing the module slug (approve refuses anything else)
  const human = { isTTY: true, ask: async () => "contacts" };
  const tc = (...args) => main([args[0], "acme", "contacts", ...args.slice(1)], { root, interactive: human });
  const tcAs = (interactive, ...args) => main([args[0], "acme", "contacts", ...args.slice(1)], { root, interactive });
  const tp = testcaseContext({ root, product: "acme", module: "contacts", run: loadJson(paths("acme", root).runFile), cfg: loadJson(paths("acme", root).configFile), productDir: paths("acme", root).productDir }).tp;
  const cov = () => loadJson(tp.coverage);
  const overlay = (o) => put(root, `${MOD}/testcases/cases.json`, JSON.stringify(o, null, 2));
  return { root, csv, tc, tcAs, tp, cov, overlay };
}

const kase = (key, covers, over = {}) => ({
  key, title: `The ${key.replaceAll("-", " ")} behaves as observed`, type: "functional", priority: "p2",
  preconditions: ["The user is signed in"], action: "the user saves a new contact", steps: ["Open Contacts", 'Select "New contact"'],
  expected: "the contact is saved", data: { email: "jane.doe@example.test" }, covers, evidence: ["observation:explore/flows/create-contact.md"], ...over,
});
// One case per coverage item: the overlay a writer would end with.
const fullOverlay = (items) => ({ cases: items.map((i) => kase(`case-${i.id.toLowerCase()}`, [i.id], i.technique === "clarification" ? { evidence: [`clarification:${i.subject}`] } : {})) });
const editApproval = (tp, edits) => {
  const rows = parseCsv(readFileSync(tp.approvalCsv, "utf8"));
  const col = (n) => rows[0].indexOf(n);
  for (const [id, approved, comment] of edits) {
    const r = rows.find((x) => x[0] === id);
    r[col("Approved")] = approved;
    if (comment !== undefined) r[col("Comment")] = comment;
  }
  writeFileSync(tp.approvalCsv, serializeCsv(rows));
};
const approvalRow = (tp, id) => {
  const rows = parseCsv(readFileSync(tp.approvalCsv, "utf8"));
  return Object.fromEntries(rows[0].map((h, i) => [h, rows.find((r) => r[0] === id)?.[i]]));
};

test("the fixtures are in the G2 and G1 formats", async () => {
  assert.deepEqual(await validateData("explore-model", MODEL), []);
  assert.deepEqual(await validateData("interactions", INTERACTIONS), []);
  assert.deepEqual(await validateData("knowledge-rule-facts", RULE_FACTS), []);
});

test("items: EP/BVA per field, one per transition, flow, rule fact, decision-table row and answered clarification", async () => {
  const s = setup();
  const r = await s.tc("items");
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.degraded, []);
  assert.deepEqual(r.out.byTechnique, { ep: 1, required: 1, bva: 2, enum: 3, boolean: 2, "state-transition": 1, flow: 1, rule: 1, "decision-table": 3, clarification: 2 });
  const labels = r.out.items.map((i) => i.label);
  for (const l of ["Email: a valid value", "Email: left empty (required)", "Email: 50 characters (the maximum)", "Email: 51 characters (just above the maximum)", 'Stage: the option "Lead"', 'Stage: the option "Customer"', "Stage: a value outside its options", "Subscribed: checked", "Subscribed: unchecked", "Create a contact", "What happens on save 1?", "What happens on save 2?"])
    assert.ok(labels.includes(l), l);
  assert.ok(!labels.some((l) => l.startsWith("Search")), "a script-derived duplicate is not a field of its own");
  assert.ok(!labels.some((l) => l.includes("save 3")), "an open clarification is not an item");
  assert.ok(labels.includes("ST-contacts-1 → ST-contacts-2 by button \"New contact\""));
  const dt = r.out.items.filter((i) => i.technique === "decision-table").map((i) => i.label.split(" -- ")[1]).sort();
  assert.deepEqual(dt, ["\"an amount\" does not hold (the others do) -> the rule does not apply", '"it has an owner" does not hold (the others do) -> the rule does not apply', "every condition holds -> the rule applies"]);
  assert.ok(r.out.items.every((i) => /^CI-contacts-\d+$/.test(i.id)));
  assert.equal(r.out.items.find((i) => i.technique === "enum").priority, "p3");
  assert.equal(r.out.items.find((i) => i.technique === "clarification").priority, "p1");
});

test("conditions and the collapsed decision table: N + 1 rows for AND and OR rules", () => {
  assert.deepEqual(conditionsOf("If the contact has an email, a phone and an owner, it can be merged."), { conditions: ["the contact has an email", "a phone", "an owner"], connective: "and" });
  assert.deepEqual(conditionsOf("A reminder is sent when the task is overdue or the owner changed."), { conditions: ["the task is overdue", "the owner changed"], connective: "or" });
  assert.deepEqual(conditionsOf("Only admins can delete records.").conditions, []);
  const or = decisionTable(["a", "b"], "or");
  assert.deepEqual(or.map((r) => [r.key, r.outcome]), [["all-false", false], ["only:a", true], ["only:b", true]]);
  assert.deepEqual(or[1].values, { a: true, b: false });
  assert.equal(decisionTable(["a", "b", "c"], "and").length, 4);
});

test("an older exploration degrades to items per flow and clarification, and says so", async () => {
  const s = setup({ g2: false });
  put(s.root, `${MOD}/explore/interactions.json`, JSON.stringify([{ element: 'textbox "Email"', kind: "input" }]));
  const r = await s.tc("items");
  assert.deepEqual(Object.keys(r.out.byTechnique).sort(), ["clarification", "decision-table", "flow", "rule"]);
  assert.equal(r.out.degraded.length, 2);
  assert.match(r.out.degraded.join("\n"), /interactions\.json has no field constraints/);
  assert.match(r.out.degraded.join("\n"), /model\.json is missing/);
});

test("stable CI and TC ids across rebuilds; gone ids are never reused, a returning key gets its old id", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  const email = items.find((i) => i.label === "Email: a valid value").id;
  s.overlay({ cases: [kase("alpha", [email]), kase("beta", [email])] });
  await s.tc("build");
  const ids1 = Object.fromEntries(s.cov().cases.map((c) => [c.key, c.id]));
  assert.deepEqual(ids1, { alpha: "TC-contacts-1", beta: "TC-contacts-2" });
  s.overlay({ cases: [kase("beta", [email]), kase("gamma", [email])] });
  const r = await s.tc("build");
  assert.deepEqual(Object.fromEntries(s.cov().cases.map((c) => [c.key, c.id])), { beta: "TC-contacts-2", gamma: "TC-contacts-3" });
  assert.match(r.out.warnings.join("\n"), /TC-contacts-1 \(alpha\)/);
  s.overlay({ cases: [kase("alpha", [email]), kase("beta", [email]), kase("gamma", [email])] });
  await s.tc("build");
  assert.equal(s.cov().cases.find((c) => c.key === "alpha").id, "TC-contacts-1", "a returning key gets its old id");

  // CI ids: a field that disappears keeps its id as gone; a new field gets a new id, never a gone one
  const before = new Map(s.cov().items.map((i) => [i.key, i.id]));
  const max = Math.max(...[...before.values()].map((id) => Number(id.split("-").at(-1))));
  put(s.root, `${MOD}/explore/interactions.json`, JSON.stringify([...INTERACTIONS.filter((i) => i.name !== "Subscribed"), field(6, "ST-contacts-2", "textbox", "Phone", "input", { inputType: "text" })]));
  await s.tc("build");
  const after = s.cov().items;
  assert.ok(!after.some((i) => i.label.startsWith("Subscribed")));
  const phone = after.find((i) => i.label === "Phone: a valid value");
  assert.equal(Number(phone.id.split("-").at(-1)), max + 1);
  for (const i of after) if (before.has(i.key)) assert.equal(i.id, before.get(i.key), i.key);
  put(s.root, `${MOD}/explore/interactions.json`, JSON.stringify(INTERACTIONS));
  await s.tc("build");
  assert.equal(s.cov().items.find((i) => i.label === "Subscribed: checked").id, [...before].find(([k]) => k.endsWith("|checked"))[1]);
});

test("the budget: items past testcases.max_cases are deferred lowest-priority first, and a covered item never is", async () => {
  const s = setup({ maxCases: 5 });
  await s.tc("build");
  const c = s.cov();
  assert.equal(c.maxCases, 5);
  assert.equal(c.items.filter((i) => i.status === "pending").length, 5);
  assert.ok(c.items.filter((i) => i.status === "pending").every((i) => i.priority === "p1"), "p1 items stay in the budget");
  const deferred = c.items.filter((i) => i.status === "deferred");
  assert.equal(deferred.length, c.items.length - 5);
  assert.ok(deferred.every((i) => i.reason === "budget" && i.detail === "over testcases.max_cases (5)"));
  assert.ok(deferred.some((i) => i.technique === "enum"), "enum members go first");
  const enumItem = deferred.find((i) => i.technique === "enum");
  s.overlay({ cases: [kase("an-enum", [enumItem.id])] });
  await s.tc("build");
  assert.equal(s.cov().items.find((i) => i.id === enumItem.id).status, "mapped", "covered work is never hidden as deferred");
  assert.match(readFileSync(s.tp.summary, "utf8"), /## Deferred \(over testcases\.max_cases 5\)/);
});

test("@assumption is set by the script: an unapproved clarification, an agent-capture rule fact; a human answer needs none", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  const by = (pred) => items.find(pred).id;
  const dtAll = by((i) => i.technique === "decision-table");
  const rule = by((i) => i.technique === "rule");
  s.overlay({
    cases: [
      kase("human-answer", [by((i) => i.subject === "contacts-1")], { evidence: ["clarification:contacts-1"], expected: 'the message "Contact created" is shown' }),
      kase("agent-answer", [by((i) => i.subject === "contacts-2")], { evidence: ["clarification:contacts-2"] }),
      kase("weak-rule", [dtAll], { evidence: ["knowledge:modules/contacts/notes.md#L10"] }),
      kase("strong-rule", [rule], { evidence: ["knowledge:modules/contacts/notes.md#L9"] }),
    ],
  });
  const r = await s.tc("build");
  assert.deepEqual(r.out.problems, []);
  const cases = Object.fromEntries(s.cov().cases.map((c) => [c.key, c]));
  assert.equal(cases["human-answer"].assumption, false);
  assert.equal(cases["strong-rule"].assumption, false);
  assert.deepEqual(cases["agent-answer"].assumptions, ["contacts-2 is awaiting human approval (agent-proposed)"]);
  assert.deepEqual(cases["weak-rule"].assumptions, ["the rule fact knowledge/modules/contacts/notes.md:10 rests on agent-capture evidence"]);
  const parsed = parseCases(s.tp.file("gherkin"), "gherkin");
  assert.deepEqual(parsed.map((c) => [c.id, c.assumption, c.clarifications]), [["TC-contacts-1", true, ["contacts-2"]], ["TC-contacts-2", false, ["contacts-1"]], ["TC-contacts-3", false, []], ["TC-contacts-4", true, []]]);
  assert.equal(r.out.assumption, 2);

  humanEdit(s.csv, "contacts-2", { status: "Approved" });
  await s.tc("build");
  assert.equal(s.cov().cases.find((c) => c.key === "agent-answer").assumption, false, "approved by a human: no longer an assumption");
});

for (const format of ["gherkin", "csv", "testrail", "markdown-table"])
  test(`rendering ${format}: round-trips through parseCases, the summary total matches`, async () => {
    const s = setup({ format });
    const items = (await s.tc("items")).out.items;
    s.overlay(fullOverlay(items));
    const ov = JSON.parse(readFileSync(path.join(s.root, MOD, "testcases/cases.json"), "utf8"));
    ov.cases[0] = { ...ov.cases[0], mutates: true, api: true, type: "api", priority: "p1", evidence: [...ov.cases[0].evidence, "clarification:contacts-2"] };
    s.overlay(ov);
    const r = await s.tc("build");
    assert.deepEqual(r.out.problems, []);
    const file = s.tp.file(format);
    const parsed = parseCases(file, format);
    const want = s.cov().cases;
    assert.deepEqual(parsed.map((c) => c.id), want.map((c) => c.id));
    for (const [p, c] of parsed.map((p, i) => [p, want[i]])) {
      assert.equal(p.priority, c.priority, c.id);
      assert.equal(p.type, c.type, c.id);
      assert.equal(p.mutates, c.mutates, c.id);
      assert.equal(p.api, c.api, c.id);
      assert.equal(p.assumption, c.assumption, c.id);
      assert.deepEqual(p.clarifications, c.clarifications, c.id);
    }
    assert.equal(countCases(file, format), want.length);
    assert.deepEqual(checkTestcases(s.tp.summary, { module: "contacts", testcasesFormat: format }), []);
    assert.match(readFileSync(s.tp.summary, "utf8"), new RegExp(`^Total test cases: ${want.length}$`, "m"));
    if (format === "gherkin") {
      const text = readFileSync(file, "utf8");
      const scenarios = text.split(/^\s*Scenario:/m).slice(1);
      assert.ok(scenarios.every((sc) => (sc.match(/^\s*When /gm) ?? []).length === 1 && (sc.match(/^\s*Then /gm) ?? []).length === 1), "one When and one Then");
      assert.doesNotMatch(text.split(/\r?\n/).find((l) => l.startsWith("Feature:")) ?? "", /@/);
      assert.match(text, /^\s{2}@TC-contacts-\d+ @p1 @api @mutates( @contacts-\d+)+ @assumption$/m, "tags on the scenario");
      assert.match(text, /^\s{6}\| email \| jane\.doe@example\.test \|$/m);
    }
    if (format === "testrail") assert.deepEqual(parseCsv(readFileSync(file, "utf8"))[0], ["Section", ...CASE_COLUMNS]);
  });

test("parseCases and countCases agree: blank rows skipped, every table with an ID column counted", () => {
  const { root } = startRun();
  put(root, "x.md", ["# Cases", "| ID | Priority | Type |", "|---|---|---|", "| TC-contacts-1 | p1 | functional |", "|  |  |  |", "", "## More", "| ID | Priority | Type |", "|---|---|---|", "| TC-contacts-2 | p2 | negative |", "", "| Note | Text |", "|---|---|", "| a | b |", ""].join("\n"));
  const md = path.join(root, "x.md");
  assert.deepEqual(parseCases(md, "markdown-table").map((c) => c.id), ["TC-contacts-1", "TC-contacts-2"]);
  assert.equal(countCases(md, "markdown-table"), 2);
  put(root, "x.csv", "ID,Priority,Type,Tags\r\nTC-contacts-1,p1,functional,api\r\n , , ,\r\nTC-contacts-2,p2,negative,\r\n");
  const csv = path.join(root, "x.csv");
  assert.deepEqual(parseCases(csv, "csv").map((c) => [c.id, c.api]), [["TC-contacts-1", true], ["TC-contacts-2", false]]);
  assert.equal(countCases(csv, "csv"), 2);
});

test("check: fails on pending items, a case covering nothing, a missing citation, a quote not in the evidence, a stale input; a pass stamps verified", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  s.overlay({ cases: [kase("first", [items[0].id])] });
  await s.tc("build");
  let r = await s.tc("check");
  assert.equal(r.code, 1);
  assert.ok(r.out.problems.some((p) => /pending/.test(p)));

  const ov = fullOverlay(items);
  ov.cases.push(kase("no-cover", []), kase("bad-cite", [items[0].id], { evidence: ["observation:explore/flows/missing.md"] }), kase("bad-quote", [items[0].id], { expected: 'the message "Saved forever" is shown' }));
  s.overlay(ov);
  const b = await s.tc("build");
  assert.equal(b.code, 1);
  r = await s.tc("check");
  assert.equal(r.code, 1);
  const text = r.out.problems.join("\n");
  assert.match(text, /case 'no-cover': covers no coverage item/);
  assert.match(text, /case 'bad-cite': 'observation:explore\/flows\/missing\.md': no such file/);
  assert.match(text, /case 'bad-quote': the expected result quotes "Saved forever"/);
  assert.doesNotMatch(text, /pending/);

  s.overlay(fullOverlay(items));
  await s.tc("build");
  r = await s.tc("check");
  assert.deepEqual(r.out.problems, []);
  assert.equal(r.code, 0);
  const ctx = testcaseContext({ root: s.root, product: "acme", module: "contacts", run: loadJson(paths("acme", s.root).runFile), cfg: loadJson(paths("acme", s.root).configFile), productDir: paths("acme", s.root).productDir });
  assert.equal(testcasesUnverified(ctx), null);

  const ov2 = fullOverlay(items);
  ov2.cases[0].title = "A changed title of the first case";
  s.overlay(ov2);
  assert.match(testcasesUnverified(ctx), /changed after testcases\.mjs check/);
  r = await s.tc("check");
  assert.match(r.out.problems.join("\n"), /stale: cases changed after the last build/);
  await s.tc("build");
  humanEdit(s.csv, "contacts-2", { status: "human-approved" });
  r = await s.tc("check");
  assert.match(r.out.problems.join("\n"), /stale: clarifications changed/, "an approved answer changes @assumption: rebuild");
});

test("an invalid overlay builds nothing; bad exclusions and real-looking data are problems", async () => {
  const s = setup();
  s.overlay({ cases: [{ key: "Bad Key", title: "x" }] });
  const r = await s.tc("build");
  assert.equal(r.code, 1);
  assert.match(r.out.note, /nothing was built/);
  assert.equal(existsSync(s.tp.coverage), false);

  const items = (await s.tc("items")).out.items;
  const ov = fullOverlay(items.slice(1));
  ov.exclude = [{ item: items[0].id, reason: "not-testable", detail: "needs a second tenant" }];
  ov.cases[0].data = { email: "jane@gmail.com" };
  ov.cases[1].title = "Click the save button";
  ov.cases[2].action = "the user clicks Save";
  s.overlay(ov);
  const b = await s.tc("build");
  const text = b.out.problems.join("\n");
  assert.match(text, new RegExp(`exclude ${items[0].id}: an exclusion needs a citation`));
  assert.match(text, /uses the email domain gmail\.com/);
  assert.match(text, /the title is a step/);
  assert.match(text, /the action \(the one When\) names UI mechanics/);
  assert.equal(s.cov().items.find((i) => i.id === items[0].id).status, "pending", "an uncited exclusion takes nothing out");

  ov.exclude[0].citation = "clarification:contacts-1";
  s.overlay({ ...ov, cases: fullOverlay(items.slice(1)).cases });
  assert.deepEqual((await s.tc("build")).out.problems, []);
  assert.equal(s.cov().items.find((i) => i.id === items[0].id).status, "excluded");
});

test("approve honours yes, no, changes and blanks; no and changes become findings for the writer", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  s.overlay(fullOverlay(items.slice(0, 4)));
  await s.tc("build");
  assert.deepEqual(parseCsv(readFileSync(s.tp.approvalCsv, "utf8"))[0], APPROVAL_COLUMNS);
  editApproval(s.tp, [["TC-contacts-1", "Yes"], ["TC-contacts-2", "no", "Wrong expected result"], ["TC-contacts-3", "Changes requested", "Name the field"]]);
  let r = await s.tc("approve");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual({ approved: r.out.approved, rejected: r.out.rejected, changes: r.out.changes, awaiting: r.out.awaiting }, { approved: 1, rejected: 1, changes: 1, awaiting: 1 });
  const approvals = loadJson(s.tp.approvals);
  assert.deepEqual(await validateData("testcases-approvals", approvals), []);
  assert.equal(approvals.cases["TC-contacts-1"].decision, "yes");
  assert.equal(approvals.cases["TC-contacts-1"].hash, s.cov().cases[0].hash);
  const findings = readFileSync(s.tp.approvalFindings, "utf8");
  assert.match(findings, /^Verdict: changes-required$/m);
  assert.match(findings, /\| blocker \| testcases\/cases\.json \|  \| human-rejected \| TC-contacts-2 .*Wrong expected result/);
  assert.match(findings, /\| major \| .* \| human-changes \| TC-contacts-3 .*Name the field/);

  editApproval(s.tp, [["TC-contacts-2", ""], ["TC-contacts-4", "maybe"]]);
  r = await s.tc("approve");
  assert.equal(r.code, 1);
  assert.deepEqual(r.out.cleared, ["TC-contacts-2"]);
  assert.match(r.out.problems[0], /TC-contacts-4: Approved 'maybe' is not yes, no, changes or blank/);
  assert.equal(loadJson(s.tp.approvals).cases["TC-contacts-2"], undefined);
  assert.deepEqual(["yes", "no", "changes", "", null].map((v) => v), [normApproval("x"), normApproval("REJECTED"), normApproval("change requested"), normApproval("  "), normApproval("later")]);
});

test("an approval is pinned to the content: an edit makes the case unapproved again, and a stale row is refused", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  const ov = fullOverlay(items.slice(0, 2));
  s.overlay(ov);
  await s.tc("build");
  editApproval(s.tp, [["TC-contacts-1", "yes"], ["TC-contacts-2", "yes"]]);
  assert.equal((await s.tc("approve")).out.approved, 2);

  ov.cases[0].evidence = [...ov.cases[0].evidence, "observation:explore/flows/create-contact.md"]; // re-pointed evidence
  s.overlay(ov);
  let b = await s.tc("build");
  assert.deepEqual(b.out.approvals, { approved: 1, rejected: 0, changes: 0, awaiting: 1, invalidated: 1 });
  assert.equal(approvalRow(s.tp, "TC-contacts-1").Approved, "", "the re-rendered row asks again");
  // the clarification TC-contacts-2 relies on gets approved: its derived @assumption flips, so its approval lapses
  humanEdit(s.csv, "contacts-2", { status: "human-approved" });
  b = await s.tc("build");
  assert.deepEqual(b.out.approvals, { approved: 0, rejected: 0, changes: 0, awaiting: 2, invalidated: 2 });
  // covers are part of what is approved too
  const c0 = kase("x", [items[0].id]);
  assert.notEqual(caseHash(c0, false), caseHash({ ...c0, covers: [items[0].id, items[2].id] }, false));
  assert.notEqual(caseHash(c0, false), caseHash(c0, true));
  assert.equal(caseHash(c0, false), caseHash({ ...c0, evidence: [...c0.evidence].reverse(), data: { ...c0.data } }, false), "order does not matter");
  editApproval(s.tp, [["TC-contacts-1", "yes"]]);
  assert.equal((await s.tc("approve")).out.approved, 1);

  // a human approving from an old copy of the sheet: the row's Version is not the case's content any more
  const rows = parseCsv(readFileSync(s.tp.approvalCsv, "utf8"));
  rows.find((r) => r[0] === "TC-contacts-2")[APPROVAL_COLUMNS.indexOf("Approved")] = "yes";
  rows.find((r) => r[0] === "TC-contacts-2")[APPROVAL_COLUMNS.indexOf("Version")] = "000000000000";
  writeFileSync(s.tp.approvalCsv, serializeCsv(rows));
  const r = await s.tc("approve");
  assert.equal(r.code, 1);
  assert.match(r.out.problems[0], /TC-contacts-2: changed since this row was rendered/);
  assert.equal(r.out.approved, 1);
});

test("re-rendering approval.csv keeps the human's entries for unchanged cases, even before approve runs", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  const ov = fullOverlay(items.slice(0, 3));
  s.overlay(ov);
  await s.tc("build");
  editApproval(s.tp, [["TC-contacts-1", "yes", "fine"], ["TC-contacts-2", "changes", "too vague"]]);
  ov.cases[1].steps = ["Open Contacts", 'Select "New contact"', 'Type "jane.doe@example.test" into "Email"'];
  s.overlay(ov);
  await s.tc("build");
  assert.deepEqual([approvalRow(s.tp, "TC-contacts-1").Approved, approvalRow(s.tp, "TC-contacts-1").Comment], ["yes", "fine"]);
  assert.deepEqual([approvalRow(s.tp, "TC-contacts-2").Approved, approvalRow(s.tp, "TC-contacts-2").Comment], ["", "(on an earlier version) too vague"]);
  assert.equal(approvalRow(s.tp, "TC-contacts-3").Approved, "");

  // the sheet deleted: recorded decisions on unchanged content are prefilled from approvals.json
  assert.equal((await s.tc("approve")).out.approved, 1);
  rmSync(s.tp.approvalCsv);
  await s.tc("build");
  assert.equal(approvalRow(s.tp, "TC-contacts-1").Approved, "yes");
});

test("approve works after the run ended; usage errors exit 2", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  s.overlay(fullOverlay(items.slice(0, 1)));
  await s.tc("build");
  rmSync(paths("acme", s.root).lockFile);
  editApproval(s.tp, [["TC-contacts-1", "yes"]]);
  assert.equal((await s.tc("approve")).out.approved, 1);
  await assert.rejects(s.tc("build"), /no active run/);
  assert.equal((await main(["build", "acme"], { root: s.root })).code, 2);
});

test("approve is for a human at a terminal: no TTY or a wrong confirmation records nothing; nothing to record exits 1", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  s.overlay(fullOverlay(items.slice(0, 2)));
  await s.tc("build");
  let r = await s.tc("approve");
  assert.equal(r.code, 1, "every Approved cell blank: nothing recorded is never a success");
  assert.match(r.out.problems.at(-1), /no decision to record/);
  editApproval(s.tp, [["TC-contacts-1", "yes"]]);
  r = await s.tcAs({ isTTY: false, ask: async () => "contacts" }, "approve");
  assert.equal(r.code, 1);
  assert.match(r.out.problems.at(-1), /interactive terminal/);
  let asked = "";
  r = await s.tcAs({ isTTY: true, ask: async (q) => ((asked = q), "yes") }, "approve");
  assert.equal(r.code, 1);
  assert.match(asked, /Record 1 decision\(s\) and clear 0 for module 'contacts'/);
  assert.match(r.out.problems.at(-1), /not confirmed/);
  assert.equal(existsSync(s.tp.approvals), false, "nothing was written");
  r = await s.tc("approve");
  assert.equal(r.code, 0);
  assert.deepEqual(r.out.recorded, ["TC-contacts-1"]);
  r = await s.tcAs({ isTTY: false }, "approve");
  assert.equal(r.code, 0, "re-running with the same decisions writes nothing, so it needs no terminal");
  assert.deepEqual(r.out.unchanged, ["TC-contacts-1"]);
});

test("Version is v-prefixed text, read tolerantly; a value Excel mangled is reported and the human's entry kept", async () => {
  const hash = "0123456789ab".padEnd(64, "0");
  assert.equal(versionOf(hash), "v0123456789ab");
  assert.equal(versionMatch("V0123456789AB ", hash), "match");
  assert.equal(versionMatch("0123456789ab", hash), "match", "the prefix is optional");
  const digits = "000123456789".padEnd(64, "0");
  assert.equal(versionMatch("123456789", digits), "match", "Excel dropped the leading zeros: still exactly these digits");
  assert.equal(versionMatch("1.23457E+11", digits), "unreadable", "scientific notation lost digits: ambiguous");
  assert.equal(versionMatch("v111111111111", hash), "differs");
  assert.equal(versionMatch("", hash), "unreadable");

  const s = setup();
  const items = (await s.tc("items")).out.items;
  s.overlay(fullOverlay(items.slice(0, 2)));
  await s.tc("build");
  assert.match(approvalRow(s.tp, "TC-contacts-1").Version, /^v[0-9a-f]{12}$/);
  const rows = parseCsv(readFileSync(s.tp.approvalCsv, "utf8"));
  const row = rows.find((x) => x[0] === "TC-contacts-1");
  row[APPROVAL_COLUMNS.indexOf("Approved")] = "no";
  row[APPROVAL_COLUMNS.indexOf("Comment")] = "wrong";
  row[APPROVAL_COLUMNS.indexOf("Version")] = "1.23457E+11";
  writeFileSync(s.tp.approvalCsv, serializeCsv(rows));
  const r = await s.tc("approve");
  assert.equal(r.code, 1);
  assert.match(r.out.problems[0], /TC-contacts-1: Version '1\.23457E\+11' can't be read .*set Version to v[0-9a-f]{12}\. Your entry is kept/);
  await s.tc("build");
  assert.deepEqual([approvalRow(s.tp, "TC-contacts-1").Approved, approvalRow(s.tp, "TC-contacts-1").Comment, approvalRow(s.tp, "TC-contacts-1").Version], ["no", "wrong", "1.23457E+11"]);
});

test("approval.csv saved by Excel with semicolons is read and kept that way; a missing required column fails loudly", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  s.overlay(fullOverlay(items.slice(0, 2)));
  await s.tc("build");
  const rows = parseCsv(readFileSync(s.tp.approvalCsv, "utf8"));
  rows.find((x) => x[0] === "TC-contacts-2")[APPROVAL_COLUMNS.indexOf("Approved")] = "yes";
  writeFileSync(s.tp.approvalCsv, serializeCsv(rows, { delimiter: ";" }));
  let r = await s.tc("approve");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual(r.out.recorded, ["TC-contacts-2"]);
  await s.tc("build");
  assert.match(readFileSync(s.tp.approvalCsv, "utf8").split("\r\n")[0], /^TC ID;Title;/, "re-rendered with the sheet's own delimiter");
  writeFileSync(s.tp.approvalCsv, serializeCsv([["TC ID", "Title", "Approved"], ["TC-contacts-1", "x", "yes"]]));
  r = await s.tc("approve");
  assert.equal(r.code, 1);
  assert.match(r.out.problems[0], /approval\.csv has no 'Version' column/);
});

test("junk coverage is refused: too many items, several invalid values, one field twice, invented or unreal citations, vacuous results", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  const id = (label) => items.find((i) => i.label === label).id;
  const dt = items.filter((i) => i.technique === "decision-table").map((i) => i.id);
  const clar = items.find((i) => i.subject === "contacts-1").id;
  const flow = items.find((i) => i.technique === "flow").id;
  s.overlay({
    cases: [
      kase("everything", items.slice(0, MAX_COVERS + 2).map((i) => i.id).filter((x) => x !== clar), { evidence: ["clarification:contacts-2", "observation:explore/flows/create-contact.md"] }),
      kase("two-faults", [id("Email: left empty (required)"), id("Stage: a value outside its options")]),
      kase("one-field-twice", [id("Email: 50 characters (the maximum)"), id("Email: a valid value")]),
      kase("two-rows", dt.slice(0, 2), { evidence: ["knowledge:modules/contacts/notes.md#L10"] }),
      kase("uncited-clarification", [clar]),
      kase("dot", [flow], { evidence: ["observation:."] }),
      kase("dir", [flow], { evidence: ["observation:explore/flows"] }),
      kase("up", [flow], { evidence: ["knowledge:../knowledge/modules/contacts/notes.md"] }),
      kase("no-line", [flow], { evidence: ["knowledge:modules/contacts/notes.md#L999"] }),
      kase("vacuous", [flow], { expected: "it works as expected" }),
      kase("short", [flow], { expected: "saved" }),
    ],
    exclude: [
      { item: id("Subscribed: checked"), reason: "duplicate-of", detail: "same", of: id("Subscribed: unchecked") },
      { item: id("Subscribed: unchecked"), reason: "duplicate-of", detail: "same", of: id("Subscribed: checked"), citation: "observation:explore/flows/create-contact.md" },
      { item: items.find((i) => i.technique === "state-transition").id, reason: "duplicate-of", detail: "same", of: flow, citation: "observation:explore/flows/create-contact.md" },
    ],
  });
  const b = await s.tc("build");
  const text = b.out.problems.join("\n");
  assert.match(text, new RegExp(`case 'everything': covers ${MAX_COVERS + 1} coverage items; a case covers at most ${MAX_COVERS}`));
  assert.match(text, /case 'two-faults': covers 2 invalid partitions/);
  assert.match(text, /case 'one-field-twice': covers several values of the field contacts: textbox "Email"/);
  assert.match(text, /case 'two-rows': covers several rows of the decision table/);
  assert.match(text, /case 'uncited-clarification': covers CI-contacts-\d+ \(clarification contacts-1\) without citing clarification:contacts-1/);
  assert.match(text, /case 'dot': 'observation:\.': cite a file by its plain relative path/);
  assert.match(text, /case 'dir': 'observation:explore\/flows': not a file/);
  assert.match(text, /case 'up': 'knowledge:\.\.\/knowledge\/modules\/contacts\/notes\.md': cite a file by its plain relative path/);
  assert.match(text, /case 'no-line': 'knowledge:modules\/contacts\/notes\.md#L999': modules\/contacts\/notes\.md has no line 999/);
  assert.match(text, /case 'vacuous': the expected result 'it works as expected' is vague/);
  assert.match(text, /case 'short': the expected result 'saved' is too short/);
  assert.match(text, new RegExp(`exclude ${id("Subscribed: checked")}: an exclusion needs a citation`));
  assert.match(text, new RegExp(`exclude ${id("Subscribed: checked")}: duplicate-of ${id("Subscribed: unchecked")}, which is not the same check`));
  assert.match(text, new RegExp(`exclude ${id("Subscribed: unchecked")}: duplicate-of ${id("Subscribed: checked")}, which is not the same check`));
  const cov = s.cov();
  const status = (x) => cov.items.find((i) => i.id === x).status;
  assert.equal(status(clar), "pending", "a clarification item is covered only by a case citing it");
  assert.notEqual(status(id("Subscribed: checked")), "excluded");
  assert.notEqual(status(id("Subscribed: unchecked")), "excluded", "a duplicate-of cycle takes nothing out");
  assert.equal(status(items.find((i) => i.technique === "state-transition").id), "pending", "a transition is not a duplicate of a flow");
  assert.match(text, /duplicate-of CI-contacts-\d+, which is not the same check/);
  const r = await s.tc("check");
  assert.equal(r.code, 1);
});

test("duplicate-of only folds the same check found twice: same technique, source and target", async () => {
  const s = setup();
  // the Email field again, on a second page
  put(s.root, `${MOD}/explore/interactions.json`, JSON.stringify([...INTERACTIONS, { ...field(7, "ST-contacts-2", "textbox", "Email *", "input", { required: true, inputType: "text", maxlength: 50 }), page: "contacts-edit" }]));
  const items = (await s.tc("items")).out.items;
  const [here, there] = items.filter((i) => i.label === "Email: a valid value");
  const other = items.find((i) => i.label === "Email: left empty (required)" && i.subject === there.subject);
  const cite = "observation:explore/flows/create-contact.md";
  s.overlay({
    cases: [kase("valid-email", [here.id])],
    exclude: [
      { item: there.id, reason: "duplicate-of", detail: "the same form on the edit page", of: here.id, citation: cite },
      { item: other.id, reason: "duplicate-of", detail: "folded", of: here.id, citation: cite },
    ],
  });
  const b = await s.tc("build");
  assert.match(b.out.problems.join("\n"), new RegExp(`exclude ${other.id}: duplicate-of ${here.id}, which is not the same check`));
  const st = (id) => s.cov().items.find((i) => i.id === id).status;
  assert.equal(st(there.id), "excluded");
  assert.equal(st(other.id), "pending");
  // a cycle between the two takes nothing out
  const flow = items.find((i) => i.technique === "flow").id;
  s.overlay({ cases: [kase("flow", [flow])], exclude: [{ item: there.id, reason: "duplicate-of", detail: "x", of: here.id, citation: cite }, { item: here.id, reason: "duplicate-of", detail: "x", of: there.id, citation: cite }] });
  const c = await s.tc("build");
  assert.match(c.out.problems.join("\n"), /which is excluded itself \(no chains or cycles\)/);
  assert.equal(st(there.id), "pending");
  assert.equal(st(here.id), "pending");
});

test("an expected result needs an observable anchor; vague wording is refused", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  const flow = items.find((i) => i.technique === "flow").id;
  const email = items.find((i) => i.label === "Email: a valid value").id;
  const snap = "observation:explore/pages/contacts/states/ST-contacts-2.md";
  const ok = (expected, covers = [flow], evidence) => kase(`ok-${expected.length}-${covers.length}`, covers, { expected, ...(evidence ? { evidence } : {}) });
  s.overlay({
    cases: [
      kase("a", [flow], { expected: "The system responds appropriately to the input" }),
      kase("b", [flow], { expected: "Nothing bad happens to the record" }),
      kase("c", [flow], { expected: "a b c d" }),
      kase("d", [flow], { expected: "The record is handled as designed by the product" }),
      ok("the dialog keeps the Email field next to the title", [email]),
      ok("the New contact dialog keeps its title in view", [flow], [snap]),
      ok("the contact list reaches ST-contacts-2 afterwards"),
      ok("the contact is listed at the top"),
    ],
  });
  const text = (await s.tc("build")).out.problems.join("\n");
  assert.match(text, /case 'a': the expected result .* is vague \(appropriately\)/);
  assert.match(text, /case 'b': the expected result .* is vague \(Nothing bad\)/);
  assert.match(text, /case 'c': the expected result 'a b c d' has no observable anchor/);
  assert.match(text, /case 'd': the expected result .* is vague \(handled\)/);
  assert.doesNotMatch(text, /case 'ok-/);
});

test("the gate accepts the @assumption the script derived from a weak rule fact", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  const dt = items.find((i) => i.technique === "decision-table").id;
  s.overlay(fullOverlay(items.filter((i) => i.technique !== "decision-table" || i.id === dt)));
  await s.tc("build");
  assert.ok(s.cov().cases.find((c) => c.covers.includes(dt)).assumption);
  const r = gate("acme", "contacts", "testcases", { root: s.root, compile: false });
  assert.doesNotMatch(readFileSync(path.join(s.root, r.file), "utf8"), /tagged @assumption but relies on no/);
});

// ---------- G3b: the gate, the per-case review, the status ----------

const gateRules = (root, r) => [...readFileSync(path.join(root, r.file), "utf8").matchAll(/^\| \d+ \| (\w+) \| [^|]* \| [^|]* \| ([\w-]+) \| ([^|]*) \|/gm)].map((m) => [m[1], m[2], m[3].trim()]);

test("gate: needs the cases built and checked; a clarification counts as covered only when a case's evidence cites it", async () => {
  const s = setup();
  let r = gate("acme", "contacts", "testcases", { root: s.root, compile: false });
  assert.deepEqual(gateRules(s.root, r).map((x) => x[1]), ["testcases-built"]);
  const items = (await s.tc("items")).out.items;
  s.overlay(fullOverlay(items));
  await s.tc("build");
  assert.equal(gate("acme", "contacts", "testcases", { root: s.root, compile: false }).verdict, "changes-required", "built but not checked");
  assert.equal((await s.tc("check")).code, 0);
  r = gate("acme", "contacts", "testcases", { root: s.root, compile: false });
  assert.deepEqual(r, { verdict: "pass", file: r.file, counts: { blocker: 0, major: 0, minor: 0 } });

  // the loophole: contacts-2's id appears in a title, the summary and inside TC-contacts-2, but no case cites it
  const ov = fullOverlay(items);
  const k = ov.cases.find((c) => c.evidence.includes("clarification:contacts-2"));
  ov.cases = ov.cases.filter((c) => c !== k);
  ov.cases[0].title = "The contacts-2 answer is shown as in contacts-2";
  s.overlay(ov);
  await s.tc("build");
  assert.match(readFileSync(s.tp.file("gherkin"), "utf8"), /The contacts-2 answer/);
  r = gate("acme", "contacts", "testcases", { root: s.root, compile: false });
  const found = gateRules(s.root, r);
  assert.ok(found.some(([sev, rule, p]) => sev === "major" && rule === "clarification-coverage" && /answered clarification contacts-2 is cited by no test case/.test(p)));
  assert.ok(!found.some(([, rule, p]) => rule === "clarification-coverage" && /contacts-1/.test(p)), "contacts-1 is cited exactly");
  assert.ok(found.some(([, rule]) => rule === "testcases-check"), "the stale stamp too");
  // an excluded (cited) clarification item is covered
  ov.exclude = [{ item: items.find((i) => i.subject === "contacts-2").id, reason: "not-testable", detail: "needs a second tenant", citation: "clarification:contacts-1" }];
  s.overlay(ov);
  await s.tc("build");
  assert.equal((await s.tc("check")).code, 0);
  assert.equal(gate("acme", "contacts", "testcases", { root: s.root, compile: false }).verdict, "pass");
});

test("review-check: every current case needs a verdict in this round; the overall verdict is derived from the findings", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  s.overlay(fullOverlay(items.slice(0, 3)));
  await s.tc("build");
  const ids = s.cov().cases.map((c) => c.id);
  const ver = new Map(s.cov().cases.map((c) => [c.id, c.version]));
  const file = path.join(s.root, "artifacts/acme/results/acme-run-1/contacts/testcases/review.json");
  const write = (o) => put(s.root, path.relative(s.root, file), JSON.stringify(o));
  assert.equal((await main(["review-check", "acme", "contacts"], { root: s.root })).code, 2, "--round is required");
  write({ module: "contacts", round: 1, cases: { [ids[0]]: { verdict: "ok", version: ver.get(ids[0]) } } });
  let r = await s.tc("review-check", "--round", "1");
  assert.equal(r.code, 1);
  assert.deepEqual(r.out.problems, [`${ids[1]}: no verdict in this round`, `${ids[2]}: no verdict in this round`]);
  write({ module: "contacts", round: 1, cases: { [ids[0]]: { verdict: "maybe" } } });
  assert.match((await s.tc("review-check", "--round", "1")).out.problems.join("\n"), /review\.json: \/cases\//, "the schema");
  const all = (extra = {}) => ({ module: "contacts", round: 2, cases: { ...Object.fromEntries(ids.map((id) => [id, { verdict: "ok", version: ver.get(id) }])), ...extra } });
  write(all());
  assert.match((await s.tc("review-check", "--round", "3")).out.problems[0], /review\.json is for round 2, not round 3/);
  write(all({ [ids[1]]: { verdict: "finding", version: ver.get(ids[1]), findings: [{ severity: "minor", rule: "wording", problem: "unclear title", fix: "name the field" }] } }));
  r = await s.tc("review-check", "--round", "2");
  assert.equal(r.code, 0);
  assert.equal(r.out.verdict, "pass", "minors only");
  write(all({ [ids[1]]: { verdict: "finding", version: ver.get(ids[1]), findings: [{ severity: "blocker", rule: "correctness", problem: "the evidence says the opposite", fix: "expect the refusal" }] }, "TC-contacts-99": { verdict: "ok", version: "v000000000000" } }));
  assert.match((await s.tc("review-check", "--round", "2")).out.problems[0], /TC-contacts-99: not a current test case/);
  write(all({ [ids[1]]: { verdict: "finding", version: ver.get(ids[1]), findings: [{ severity: "blocker", rule: "correctness", problem: "the evidence says the opposite", fix: "expect the refusal" }] } }));
  r = await s.tc("review-check", "--round", "2");
  assert.deepEqual([r.code, r.out.verdict, r.out.counts], [0, "changes-required", { blocker: 1, major: 0, minor: 0 }]);
  const md = readFileSync(path.join(s.root, r.out.file), "utf8");
  assert.match(md, /^# Review -- testcases \/ contacts -- round 2$/m);
  assert.match(md, new RegExp(`^\\| 1 \\| blocker \\| testcases/cases\\.json \\(case '[^']+'\\) \\|  \\| correctness \\| ${ids[1]}: the evidence says the opposite \\| expect the refusal \\|$`, "m"));
});

test("review-check: a verdict is pinned to the case's version; a copied verdict on an edited case is refused", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  const ov = fullOverlay(items.slice(0, 2));
  s.overlay(ov);
  await s.tc("build");
  const file = "artifacts/acme/results/acme-run-1/contacts/testcases/review.json";
  const verdicts = (round) => ({ module: "contacts", round, cases: Object.fromEntries(s.cov().cases.map((c) => [c.id, { verdict: "ok", version: c.version }])) });
  const round1 = verdicts(1);
  put(s.root, file, JSON.stringify(round1));
  assert.equal((await s.tc("review-check", "--round", "1")).code, 0);
  const edited = s.cov().cases[1];
  ov.cases.find((c) => c.key === edited.key).expected = "the contact is saved and listed at the top";
  s.overlay(ov);
  await s.tc("build");
  const now = s.cov().cases.find((c) => c.id === edited.id).version;
  assert.notEqual(now, edited.version);
  put(s.root, file, JSON.stringify({ ...round1, round: 2 })); // every old ok copied into round 2
  const r = await s.tc("review-check", "--round", "2");
  assert.equal(r.code, 1);
  assert.deepEqual(r.out.problems, [`${edited.id}: verdict is for version ${edited.version}, current is ${now}; review the case again`]);
  put(s.root, file, JSON.stringify(verdicts(2)));
  assert.equal((await s.tc("review-check", "--round", "2")).code, 0, "a fresh verdict on the current version passes");
});

test("status: the totals, the assumptions and which cases a human approved", async () => {
  const s = setup();
  const items = (await s.tc("items")).out.items;
  s.overlay(fullOverlay(items.slice(0, 2)));
  await s.tc("build");
  editApproval(s.tp, [["TC-contacts-1", "yes"]]);
  await s.tc("approve");
  const r = await s.tc("status");
  assert.equal(r.code, 0);
  assert.deepEqual({ total: r.out.total, approved: r.out.approved, approvals: r.out.approvals }, { total: 2, approved: ["TC-contacts-1"], approvals: { approved: 1, rejected: 0, changes: 0, awaiting: 1, invalidated: 0 } });
});

test("a rule mixing and with or degrades to one decision-table item per condition", () => {
  const { conditions, connective } = conditionsOf("A refund is allowed when the order is paid and the item is unused or the seller agrees.");
  assert.equal(connective, "mixed");
  const rows = decisionTable(conditions, connective);
  assert.deepEqual(rows.map((r) => [r.key, r.outcome]), [["cond:the-order-is-paid", null], ["cond:the-item-is-unused", null], ["cond:the-seller-agrees", null]]);
});

// ---------- selectable steps: typed cases, imports, scenario scope ----------

const perfCase = (key, covers, over = {}) =>
  kase(key, covers, { type: "performance", performance: true, endpoint: "EP-contacts-1", load: { type: "average-load", rps: 5, slo: { p95_ms: 800 } }, expected: "p95 of the contact list stays under 800 ms at 5 rps", ...over });

test("@performance: a typed case with endpoint, load type, rate and SLO, rendered in every format; the parse contract says performance", async () => {
  for (const format of ["gherkin", "csv", "testrail", "markdown-table"]) {
    const s = setup({ format, steps: ["explore", "testcases", "k6"] });
    await buildCatalogue(s.root);
    const items = (await s.tc("items")).out.items;
    const load = items.find((i) => i.technique === "load-endpoint");
    assert.ok(load && items.some((i) => i.technique === "load-flow"), "load items per endpoint and per flow");
    assert.ok(!items.some((i) => i.technique === "api-endpoint"), "no @api items without playwright-api");
    s.overlay({ cases: [perfCase("list-under-load", [load.id])] });
    const r = await s.tc("build");
    assert.deepEqual(r.out.problems, [], format);
    const c = s.cov().cases[0];
    assert.deepEqual([c.type, c.performance, c.api, c.endpoint, c.load.type, c.load.rps], ["performance", true, false, "EP-contacts-1", "average-load", 5]);
    const file = s.tp.file(format);
    assert.match(readFileSync(file, "utf8"), /average-load at 5 rps; p95 < 800 ms/, format);
    assert.equal(parseCases(file, format)[0].performance, true, format);
    assert.equal(parseCases(file, format)[0].api, false, format);
  }
});

test("typed items: @api items need an @api case naming the endpoint; a @performance case needs a target, a load type and a rate", async () => {
  const s = setup({ steps: ["explore", "testcases", "playwright-api", "k6"] });
  await buildCatalogue(s.root);
  const items = (await s.tc("items")).out.items;
  const api = items.find((i) => i.technique === "api-endpoint");
  const load = items.find((i) => i.technique === "load-endpoint");
  assert.equal(api.priority, "p2");
  assert.equal(load.priority, "p3");
  s.overlay({
    cases: [
      kase("ui-covers-api", [api.id]),
      kase("api-other-endpoint", [api.id], { type: "api", api: true, endpoint: "EP-contacts-9" }),
      perfCase("no-target", [load.id], { endpoint: undefined }),
    ],
  });
  const r = await s.tc("build");
  const p = r.out.problems.join("\n");
  assert.match(p, /case 'ui-covers-api': covers CI-contacts-\d+ \(api-endpoint\), which only a @api case covers/);
  assert.match(p, /case 'api-other-endpoint': names the endpoint EP-contacts-9, which is not in api\/discovered-endpoints\.json/);
  assert.match(p, /case 'no-target': a @performance case names an endpoint \(EP id\) or a user flow/);
  // a run without a catalogue says so instead of enumerating nothing silently
  const t = setup({ steps: ["explore", "testcases", "playwright-api"] });
  assert.match((await t.tc("items")).out.degraded.join("\n"), /discovered-endpoints\.json is missing .* no @api endpoint items/);
});

const FEATURE_IMPORT = [
  "Feature: Contacts (the team's own cases)",
  "",
  "  @TC-77 @p1 @module:contacts",
  "  Scenario: A contact can be created from the list",
  "    Given the user is on the contact list",
  "    When the user creates a contact named Jane",
  "    Then the list shows Jane",
  "",
  "  @api @module:contacts",
  "  Scenario: The contact list endpoint answers",
  "    When the client lists contacts",
  "    Then the status is 200",
  "",
  "  @module:contacts",
  "  Scenario: A case without an expected result",
  "    When the user opens the list",
  "",
  "  @performance @module:contacts",
  "  Scenario: The contact list under average load",
  "    When 5 users per second list contacts",
  "    Then p95 stays under 800 ms",
  "    Endpoint: EP-contacts-1",
  "    Load: average-load at 5 rps; p95 < 800 ms; error rate < 1%",
  "",
  "  @module:deals",
  "  Scenario: A deal case",
  "    When x",
  "    Then y",
  "",
].join("\n");

test("import: a framework-format file becomes the module's cases (stable ids, source imported, rejected with their line)", async () => {
  const s = setup();
  await buildCatalogue(s.root);
  put(s.root, "data/contacts.feature", FEATURE_IMPORT);
  const r = await s.tc("import", "--file", "data/contacts.feature");
  assert.equal(r.code, 1, "a rejected case makes the import exit 1; the valid ones are imported");
  assert.equal(r.out.imported, 3);
  assert.equal(r.out.format, "gherkin");
  assert.deepEqual(r.out.rejected.map((x) => x.replace(/:.*/, "")), ["line 15", "line 26"]);
  assert.match(r.out.rejected.join("\n"), /line 15: .*has no expected result/);
  assert.match(r.out.rejected.join("\n"), /line 26: .*names the module 'deals', not 'contacts'/);
  const cov = s.cov();
  const byTitle = (t) => cov.cases.find((c) => c.title === t);
  const created = byTitle("A contact can be created from the list");
  assert.deepEqual([created.source, created.priority, created.preconditions, created.expected, created.from.id], ["imported", "p1", ["the user is on the contact list"], "the list shows Jane", "TC-77"]);
  assert.equal(byTitle("The contact list endpoint answers").api, true);
  const perf = byTitle("The contact list under average load");
  assert.deepEqual([perf.performance, perf.endpoint, perf.load], [true, "EP-contacts-1", { type: "average-load", rps: 5, slo: { p95_ms: 800, error_rate: 0.01 } }]);
  assert.deepEqual(r.out.unlinkedUi, [created.id], "an imported UI case is not linked to exploration states yet");
  assert.ok(readFileSync(s.tp.approvalCsv, "utf8").includes(created.id), "imported cases enter the human's sheet like generated ones");
  // the same file again: the same TC ids
  const again = await s.tc("import", "--file", "data/contacts.feature");
  assert.deepEqual(again.out.ids, r.out.ids);
  // the imported cases need no coverage item: check does not ask them to cover one; with playwright-ui chosen, it asks
  // the imported UI case to be linked to the exploration (decision 14)
  const problems = (await s.tc("check")).out.problems.filter((p) => p.includes(created.id));
  assert.deepEqual(problems, [`${created.id} (imported UI case '${created.key}') is not linked to the exploration: link it to the states its steps pass through (cases.json links)`]);
});

test("import: the product-level testcases.import is split by module; the module's own testcases_file wins; other documents go to the writer", async () => {
  const s = setup();
  const cfgFile = path.join(s.root, "config", "acme.yaml");
  assert.equal((await s.tc("paths")).out.importSource, null, "paths: no file named yet");
  put(s.root, "data/all.csv", serializeCsv([["ID", "Title", "Module", "Priority", "Steps", "Expected"], ["A-1", "Contacts open from the menu", "contacts", "p2", "1. Open the menu\n2. Choose Contacts", "the contact list is shown"], ["A-2", "Deals open", "deals", "p2", "Open Deals", "the deal list is shown"], ["A-3", "No module named", "", "p2", "x", "y is shown"]]));
  writeFileSync(cfgFile, readFileSync(cfgFile, "utf8") + "\ntestcases: {import: data/all.csv}\n");
  const r = await s.tc("import");
  assert.equal(r.out.imported, 1);
  assert.equal(r.out.skipped, 1, "the deals case is another module's");
  assert.match(r.out.rejected.join("\n"), /line 4: A-3: names no module/);
  assert.deepEqual(s.cov().cases[0].steps, ["Open the menu", "Choose Contacts"]);
  put(s.root, "data/contacts.md", "| ID | Title | Steps | Expected |\n|---|---|---|---|\n| M-1 | Contacts list sorts by name | Open the list | the rows are sorted by name |\n");
  writeFileSync(cfgFile, readFileSync(cfgFile, "utf8").replace("  - {slug: contacts, name: Contacts,", "  - {slug: contacts, name: Contacts, testcases_file: data/contacts.md,"));
  const m = await s.tc("import");
  assert.equal(m.code, 0, JSON.stringify(m.out));
  assert.deepEqual([m.out.format, m.out.file], ["markdown-table", "data/contacts.md"]);
  // paths tells testcase-writer's import mode which document the run-config names, and whether it needs converting
  assert.deepEqual((await s.tc("paths")).out.importSource, { file: "data/contacts.md", productLevel: false, format: "markdown-table", exists: true });
  put(s.root, "data/spec.docx", "PK\u0000binary");
  const d = await s.tc("import", "--file", "data/spec.docx");
  assert.equal(d.code, 1);
  assert.equal(d.out.convert, true);
  assert.match(d.out.next, /testcase-writer's import mode/);
});

test("import --approved is for a human at a terminal: no TTY refuses everything; the typed slug records each imported case approved", async () => {
  const s = setup();
  put(s.root, "data/contacts.feature", FEATURE_IMPORT.split("\n").slice(0, 8).join("\n") + "\n");
  const agent = await s.tcAs({ isTTY: false, ask: async () => "contacts" }, "import", "--file", "data/contacts.feature", "--approved");
  assert.equal(agent.code, 1);
  assert.match(agent.out.problems.join("\n"), /human-only/);
  assert.ok(!existsSync(s.tp.imported), "nothing was imported");
  const wrong = await s.tcAs({ isTTY: true, ask: async () => "deals" }, "import", "--file", "data/contacts.feature", "--approved");
  assert.equal(wrong.code, 1);
  assert.match(wrong.out.problems.join("\n"), /not confirmed/);
  assert.ok(!existsSync(s.tp.approvals));
  const ok = await s.tc("import", "--file", "data/contacts.feature", "--approved");
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  assert.deepEqual(ok.out.approved, ok.out.ids);
  assert.deepEqual((await s.tc("status")).out.approved, ok.out.ids);
});

test("import mode and links: an imported case cites its document verbatim; links name cases and exploration states", async () => {
  const s = setup();
  put(s.root, "docs-in/plan.txt", "Section 3. Saving a contact without an email shows a warning.\n");
  put(s.root, "data/contacts.feature", FEATURE_IMPORT.split("\n").slice(0, 8).join("\n") + "\n");
  await s.tc("import", "--file", "data/contacts.feature");
  const imported = { key: "doc-save-without-email", title: "Verify saving without an email", type: "negative", priority: "p2", action: "save a contact without an email", steps: ["Open a new contact", "Save"], expected: "works as expected", covers: [], evidence: [], source: "imported" };
  s.overlay({ cases: [{ ...imported, imported: { file: "docs-in/plan.txt", quote: "Saving a contact without an email shows a warning" } }, { ...imported, key: "doc-made-up", title: "Made up", imported: { file: "docs-in/plan.txt", quote: "a sentence the document never says" } }], links: { "imported-tc-77": ["ST-contacts-1"], "doc-save-without-email": ["ST-contacts-2"], nobody: ["ST-contacts-9"] } });
  const r = await s.tc("build");
  const p = r.out.problems.join("\n");
  assert.ok(!/case 'doc-save-without-email'/.test(p), "the human's wording is kept: no title, expected or covers rule; the quote is in the document");
  assert.match(p, /case 'doc-made-up': imported\.quote .* is not in docs-in\/plan\.txt/);
  assert.match(p, /links: 'nobody' is not a case key/);
  assert.match(p, /links: 'nobody' names ST-contacts-9, which is not a state of the exploration/);
  const linked = s.cov().cases.find((c) => c.key === "imported-tc-77");
  assert.deepEqual(linked.states, ["ST-contacts-1"]);
});

test("import mode (D-066): without the testcases step, the module's stage converts and links only; generated items are deferred (import)", async () => {
  const s = setup({ steps: ["explore", "playwright-ui"] });
  const { changeSteps } = await import("./run.mjs");
  assert.deepEqual(changeSteps("acme", { importMode: ["contacts"], root: s.root }).testcasesMode, { contacts: "import" }, "deals is unaffected");
  assert.equal((await s.tc("paths")).out.mode, "import");
  put(s.root, "data/contacts.feature", FEATURE_IMPORT.split("\n").slice(0, 8).join("\n") + "\n");
  put(s.root, "docs-in/plan.txt", "Section 3. Saving a contact without an email shows a warning.\n");
  await s.tc("import", "--file", "data/contacts.feature");
  // the writer converts the other document's case; linking the framework-format one is still missing
  const converted = { key: "doc-save-without-email", title: "Saving without an email warns", type: "negative", priority: "p2", action: "save a contact without an email", steps: ["Open a new contact", "Save"], expected: "a warning is shown", covers: [], evidence: [], source: "imported", imported: { file: "docs-in/plan.txt", quote: "Saving a contact without an email shows a warning" }, states: ["ST-contacts-2"] };
  s.overlay({ cases: [converted] });
  let b = await s.tc("build");
  assert.equal(b.code, 0, JSON.stringify(b.out.problems));
  assert.equal(b.out.mode, "import");
  const cov = s.cov();
  assert.equal(cov.mode, "import");
  assert.equal(cov.summary.pending, 0, "never pending");
  assert.equal(cov.summary.deferred, cov.summary.total, "never dropped: every item stays in the ledger, deferred");
  assert.ok(cov.items.every((i) => i.status === "deferred" && i.reason === "import" && /testcases step is not chosen/.test(i.detail)));
  let c = await s.tc("check");
  const tc77 = cov.cases.find((x) => x.key === "imported-tc-77").id;
  assert.deepEqual(c.out.problems, [`${tc77} (imported UI case 'imported-tc-77') is not linked to the exploration: link it to the states its steps pass through (cases.json links)`], "not required: only the links are asked for");
  s.overlay({ cases: [converted], links: { "imported-tc-77": ["ST-contacts-1"] } });
  await s.tc("build");
  c = await s.tc("check");
  assert.equal(c.code, 0, JSON.stringify(c.out.problems));
  assert.equal(testcasesUnverified(testcaseContext({ root: s.root, product: "acme", module: "contacts", run: loadJson(paths("acme", s.root).runFile), cfg: loadJson(paths("acme", s.root).configFile), productDir: paths("acme", s.root).productDir })), null);
  // a case of the writer's own is not import mode's to add
  s.overlay({ cases: [converted, kase("own-case", [cov.items[0].id])], links: { "imported-tc-77": ["ST-contacts-1"] } });
  b = await s.tc("build");
  assert.match(b.out.problems.join("\n"), /\(case 'own-case'\): import mode generates no case/);
  // quotes are checked as in generate mode
  s.overlay({ cases: [{ ...converted, imported: { file: "docs-in/plan.txt", quote: "never said" } }], links: { "imported-tc-77": ["ST-contacts-1"] } });
  b = await s.tc("build");
  assert.match(b.out.problems.join("\n"), /imported\.quote "never said" is not in docs-in\/plan\.txt/);
});

test("import mode needs an imported case; generate mode (testcases chosen) keeps generated and imported cases", async () => {
  const s = setup({ steps: ["explore", "playwright-api"] });
  const { changeSteps } = await import("./run.mjs");
  changeSteps("acme", { importMode: ["contacts"], root: s.root });
  s.overlay({ cases: [] });
  assert.match((await s.tc("build")).out.problems.join("\n"), /import mode: no imported case/);
  const g = setup();
  assert.equal((await g.tc("paths")).out.mode, "generate");
  const r = await g.tc("build");
  assert.equal(g.cov().mode, "generate");
  assert.ok(r.out.items.pending > 0, "generate mode: uncovered items are pending, as before");
});

test("scenario scope: only the items within the scenarios' flows (and answered clarifications); no rule items", async () => {
  const s = setup();
  put(s.root, `${MOD}/explore/flows/scenario-one.md`, "# Scenario one\n\nSC-contacts-1: ST-contacts-1 only.\n");
  put(s.root, `${MOD}/explore/coverage.json`, JSON.stringify({ scope: { kind: "scenarios", scenarios: [{ id: "SC-contacts-1", status: "flow", flows: ["scenario-one.md"] }] } }));
  const r = await s.tc("items");
  const by = r.out.byTechnique;
  assert.equal(by.flow, 1, "only the flow naming a scenario");
  assert.equal(by["state-transition"], undefined, "the transition leaves the scenario's states");
  assert.equal(by.rule, undefined);
  assert.equal(by["decision-table"], undefined);
  assert.equal(by.clarification, 2);
  assert.equal(by.ep, undefined, "the fields are on ST-contacts-2, outside the scenario");
  assert.match(r.out.degraded.join("\n"), /scoped to the scenarios SC-contacts-1/);
});
