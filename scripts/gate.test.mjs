// The pre-review gate finds the mechanical problems a reviewer used to find by reading, and passes clean work.
// Compile/list/inspect commands are skipped here (compile: false): they need the generated projects' toolchains.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gate } from "./gate.mjs";
import { append, csvPath, record } from "./lib/clarifications.mjs";
import { paths } from "./lib/contract.mjs";
import { put, startRun } from "./test-helpers.mjs";

const rules = (root, r) => {
  const text = readFileSync(path.join(root, r.file), "utf8");
  return new Set([...text.matchAll(/^\| \d+ \| \w+ \| [^|]* \| [^|]* \| ([\w-]+) \|/gm)].map((m) => m[1]));
};
const steps = "1. Sign in.\n2. Open Contacts.";

function withClarifications() {
  const s = startRun();
  const file = csvPath(paths("acme", s.root).productDir, "contacts");
  append(file, "contacts", "acme-run-1", [1, 2, 3].map((n) => ({ question: `Question ${n}?`, steps })));
  record(file, "contacts-1", { answer: "Yes", runId: "acme-run-1" });
  record(file, "contacts-3", { answer: "No", runId: "acme-run-1" });
  return s; // contacts-1 and -3 answered, contacts-2 open
}
const feature = (...scenarios) => ["Feature: Contacts", ...scenarios.flatMap(([tags, title]) => [`  ${tags}`, `  Scenario: ${title}`, "    Given x"])].join("\n");
const cases = (root, f, total) => {
  put(root, "artifacts/acme/modules/contacts/testcases/contacts-testcases.feature", f);
  put(root, "artifacts/acme/modules/contacts/testcases/testcases-summary.md", `Total test cases: ${total}\n`);
};

test("test cases: ids, tags, assumptions and clarification coverage are checked mechanically", () => {
  const { root } = withClarifications();
  cases(root, feature(
    ["@TC-contacts-1 @p1 @functional @contacts-1", "valid"],
    ["@TC-contacts-2 @p2 @negative @contacts-2", "relies on an open row without @assumption"],
    ["@TC-contacts-2 @functional", "duplicate id and no priority"],
    ["@TC-contacts-4 @p3 @boundary @contacts-9", "unknown clarification"],
  ), 4);
  const r = gate("acme", "contacts", "testcases", { root, compile: false });
  assert.equal(r.verdict, "changes-required");
  assert.equal(r.file, "artifacts/acme/results/acme-run-1/contacts/testcases/gate-findings.md");
  assert.deepEqual([...rules(root, r)].sort(), ["assumption", "case-id", "case-tags", "clarification-coverage", "clarification-ref"]);
  assert.match(readFileSync(path.join(root, r.file), "utf8"), /^Verdict: changes-required$/m);

  cases(root, feature(
    ["@TC-contacts-1 @p1 @functional @contacts-1", "a"],
    ["@TC-contacts-2 @p2 @negative @contacts-2 @assumption", "b"],
    ["@TC-contacts-3 @p2 @functional @contacts-3", "c"],
  ), 3);
  assert.deepEqual(gate("acme", "contacts", "testcases", { root, compile: false }), {
    verdict: "pass", file: r.file, counts: { blocker: 0, major: 0, minor: 0 },
  });
});

test("an answered clarification listed in the summary as not testable counts as covered", () => {
  const { root } = withClarifications();
  cases(root, feature(["@TC-contacts-1 @p1 @functional @contacts-1", "a"], ["@TC-contacts-2 @p2 @negative @contacts-2 @assumption", "b"]), 1);
  put(root, "artifacts/acme/modules/contacts/testcases/testcases-summary.md", "Total test cases: 2\n\n## Not testable\n- contacts-3: needs a second tenant\n");
  assert.equal(gate("acme", "contacts", "testcases", { root, compile: false }).verdict, "pass");
});

test("Playwright UI: traceability to non-@api cases, @mutates, fixed waits, URLs and page-object assertions", () => {
  const { root } = startRun();
  cases(root, feature(["@TC-contacts-1 @p1 @functional", "list"], ["@TC-contacts-2 @p1 @functional @mutates", "create"], ["@TC-contacts-3 @p2 @api", "api only"]), 3);
  put(root, "playwright-tests/acme/tests/ui/contacts/contacts.spec.ts", [
    "test('TC-contacts-1 lists contacts @p1', async ({ page }) => { await page.waitForTimeout(500); });",
    "test('TC-contacts-2 creates a contact @p1', async () => {});",
    "test('opens the app', async ({ page }) => { await page.goto('https://app.acme.test'); });",
  ].join("\n"));
  put(root, "playwright-tests/acme/pages/contacts/list.page.ts", "// https://example.test in a comment is fine\nexport class ListPage { async check() { await expect(this.title).toBeVisible(); } }\n");
  const r = gate("acme", "contacts", "playwright-ui", { root, compile: false });
  assert.equal(r.verdict, "changes-required");
  assert.deepEqual([...rules(root, r)].sort(), ["mutates-tag", "no-assertions-in-objects", "no-fixed-wait", "no-hardcoded-url", "traceability"]);
  assert.doesNotMatch(readFileSync(path.join(root, r.file), "utf8"), /TC-contacts-3 has no test/, "@api cases belong to the API side");

  put(root, "playwright-tests/acme/tests/ui/contacts/contacts.spec.ts", [
    "test('TC-contacts-1 lists contacts @p1', async () => {});",
    "test('TC-contacts-2 creates a contact @p1 @mutates', async () => { await recordCreated({ type: 'contact', ref: 'x' }); });",
  ].join("\n"));
  put(root, "playwright-tests/acme/pages/contacts/list.page.ts", "export class ListPage {}\n");
  assert.equal(gate("acme", "contacts", "playwright-ui", { root, compile: false }).verdict, "pass");
});

test("Playwright API: plan scenarios are traced and mutating specs record what they create", () => {
  const { root } = startRun();
  put(root, "artifacts/acme/modules/contacts/api/plan.json", JSON.stringify([{ id: "API-contacts-1", mutates: false }, { id: "API-contacts-2", mutates: true }]));
  put(root, "playwright-tests/acme/tests/api/contacts/contacts.spec.ts", [
    "test('API-contacts-1 lists @p1', async () => {});",
    "test.fixme('API-contacts-2 creates @p1 @mutates -- needs a writable tenant', async () => {});",
  ].join("\n"));
  const r = gate("acme", "contacts", "playwright-api", { root, compile: false });
  assert.deepEqual([...rules(root, r)], ["ledger"]);
  assert.throws(() => gate("acme", "billing", "playwright-api", { root }), /module must be one of/);
  assert.throws(() => gate("acme", "contacts", "report", { root }), /domain must be one of/);
});

test("k6: one script per workload scenario, safety calls in setup(), the shared lib present", () => {
  const { root } = startRun();
  put(root, "artifacts/acme/modules/contacts/k6/workload.json", JSON.stringify([
    { id: "K6-contacts-0", name: "excluded" }, { id: "K6-contacts-1", name: "smoke" }, { id: "K6-contacts-2", name: "ramp" },
  ]));
  put(root, "k6-tests/acme/scripts/contacts-smoke.js", "// K6-contacts-1 smoke\nexport function setup() { assertAllowedHost(); }\nexport { handleSummary } from '../lib/summary.js';\n");
  const r = gate("acme", "contacts", "k6", { root, compile: false });
  assert.deepEqual([...rules(root, r)].sort(), ["full-run", "lib", "traceability"]);

  put(root, "k6-tests/acme/lib/config.js", "export const x = 1;\n");
  put(root, "k6-tests/acme/scripts/contacts-smoke.js", "// K6-contacts-1\nexport function setup() { assertAllowedHost(); requireFullRun(false); }\nexport { handleSummary } from '../lib/summary.js';\n");
  put(root, "k6-tests/acme/scripts/contacts-ramp.js", "// K6-contacts-2\nexport function setup() { assertAllowedHost(); requireFullRun(false); }\nexport { handleSummary } from '../lib/summary.js';\n");
  assert.equal(gate("acme", "contacts", "k6", { root, compile: false }).verdict, "pass");
});
