// The pre-review gate finds the mechanical problems a reviewer used to find by reading, and passes clean work.
// Compile/list/inspect commands are skipped here (compile: false): they need the generated projects' toolchains.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { gate } from "./gate.mjs";
import { listFindings, listedTests } from "./lib/gate/playwright.mjs";
import { buildCases, put, startRun } from "./test-helpers.mjs";

const rules = (root, r) => {
  const text = readFileSync(path.join(root, r.file), "utf8");
  return new Set([...text.matchAll(/^\| \d+ \| \w+ \| [^|]* \| [^|]* \| ([\w-]+) \|/gm)].map((m) => m[1]));
};
// The test-case gate (the verified stamp of testcases.mjs check, clarification coverage by exact citation) is tested in
// testcases.test.mjs, where the cases are built by their script.

test("Playwright UI: traceability to approved non-@api cases only, @mutates, fixed waits, URLs and page-object assertions", async () => {
  const { root } = startRun();
  const id = await buildCases(root, { cases: [{ key: "list" }, { key: "create", mutates: true }, { key: "api-only", api: true }, { key: "waiting" }], approve: ["list", "create", "api-only"] });
  const spec = (lines) => put(root, "playwright-tests/acme/tests/ui/contacts/contacts.spec.ts", lines.join("\n"));
  spec([
    `test('${id.get("list")} lists contacts @p1', async ({ page }) => { await page.waitForTimeout(500); });`,
    `test('${id.get("create")} creates a contact @p1', async () => {});`,
    `test('${id.get("waiting")} not approved yet @p2', async () => {});`,
    "test('opens the app', async ({ page }) => { await page.goto('https://app.acme.test'); });",
  ]);
  put(root, "playwright-tests/acme/pages/contacts/list.page.ts", "// https://example.test in a comment is fine\nexport class ListPage { async check() { await expect(this.title).toBeVisible(); } }\n");
  const r = gate("acme", "contacts", "playwright-ui", { root, compile: false });
  assert.equal(r.verdict, "changes-required");
  assert.deepEqual([...rules(root, r)].sort(), ["approval", "mutates-tag", "no-assertions-in-objects", "no-fixed-wait", "no-hardcoded-url", "traceability"]);
  const text = readFileSync(path.join(root, r.file), "utf8");
  assert.doesNotMatch(text, new RegExp(`${id.get("api-only")} has no test`), "@api cases belong to the API side");
  assert.match(text, new RegExp(`${id.get("waiting")} is not approved by a human`));

  spec([
    `test('${id.get("list")} lists contacts @p1', async () => {});`,
    `test('${id.get("create")} creates a contact @p1 @mutates', async () => { await recordCreated({ type: 'contact', ref: 'x' }); });`,
    `test.fixme('${id.get("waiting")} lists contacts -- awaiting approval', async () => {});`,
  ]);
  put(root, "playwright-tests/acme/pages/contacts/list.page.ts", "export class ListPage {}\n");
  assert.equal(gate("acme", "contacts", "playwright-ui", { root, compile: false }).verdict, "pass", "an unapproved case needs no test; one that exists is a fixme awaiting approval");
});

test("Playwright UI: one literal test per case -- built titles and aliases of test are flagged; strings, comments and fixtures are not", async () => {
  const { root } = startRun();
  const id = await buildCases(root, { cases: [{ key: "list" }, { key: "waiting" }], approve: ["list"] });
  const [list, waiting] = [id.get("list"), id.get("waiting")];
  const spec = (lines) => put(root, "playwright-tests/acme/tests/ui/contacts/contacts.spec.ts", lines.join("\n"));
  const findings = () => {
    const r = gate("acme", "contacts", "playwright-ui", { root, compile: false });
    return [...readFileSync(path.join(root, r.file), "utf8").matchAll(/^\| \d+ \| \w+ \| [^|]* \| (\d*) \| ([\w-]+) \| ([^|]*) \|/gm)].map((m) => ({ line: Number(m[1]), rule: m[2], problem: m[3].trim() }));
  };
  const base = [
    `test('${list} lists contacts @p1', async ({ page }) => {`,
    `  await expect(page.getByText('${waiting} note')).toBeVisible(); // see foo('${waiting} x')`,
    "  test.skip(true, 'not on webkit');",
    "  test.info();",
    "  expect(/^a\\(b/.test('y')).toBe(false); // a RegExp .test(), and a regex that unbalances the parentheses",
    "});",
    `test.fixme('${waiting} lists contacts -- awaiting approval', async () => {});`,
    "test.describe(`${'group'}`, () => {});",
    "/* test(title, async () => {}) in a block comment */",
  ];
  spec(base);
  put(root, "playwright-tests/acme/fixtures/ui/index.ts", "import { test as base } from '@playwright/test';\nexport const test = base.extend({});\nexport { expect } from '@playwright/test';\n");
  assert.deepEqual(findings(), [], "a literal test, a fixme awaiting approval, getByText with an id, comments, annotations and the fixtures file pass");

  const bypasses = [
    ["a variable title", [`const title = '${waiting} lists contacts';`, "test(title, async () => {});"]],
    ["a loop building titles", ["for (const n of [2, 3]) {", "  test(`TC-contacts-${n} lists`, async () => {});", "}"]],
    ["an alias with a joined title", ["const t = test;", "t('TC-contacts-' + 2, async () => {});"]],
    ["an alias with a template title", ["const { only } = test;", "only(`${'TC-contacts-2'}`, async () => {});"]],
    ["an alias with a variable title", ["const it = test.extend({});", "const name = 'TC-contacts-2';", "it(name, async () => {});"]],
    ["test passed as an argument", ["register(test, 'TC-contacts-2');"]],
    ["a joined title on test itself", ["test('TC-contacts-' + '2 lists', async () => {});"]],
  ];
  for (const [what, lines] of bypasses) {
    spec([...base, ...lines]);
    const f = findings().filter((x) => x.rule === "test-declaration");
    assert.ok(f.length >= 1, `${what} is flagged`);
    assert.ok(f.every((x) => x.line > base.length), `${what}: only the added lines`);
  }
  spec([...base, "test(title, async () => {});"]);
  assert.match(findings().find((x) => x.rule === "test-declaration").problem, /test title must be a literal carrying its case id/);
});

test("Playwright UI, compile mode: the gate trusts Playwright's own list -- an unapproved id anywhere in a title path is flagged", () => {
  const ok = (extra = {}) => [{ expectedStatus: "passed", annotations: [], projectName: "ui", results: [], ...extra }];
  const report = {
    config: {},
    suites: [{
      title: "contacts/contacts.spec.ts", file: "contacts/contacts.spec.ts", line: 0, column: 0,
      specs: [
        { title: "TC-contacts-1 lists contacts @p1", file: "contacts/contacts.spec.ts", line: 3, tests: ok() },
        { title: "TC-contacts-2 lists contacts -- awaiting approval", file: "contacts/contacts.spec.ts", line: 5, tests: ok({ expectedStatus: "skipped", annotations: [{ type: "fixme" }] }) },
        { title: "TC-contacts-2 declared through a helper", file: "contacts/contacts.spec.ts", line: 7, tests: ok() },
        { title: "no case id at all", file: "contacts/contacts.spec.ts", line: 9, tests: ok() },
      ],
      suites: [
        { title: "TC-contacts-2 group", file: "contacts/contacts.spec.ts", line: 11, specs: [{ title: "lists through an alias", file: "contacts/contacts.spec.ts", line: 12, tests: ok() }], suites: [] },
        { title: "TC-contacts-1 group", file: "contacts/contacts.spec.ts", line: 14, specs: [{ title: "inner step test", file: "contacts/contacts.spec.ts", line: 15, tests: ok() }], suites: [] },
      ],
    }],
    errors: [],
  };
  const tests = listedTests(report);
  assert.deepEqual(tests.map((t) => [t.line, t.titlePath.join(" > "), t.fixme]), [
    [3, "TC-contacts-1 lists contacts @p1", false],
    [5, "TC-contacts-2 lists contacts -- awaiting approval", true],
    [7, "TC-contacts-2 declared through a helper", false],
    [9, "no case id at all", false],
    [12, "TC-contacts-2 group > lists through an alias", false],
    [15, "TC-contacts-1 group > inner step test", false],
  ]);
  const f = listFindings(tests, { idRe: /TC-contacts-\d+/g, unapproved: new Set(["TC-contacts-2"]), what: "test case", dir: "tests/ui/contacts" });
  assert.deepEqual(f.map((x) => [x.line, x.severity, x.rule]), [[7, "major", "approval"], [9, "major", "traceability"], [12, "major", "approval"]], "approved tests, a fixme awaiting approval and an id carried by a describe title pass");
  assert.equal(f[0].file, "tests/ui/contacts/contacts.spec.ts");

  // files are relative to config.rootDir: a subfolder spec and a helper keep their real paths in the project
  const project = path.resolve("pw-project");
  const real = listedTests({
    config: { rootDir: path.join(project, "tests", "ui").replaceAll("\\", "/") },
    suites: [
      { title: "contacts/deep/d.spec.ts", file: "contacts/deep/d.spec.ts", specs: [{ title: "TC-contacts-2 deep", file: "contacts/deep/d.spec.ts", line: 2, tests: ok() }], suites: [] },
      { title: "../../helpers/ui/contacts.flows.ts", file: "../../helpers/ui/contacts.flows.ts", specs: [{ title: "TC-contacts-2 via a helper", file: "../../helpers/ui/contacts.flows.ts", line: 3, tests: ok() }], suites: [] },
    ],
  });
  assert.deepEqual(listFindings(real, { idRe: /TC-contacts-\d+/g, unapproved: new Set(["TC-contacts-2"]), what: "test case", root: project, dir: "tests/ui/contacts" }).map((x) => x.file),
    ["tests/ui/contacts/deep/d.spec.ts", "helpers/ui/contacts.flows.ts"]);
});

test("Playwright UI, syntax fallback: renamed imports, namespaces, bracket access, require renames and tests declared in helpers are flagged", async () => {
  const { root } = startRun();
  const id = await buildCases(root, { cases: [{ key: "list" }, { key: "waiting" }], approve: ["list"] });
  const [list, waiting] = [id.get("list"), id.get("waiting")];
  const good = [`test('${list} lists contacts @p1', async () => {});`, `test.fixme('${waiting} lists contacts -- awaiting approval', async () => {});`];
  const spec = (lines) => put(root, "playwright-tests/acme/tests/ui/contacts/contacts.spec.ts", [...good, ...lines].join("\n"));
  const declarations = () => {
    const r = gate("acme", "contacts", "playwright-ui", { root, compile: false });
    return [...readFileSync(path.join(root, r.file), "utf8").matchAll(/^\| \d+ \| \w+ \| ([^|]*) \| (\d*) \| test-declaration \| ([^|]*) \|/gm)].map((m) => ({ file: m[1].trim(), line: Number(m[2]), problem: m[3].trim() }));
  };
  spec([]);
  assert.deepEqual(declarations(), []);
  for (const [what, lines, re] of [
    ["a renamed import", ["import { test as t, expect } from '../../../fixtures/ui';", `t('${waiting} sneaks in', async () => {});`], /test imported under another name/],
    ["a renamed import as base", ["import { test as base } from '@playwright/test';", "base('TC-contacts-2 x', async () => {});"], /test imported under another name/],
    ["a namespace member", ["import * as F from '../../../fixtures/ui';", "F.test(title, async () => {});"], /test used as a member of F/],
    ["bracket access", [`test["only"]('${waiting} x', async () => {});`, "test['fixme'](title, async () => {});"], /test used with bracket access/],
    ["a require rename", ["const { test: t2 } = require('../../../fixtures/ui');", "t2(title, async () => {});"], /test destructured under another name/],
  ]) {
    spec(lines);
    const d = declarations();
    assert.ok(d.some((x) => re.test(x.problem) && x.line > good.length), `${what}: ${JSON.stringify(d)}`);
  }
  spec([]);
  put(root, "playwright-tests/acme/helpers/ui/contacts.flows.ts", `import { test } from '../../fixtures/ui';\nexport function declareWaiting() {\n  test('${waiting} via a helper', async () => {});\n}\n`);
  const d = declarations();
  assert.deepEqual(d.map((x) => [x.file, x.line]), [["helpers/ui/contacts.flows.ts", 3]]);
  assert.match(d[0].problem, /declares a test outside a spec file/);
  put(root, "playwright-tests/acme/helpers/ui/contacts.flows.ts", "export const isEmail = (s: string) => /@/.test(s);\n");
  assert.deepEqual(declarations(), [], "a RegExp .test() in a helper is not a test");
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
