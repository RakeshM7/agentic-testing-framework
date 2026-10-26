// scripts/ui-code.mjs: UI test code scaffolded per approved test case and required page template (D-055). The module is
// explored from the fixture snapshots in scripts/fixtures/explore/ (scripts/explore.mjs), its cases are built and
// approved through scripts/testcases.mjs, and the foundation is rendered by scripts/foundation.mjs. No browser, no
// product, no Playwright: the compile commands (tsc, playwright --list) are injected.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./ui-code.mjs";
import { main as explore } from "./explore.mjs";
import { main as testcases } from "./testcases.mjs";
import { gate } from "./gate.mjs";
import { paths } from "./lib/contract.mjs";
import { parseCsv, serializeCsv } from "./lib/csv.mjs";
import { explorePaths } from "./lib/explore.mjs";
import { checkTool } from "./lib/guard.mjs";
import { expandFw } from "./lib/roots.mjs";
import { normalize } from "./hooks/hosts/claude.mjs";
import { FLOWS } from "./lib/domain-flows.mjs";
import { lit, locatorProblem, noUiCases, parseLocators, parseRegions, renderSpec, scanTs, smokeClickProblem, snapshotFacts, uiCodeContext, uiCodeUnverified } from "./lib/ui-code.mjs";
import { listFindings } from "./lib/gate/playwright.mjs";
import { listSpecTitles, put, renderFoundation, startRun, writeModuleKnowledge, writeProductKnowledge } from "./test-helpers.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "explore");
const PW = "playwright-tests/acme";
const SPEC = `${PW}/tests/ui/contacts/cases.spec.ts`;
const SMOKE = `${PW}/tests/ui/contacts/_locators.smoke.spec.ts`;
const REG = `${PW}/fixtures/ui/pages/contacts.ts`;
const INDEX = `${PW}/fixtures/ui/index.ts`;
const UC = "artifacts/acme/modules/contacts/ui-code";

// The compile commands, as a passing tsc and a Playwright list of what the specs declare.
const exec = () => null;
const listTests = listSpecTitles;

// A run whose module is explored (the list, its New contact dialog, a contact's page), with a flow naming the list
// state, and whose UI foundation is rendered. dialogVia: the first click that reached the dialog (its recorded path).
async function setup({ extra = [], dialogVia = 'button "New contact"' } = {}) {
  const { root } = startRun({ extra });
  writeProductKnowledge(root);
  writeModuleKnowledge(root, "contacts");
  const xp = explorePaths(paths("acme", root).productDir, "contacts");
  let n = 0;
  const state = async (name, via, action) => {
    mkdirSync(xp.captures, { recursive: true });
    const to = `captures/${++n}-${name}`;
    copyFileSync(path.join(FIX, name), path.join(xp.dir, to));
    const r = await explore(["state", "acme", "contacts", "--snapshot", to, ...(via ? ["--via", via, "--action", action] : [])], { root, env: {} });
    assert.equal(r.code, 0, JSON.stringify(r.out));
    return r.out.state;
  };
  const list = await state("contacts-list.md");
  const dialog = await state("contacts-list-dialog.md", list, dialogVia);
  const detail = await state("contacts-detail.md", list, 'link "Jane Doe"');
  await explore(["build", "acme", "contacts"], { root, env: {} });
  put(root, "artifacts/acme/modules/contacts/explore/flows/main.md", `# Browse contacts\n\nStates: ${list}.\n\n1. Open "Contacts".\n\nExpected result: the contacts are listed.\n`);
  await renderFoundation(root, ["repo", "ui"]);
  const s = { root, ids: { list, dialog, detail } };
  s.uc = (...args) => main(args, { root, exec, listTests });
  s.read = (rel) => readFileSync(path.join(root, rel), "utf8");
  s.json = (rel) => JSON.parse(s.read(rel));
  s.write = (rel, text) => put(root, rel, text);
  s.ctx = () => {
    const p = paths("acme", root);
    return uiCodeContext({ root, product: "acme", module: "contacts", run: JSON.parse(readFileSync(p.runFile, "utf8")), cfg: JSON.parse(readFileSync(p.configFile, "utf8")), productDir: p.productDir });
  };
  return s;
}

// The writer's cases (each covering one coverage item), built by testcases.mjs, and the keys in `approve` approved by a
// human at a terminal. -> Map key -> TC id
const CASES = {
  list: { title: "The contact list shows the contacts", cover: "flow", steps: ["Open Contacts"], expected: "the contact is listed in the table" },
  create: { title: "A new contact is saved from the dialog", cover: "dialog", mutates: true, priority: "p1", steps: ["Open Contacts", "Click New contact", "Fill in the Name"], expected: "the contact is listed in the table", data: { name: "Ada Example" } },
  detail: { title: "A contact's page looks as recorded", cover: "detail", type: "visual", steps: ["Open Jane Doe from the list"], expected: "the contact page is shown with its Edit button" },
  waiting: { title: "The contact list can be sorted", cover: "flow", steps: ["Sort by Name"], expected: "the contact is listed in the table sorted by name" },
  api: { title: "The contacts endpoint lists contacts", cover: "flow", api: true, type: "api", steps: ["GET the contacts"], expected: "the contact is listed in the response" },
};
async function cases(s, keys, approve = keys, { clear = true } = {}) {
  const tc = (...args) => testcases(args, { root: s.root, interactive: { isTTY: true, ask: async () => "contacts" } });
  const items = (await tc("items", "acme", "contacts")).out.items;
  const cover = { flow: items.find((i) => i.technique === "flow").id, dialog: items.find((i) => i.subject === `${s.ids.list} -> ${s.ids.dialog}`).id, detail: items.find((i) => i.subject === `${s.ids.list} -> ${s.ids.detail}`).id };
  const overlay = keys.map((key) => {
    const c = typeof key === "string" ? { key, ...CASES[key] } : key;
    return {
      key: c.key, title: c.title, type: c.type ?? "functional", priority: c.priority ?? "p2", ...(c.mutates ? { mutates: true } : {}), ...(c.api ? { api: true } : {}),
      action: "the user works with the contacts", steps: c.steps, expected: c.expected, ...(c.data ? { data: c.data } : {}),
      covers: [cover[c.cover]], evidence: ["observation:explore/flows/main.md"],
    };
  });
  s.write("artifacts/acme/modules/contacts/testcases/cases.json", JSON.stringify({ cases: overlay }));
  const b = await tc("build", "acme", "contacts");
  assert.equal(b.out.problems.length, 0, JSON.stringify(b.out.problems));
  const ids = new Map(s.json("artifacts/acme/modules/contacts/testcases/coverage.json").cases.map((c) => [c.key, c.id]));
  const sheet = "artifacts/acme/modules/contacts/testcases/approval.csv";
  const rows = parseCsv(s.read(sheet));
  const col = rows[0].indexOf("Approved");
  for (const r of rows.slice(1)) {
    const yes = approve.some((k) => ids.get(typeof k === "string" ? k : k.key) === r[0]);
    if (yes || clear) r[col] = yes ? "yes" : "";
  }
  writeFileSync(path.join(s.root, sheet), serializeCsv(rows));
  if (approve.length) {
    const a = await tc("approve", "acme", "contacts");
    assert.equal(a.code, 0, JSON.stringify(a.out));
  }
  return ids;
}

// Page objects written the way pw-ui-pom-writer would, names verbatim from the snapshots, and their registration.
const PAGES = {
  "pages/contacts/contacts.page.ts": `import type { Locator, Page } from '@playwright/test';

export class ContactsPage {
  readonly page: Page;
  readonly newContact: Locator;
  readonly search: Locator;
  readonly table: Locator;

  constructor(page: Page) {
    this.page = page;
    this.newContact = page.getByRole('button', { name: 'New contact' });
    this.search = page.getByRole('searchbox', { name: 'Search contacts' });
    this.table = page.getByRole('table', { name: 'Contacts' });
  }

  row(name: string): Locator {
    return this.page.getByRole('row', { name, exact: true });
  }

  async openNewContact(): Promise<void> {
    await this.newContact.click();
  }
}
`,
  "pages/contacts/components/new-contact.component.ts": `import type { Locator, Page } from '@playwright/test';

export class NewContactDialog {
  readonly page: Page;
  readonly root: Locator;
  readonly name: Locator;
  readonly save: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByRole('dialog', { name: 'New contact' });
    this.name = this.root.getByRole('textbox', { name: 'Name *' });
    this.save = this.root.getByRole('button', { name: 'Save' });
  }
}
`,
  "pages/contacts/contacts-id.page.ts": `import type { Locator, Page } from '@playwright/test';

export class ContactsIdPage {
  readonly page: Page;
  readonly edit: Locator;
  readonly back: Locator;

  constructor(page: Page) {
    this.page = page;
    this.edit = page.getByRole('button', { name: 'Edit' });
    this.back = page.getByRole('link', { name: 'Back to contacts' });
  }
}
`,
};
const INDEX_TS = `import { test as base } from './base';
import { contactsPages, type ContactsPages } from './pages/contacts';

export const test = base.extend<ContactsPages>({ ...contactsPages });

export { expect, waitForReady } from './base';
`;
function writePages(s, only = Object.keys(PAGES)) {
  for (const f of only) s.write(`${PW}/${f}`, PAGES[f]);
}

// Step bodies the way pw-ui-tests-writer would fill them (body(key, test) may override one).
function fillSteps(s, body = () => null) {
  const ctx = s.ctx();
  const plan = s.json(`${UC}/plan.json`);
  const { regions } = parseRegions(s.read(SPEC));
  for (const t of plan.tests) {
    t.steps.forEach((_, n) => regions.set(`${t.id} step ${n + 1}`, body(`${t.id} step ${n + 1}`, t) ?? [n === 0 && t.mutates ? "      await contactsNewContactDialog.save.click();\n      recordCreated({ type: 'contact', ref: 'c-1', module: 'contacts' });" : "      await page.goto('/contacts');"].join("\n").split("\n")));
    regions.set(`${t.id} then`, body(`${t.id} then`, t) ?? [...(t.visual ? [`      await expect(page).toHaveScreenshot('${t.id}.png');`] : []), "      await expect(contactsPage.table).toBeVisible();"]);
  }
  if (!regions.get("setup")?.length) regions.set("setup", ["import { recordCreated } from '../../../utils/shared/ledger';"]);
  s.write(SPEC, renderSpec(ctx, plan, regions));
}

const rules = (r) => r.out.problems.map((p) => /\[([\w-]+)\]/.exec(p)?.[1] ?? p);

test("build: one test per approved UI case with its title, tags and steps; unapproved and @api cases are never generated", async () => {
  const s = await setup();
  const id = await cases(s, ["list", "create", "detail", "waiting", "api"], ["list", "create", "detail", "api"]);
  const r = await s.uc("build", "acme", "contacts");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(r.out.tests, 3);
  assert.deepEqual(r.out.awaiting, [{ id: id.get("waiting"), status: "awaiting" }]);
  const spec = s.read(SPEC);
  assert.match(spec, new RegExp(`test\\('${id.get("create")} A new contact is saved from the dialog @p1 @functional @mutates', async \\(\\{ page, contactsPage, contactsNewContactDialog \\}\\) =>`));
  assert.ok(spec.includes(`test("${id.get("detail")} A contact's page looks as recorded @p2 @visual", async ({ page, contactsPage, contactsIdPage }) =>`), "an apostrophe in a title: double quotes, never an escaped quote");
  assert.match(spec, new RegExp(`test\\.step\\('3\\. Fill in the Name', async \\(\\) => \\{\\n      // ui-code:begin ${id.get("create")} step 3\\n      // ui-code:end ${id.get("create")} step 3`));
  assert.match(spec, /test\.step\('Then: the contact is listed in the table'/);
  assert.match(spec, /Test data \(values in the test case; build them in helpers\/ui\/contacts\.data\.ts\): name/);
  assert.doesNotMatch(spec, new RegExp(`${id.get("waiting")}|${id.get("api")}`), "an unapproved case and an @api case get no test");
  // the ledger: every case and page template accounted for
  const cov = s.json(`${UC}/coverage.json`);
  const item = (x) => cov.items.find((i) => i.id === x);
  assert.deepEqual([item(id.get("list")).status, item(id.get("list")).refs], ["mapped", ["tests/ui/contacts/cases.spec.ts"]]);
  assert.deepEqual([item(id.get("waiting")).status, item(id.get("waiting")).reason, item(id.get("waiting")).detail], ["excluded", "not-approved", "awaiting a human approval"]);
  assert.deepEqual([item(id.get("api")).status, item(id.get("api")).reason], ["excluded", "api-side"]);
  assert.deepEqual(cov.summary, { total: 8, mapped: 6, excluded: 2, pending: 0, deferred: 0 });
  assert.deepEqual(cov.verified, { pages: null, tests: null });
});

test("required page objects: one per page template an approved case touches (transitions, flows), a component per dialog; shells seeded once", async () => {
  const s = await setup();
  await cases(s, ["list", "create", "detail"], ["list", "create"]);
  const r = await s.uc("build", "acme", "contacts");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  const plan = s.json(`${UC}/plan.json`);
  assert.deepEqual(plan.objects.map((o) => [o.key, o.class, o.fixture, o.file]), [
    ["PG-contacts-1", "ContactsPage", "contactsPage", "pages/contacts/contacts.page.ts"],
    ["PG-contacts-1#dialog:New contact", "NewContactDialog", "contactsNewContactDialog", "pages/contacts/components/new-contact.component.ts"],
  ]);
  assert.deepEqual(plan.objects[1].states, [s.ids.dialog], "a component is grounded in the states that show its dialog");
  assert.deepEqual(plan.objects[0].states, [s.ids.list, s.ids.dialog], "a page object in every state of its template");
  const cov = s.json(`${UC}/coverage.json`);
  assert.deepEqual(cov.items.filter((i) => i.kind !== "case").map((i) => [i.id, i.status, i.reason ?? i.refs[0]]), [
    ["PG-contacts-1", "mapped", "pages/contacts/contacts.page.ts"],
    ["PG-contacts-2", "excluded", "not-touched"],
    ["PG-contacts-1#dialog:New contact", "mapped", "pages/contacts/components/new-contact.component.ts"],
  ]);
  // shells: written once, compiling, with the dialog's root grounded; the registration names every fixture
  assert.match(s.read(`${PW}/pages/contacts/components/new-contact.component.ts`), /this\.root = page\.getByRole\('dialog', \{ name: 'New contact' \}\);/);
  s.write(`${PW}/pages/contacts/contacts.page.ts`, PAGES["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  assert.equal(s.read(`${PW}/pages/contacts/contacts.page.ts`), PAGES["pages/contacts/contacts.page.ts"], "never overwritten once it exists");
  const reg = s.read(REG);
  assert.match(reg, /^\/\/ Generated by scripts\/ui-code\.mjs — do not edit\./);
  assert.match(reg, /import \{ NewContactDialog \} from '\.\.\/\.\.\/\.\.\/pages\/contacts\/components\/new-contact\.component';/);
  assert.match(reg, /contactsNewContactDialog: async \(\{ page \}: \{ page: Page \}, use: \(value: NewContactDialog\) => Promise<void>\) => \{\n    await use\(new NewContactDialog\(page\)\);/);
  // approving the detail case adds its template
  await cases(s, ["list", "create", "detail"], ["list", "create", "detail"]);
  await s.uc("build", "acme", "contacts");
  assert.ok(s.json(`${UC}/plan.json`).objects.some((o) => o.key === "PG-contacts-2" && o.class === "ContactsIdPage"));
});

test("regeneration is deterministic and keeps every region's body; a body whose test goes away is parked and comes back", async () => {
  const s = await setup();
  const id = await cases(s, ["list", "create", "detail"], ["list", "create"]);
  await s.uc("build", "acme", "contacts");
  writePages(s);
  await s.uc("build", "acme", "contacts");
  fillSteps(s, (key) => (key.endsWith("step 1") ? [`      // written for ${key}`, "      await contactsPage.openNewContact();"] : null));
  const filled = s.read(SPEC);
  const again = await s.uc("build", "acme", "contacts");
  assert.equal(s.read(SPEC), filled, "a rebuild with the same inputs changes nothing");
  assert.ok(!again.out.written.includes("tests/ui/contacts/cases.spec.ts"));

  // approving another case adds its test; every body already written stays
  await cases(s, ["list", "create", "detail"], ["list", "create", "detail"]);
  await s.uc("build", "acme", "contacts");
  const spec = s.read(SPEC);
  for (const k of ["list", "create"]) assert.ok(spec.includes(`// written for ${id.get(k)} step 1`), `${k}'s body kept`);
  assert.match(spec, new RegExp(`// ui-code:begin ${id.get("detail")} step 1\\n      // ui-code:end ${id.get("detail")} step 1`), "the new test's regions are empty");

  // the case is edited, so its approval no longer holds: its test goes, its bodies are parked
  const edited = { key: "create", ...CASES.create, steps: ["Open Contacts", "Click New contact", "Type the Name"] };
  await cases(s, ["list", edited, "detail"], []); // nobody has looked at the edited case yet
  const r = await s.uc("build", "acme", "contacts");
  assert.ok(!s.read(SPEC).includes(id.get("create")), "an unapproved case has no test");
  assert.ok(r.out.parked.includes(`${id.get("create")} step 1`));
  assert.deepEqual(r.out.awaiting, [{ id: id.get("create"), status: "invalidated" }]);
  assert.deepEqual(s.json(`${UC}/parked.json`).regions[`${id.get("create")} step 1`].lines, [`      // written for ${id.get("create")} step 1`, "      await contactsPage.openNewContact();"]);
  // approved again: the bodies come back, and a step whose text changed is reported for the writer
  await cases(s, ["list", edited, "detail"], ["list", edited, "detail"]);
  const back = await s.uc("build", "acme", "contacts");
  assert.ok(back.out.restored.includes(`${id.get("create")} step 1`));
  assert.ok(s.read(SPEC).includes(`// written for ${id.get("create")} step 1`));
  assert.equal(s.json(`${UC}/parked.json`).regions[`${id.get("create")} step 1`], undefined);

  // markers broken by hand: the file is never rewritten, so no body is lost
  s.write(SPEC, s.read(SPEC).replace(`// ui-code:end ${id.get("list")} then`, ""));
  const broken = s.read(SPEC);
  const b = await s.uc("build", "acme", "contacts");
  assert.equal(b.code, 1);
  assert.match(b.out.problems.join("\n"), /region '.*' (never ends|starts inside region).*the file was not rewritten/);
  assert.equal(s.read(SPEC), broken);
});

test("budget: approved cases beyond testcases.max_cases are deferred, the lowest priority first", async () => {
  const s = await setup({ extra: ["testcases: {max_cases: 1}"] });
  const id = await cases(s, ["list", "create"]);
  const r = await s.uc("build", "acme", "contacts");
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual(r.out.deferred, [id.get("list")], "the p1 case stays, the p2 one waits");
  const item = s.json(`${UC}/coverage.json`).items.find((i) => i.id === id.get("list"));
  assert.deepEqual([item.status, item.reason, item.detail], ["deferred", "budget", "over testcases.max_cases (1)"]);
  assert.ok(!s.read(SPEC).includes(id.get("list")));
});

test("static locator check: names verbatim from the template's snapshots pass; anything else is a finding", async () => {
  const s = await setup();
  await cases(s, ["list", "create"]);
  await s.uc("build", "acme", "contacts");
  writePages(s);
  await s.uc("build", "acme", "contacts");
  let r = await s.uc("check", "acme", "contacts", "--pages");
  assert.equal(r.code, 0, JSON.stringify(r.out.problems));
  assert.equal(r.out.stamped, true);

  const page = `${PW}/pages/contacts/contacts.page.ts`;
  const good = PAGES["pages/contacts/contacts.page.ts"];
  for (const [what, from, to, re] of [
    ["a name not in any snapshot", "{ name: 'New contact' }", "{ name: 'Add contact' }", /getByRole: role 'button' named 'Add contact' is in none of the template's state snapshots/],
    ["a role the name doesn't have", "getByRole('searchbox', { name: 'Search contacts' })", "getByRole('textbox', { name: 'Search contacts' })", /role 'textbox' named 'Search contacts'/],
    ["a name from another template", "{ name: 'New contact' }", "{ name: 'Edit' }", /named 'Edit' is in none/],
    ["a regular expression", "{ name: 'New contact' }", "{ name: /new/i }", /regular expression .* use the name verbatim/],
    ["a built name", "{ name: 'New contact' }", "{ name: 'New ' + 'contact' }", /name must be a string literal/],
    ["a label not shown", "page.getByRole('table', { name: 'Contacts' })", "page.getByLabel('Contacts list')", /getByLabel: 'Contacts list' is in none/],
    ["a text not shown", "page.getByRole('table', { name: 'Contacts' })", "page.getByText('No contacts yet')", /getByText: 'No contacts yet'/],
    ["a test id not shown", "page.getByRole('table', { name: 'Contacts' })", "page.getByTestId('contacts-table')", /getByTestId: 'contacts-table'/],
  ]) {
    s.write(page, good.replace(from, to));
    r = await s.uc("check", "acme", "contacts", "--pages");
    assert.equal(r.code, 1, what);
    assert.ok(r.out.problems.some((p) => p.includes("[locator-grounding]") && re.test(p)), `${what}: ${JSON.stringify(r.out.problems)}`);
    assert.equal(s.json(`${UC}/coverage.json`).verified.pages, null, "a failing check clears the stamp");
  }
  // text, labels, placeholders and a data-driven parameter are fine when the snapshot shows them
  s.write(page, good.replace("page.getByRole('table', { name: 'Contacts' })", "page.getByText('Showing 1-3 of 245')").replace("page.getByRole('searchbox', { name: 'Search contacts' })", "page.getByLabel('Search contacts')"));
  assert.equal((await s.uc("check", "acme", "contacts", "--pages")).code, 0);
  // a component's locators are grounded in its dialog's states only
  const comp = `${PW}/pages/contacts/components/new-contact.component.ts`;
  s.write(comp, PAGES["pages/contacts/components/new-contact.component.ts"].replace("this.root.getByRole('button', { name: 'Save' })", "this.root.getByRole('button', { name: 'Delete selected' })"));
  r = await s.uc("check", "acme", "contacts", "--pages");
  assert.equal(r.code, 0, "Delete selected is on the dialog state's page too: the dialog's states are its ground");
  s.write(comp, PAGES["pages/contacts/components/new-contact.component.ts"].replace("{ name: 'Save' }", "{ name: 'Edit' }"));
  assert.ok((await s.uc("check", "acme", "contacts", "--pages")).out.problems.some((p) => p.startsWith("pages/contacts/components/new-contact.component.ts:")));
});

test("selector policy: CSS or XPath needs a cited reason comment; a bad citation is a finding", async () => {
  const s = await setup();
  await cases(s, ["list"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  const page = `${PW}/pages/contacts/contacts.page.ts`;
  const good = PAGES["pages/contacts/contacts.page.ts"];
  const css = (comment) => good.replace("this.table = page.getByRole('table', { name: 'Contacts' });", `${comment}\n    this.table = page.locator('table.contacts > tbody');`);
  const pages = async () => (await s.uc("build", "acme", "contacts"), s.uc("check", "acme", "contacts", "--pages"));
  s.write(page, css(""));
  let r = await pages();
  assert.ok(r.out.problems.some((p) => p.includes("[locator-policy]") && /CSS\/XPath selector \(table\.contacts > tbody\) without a cited reason/.test(p)), JSON.stringify(r.out.problems));
  s.write(page, css(`    // locator: css because the table has no accessible name in some states [observation:explore/pages/contacts/states/${s.ids.list}.md]`));
  r = await pages();
  assert.equal(r.code, 0, JSON.stringify(r.out.problems));
  s.write(page, css("    // locator: css because the table has no name [observation:explore/pages/contacts/states/ST-contacts-99.md]"));
  assert.ok((await pages()).out.problems.some((p) => /the reason for a CSS\/XPath selector .* cites .*no such file under the module/.test(p)));
  s.write(page, good.replace("this.table = page.getByRole('table', { name: 'Contacts' });", "this.table = page.locator('//table');\n    void page.$('tr');"));
  assert.equal((await pages()).out.problems.filter((p) => p.includes("[locator-policy]")).length, 2, "an XPath and a $() handle too");
  // chaining a Locator is not a selector
  s.write(page, good.replace("this.table = page.getByRole('table', { name: 'Contacts' });", "this.table = page.getByRole('main').locator(page.getByRole('table', { name: 'Contacts' }));"));
  assert.equal((await pages()).code, 0);
});

test("the locator smoke: readonly-safe navigation to each template, dialogs through recorded safe clicks, one assertion per locator the state shows", async () => {
  const s = await setup();
  await cases(s, ["list", "create", "detail"]);
  await s.uc("build", "acme", "contacts");
  let smoke = s.read(SMOKE);
  assert.match(smoke, /test\.skip\(true, 'no locator of ContactsPage is shown in ST-contacts-1\\'s snapshot'\);|test\.skip\(true, "no locator of ContactsPage is shown in ST-contacts-1's snapshot"\);/, "shells have no locators yet");
  writePages(s);
  const r = await s.uc("build", "acme", "contacts");
  assert.ok(r.out.written.includes("tests/ui/contacts/_locators.smoke.spec.ts"), "the smoke follows the page objects");
  smoke = s.read(SMOKE);
  assert.match(smoke, /^\/\/ Generated by scripts\/ui-code\.mjs — do not edit\./);
  assert.match(smoke, /test\('PG-contacts-1 ContactsPage locators resolve @locators-smoke', async \(\{ page, contactsPage \}\) => \{\n    await page\.goto\('\/contacts'\);\n    await waitForReady\(page\);\n    await expect\(contactsPage\.newContact, 'contactsPage\.newContact'\)\.not\.toHaveCount\(0\);/);
  assert.ok(smoke.includes([
    "    const click1 = page.getByRole('button', { name: 'New contact', exact: true });",
    "    await expect(click1, 'the recorded button \"New contact\"').toHaveCount(1);",
    "    await click1.click();",
    "    await expect(contactsNewContactDialog.root",
  ].join("\n")), "the exact recorded element, found exactly once, then clicked");
  assert.ok(!smoke.includes(".first()"));
  assert.ok(smoke.includes([
    "  test.beforeEach(async ({ page }) => {",
    "    sent = [];",
    "    await page.route('**/*', (route) => {",
    "      const request = route.request();",
    "      if (request.method().toUpperCase() === 'GET') return route.fallback();",
  ].join("\n")), "its own abort of every non-GET, whatever the run's mode");
  assert.ok(smoke.includes("      return route.abort('blockedbyclient');"));
  assert.ok(smoke.includes("    expect(sent, 'the locator smoke sent a request other than GET').toEqual([]);"), "and an attempt fails the test");
  assert.match(smoke, /await page\.goto\('\/contacts\/101'\);/);
  assert.doesNotMatch(smoke, /https?:\/\//, "paths only: the base URL comes from the environment");
  assert.doesNotMatch(smoke, /\.row\b|openNewContact|\.fill\(|\.type\(/, "only locator properties; never an action that types or a data-driven locator");
  assert.doesNotMatch(smoke, /@mutates/);
});

test("the locator smoke skips a dialog whose recorded path is not readonly-safe, with the reason", async () => {
  const s = await setup({ dialogVia: 'button "Delete selected"' });
  await cases(s, ["create"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts", "pages/contacts/components/new-contact.component.ts"]);
  await s.uc("build", "acme", "contacts");
  const smoke = s.read(SMOKE);
  assert.match(smoke, /test\('PG-contacts-1 dialog "New contact" locators resolve @locators-smoke', async \(\) => \{\n    test\.skip\(true, 'the recorded path to ST-contacts-2 clicks button "Delete selected", which may change data'\);/);
  assert.equal(s.json(`${UC}/plan.json`).objects[1].smoke.skip, 'the recorded path to ST-contacts-2 clicks button "Delete selected", which may change data');
});

test("check: every rule of the cases spec, page objects and generated files", async () => {
  const s = await setup();
  const id = await cases(s, ["list", "create", "detail"]);
  await s.uc("build", "acme", "contacts");
  writePages(s);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  let r = await s.uc("check", "acme", "contacts");
  assert.equal(r.code, 0, JSON.stringify(r.out.problems));
  assert.equal(r.out.stamped, true);
  const filled = s.read(SPEC);
  const [create, detail, list] = ["create", "detail", "list"].map((k) => id.get(k));
  const expectRule = async (what, rule, re = /./) => {
    r = await s.uc("check", "acme", "contacts");
    assert.equal(r.code, 1, what);
    assert.ok(r.out.problems.some((p) => p.includes(`[${rule}]`) && re.test(p)), `${what}: ${JSON.stringify(r.out.problems)}`);
  };
  const edit = (f, from, to) => s.write(f, s.read(f).replace(from, to));
  const reset = () => {
    s.write(SPEC, filled);
    writePages(s);
  };

  // the skeleton: a missing test, a changed title or tags, an edit outside the regions, an extra test in a region
  edit(SPEC, /  \/\/ TC-contacts-3[\s\S]*?\n  \}\);\n/, "");
  await expectRule("a missing test", "skeleton", new RegExp(`${list}: its test is missing, or its title or tags were changed`));
  reset();
  edit(SPEC, "@p1 @functional @mutates", "@p1 @functional");
  await expectRule("a dropped tag", "skeleton", new RegExp(`${create}: its test is missing, or its title or tags were changed`));
  await expectRule("a dropped @mutates is also the gate's blocker", "mutates-tag");
  reset();
  edit(SPEC, "A new contact is saved from the dialog", "A new contact is saved");
  await expectRule("a changed title", "skeleton", new RegExp(create));
  reset();
  edit(SPEC, "await test.step('1. Open Contacts', async () => {", "await test.step('1. Open the contacts', async () => {");
  await expectRule("generated code edited outside the regions", "skeleton", /generated code outside the marked regions was changed \(line \d+/);
  reset();
  edit(SPEC, "import { recordCreated } from '../../../utils/shared/ledger';", "import { recordCreated } from '../../../utils/shared/ledger';\ntest('TC-contacts-1 a second copy', async () => {});");
  await expectRule("an extra test in a region", "extra-test", /region 'setup' declares test\(…\)/);
  reset();
  edit(SPEC, "import { recordCreated } from '../../../utils/shared/ledger';", "import { recordCreated } from '../../../utils/shared/ledger';\ntest.describe('more', () => {});");
  await expectRule("an extra describe in a region", "extra-test", /test\.describe/);
  reset();

  // the step bodies: empty, no assertion in the expected-result step, @visual, @mutates
  const body = (key) => new RegExp(`(// ui-code:begin ${key}\\n)[\\s\\S]*?(\\n\\s*// ui-code:end ${key})`);
  edit(SPEC, body(`${list} step 1`), "$1      // TODO$2");
  await expectRule("an empty step (a comment is not a body)", "empty-step", new RegExp(`${list}: step 1 \\(Open Contacts\\) has an empty body`));
  reset();
  edit(SPEC, body(`${list} then`), "$1      await contactsPage.table.click();$2");
  await expectRule("no assertion in the expected-result step", "no-assertion", new RegExp(list));
  reset();
  edit(SPEC, body(`${detail} then`), "$1      await expect(contactsPage.table).toBeVisible();$2");
  await expectRule("a @visual case without toHaveScreenshot", "visual", new RegExp(`${detail} is @visual but never calls toHaveScreenshot`));
  reset();
  edit(SPEC, "      recordCreated({ type: 'contact', ref: 'c-1', module: 'contacts' });\n", "");
  await expectRule("a @mutates test without recordCreated", "ledger", new RegExp(`${create} is @mutates but its steps never call recordCreated`));
  reset();
  edit(SPEC, "      recordCreated({ type: 'contact', ref: 'c-1', module: 'contacts' });\n", "      recordCreated({ type: 'contact', ref: 'c-1', module: 'contacts' });\n      recordDeleted({ type: 'contact', ref: 'c-1', module: 'contacts' });\n");
  await expectRule("recordDeleted without owns()", "ledger", new RegExp(`${create} calls recordDeleted but never checks owns`));
  reset();
  // a case the writer can't automate yet is parked with a reason; its other steps may stay empty
  edit(SPEC, body(`${list} step 1`), "$1      test.fixme(true, 'needs the page-object method ContactsPage.sortBy');$2");
  edit(SPEC, body(`${list} then`), "$1$2");
  r = await s.uc("check", "acme", "contacts");
  assert.equal(r.code, 0, JSON.stringify(r.out.problems));
  reset();

  // waits and assertions: the gate's own rules, in specs and page objects
  edit(SPEC, body(`${list} step 1`), "$1      await page.waitForTimeout(500);$2");
  await expectRule("waitForTimeout", "no-fixed-wait");
  reset();
  edit(`${PW}/pages/contacts/contacts.page.ts`, "await this.newContact.click();", "await this.newContact.click();\n    await expect(this.table).toBeVisible();");
  await expectRule("an assertion in a page object", "no-assertions-in-objects");
  reset();

  // page objects and generated files
  rmSync(path.join(s.root, PW, "pages/contacts/contacts-id.page.ts"));
  await expectRule("a missing page object", "page-object", /pages\/contacts\/contacts-id\.page\.ts is missing: the page object for PG-contacts-2/);
  reset();
  edit(`${PW}/pages/contacts/contacts-id.page.ts`, "export class ContactsIdPage", "export class ContactPage");
  await expectRule("a renamed class", "page-object", /does not export class ContactsIdPage/);
  reset();
  // fixtures/ui/index.ts is generated from the registrations (D-056): the pom-writer's old hand registration is drift
  assert.match(s.read(INDEX), /^\/\/ Generated by scripts\/foundation\.mjs — do not edit\.[\s\S]*import \{ contactsPages, type ContactsPages \} from '\.\/pages\/contacts';[\s\S]*export const test = base\.extend<ContactsPages>\(\{ \.\.\.contactsPages \}\);/);
  s.write(INDEX, INDEX_TS);
  await expectRule("a hand-written index.ts", "fixture-registration", /fixtures\/ui\/index\.ts differs from its render: it is generated from the module registrations/);
  reset();
  edit(SMOKE, "not.toHaveCount(0)", "toBeVisible()");
  await expectRule("the smoke edited", "generated", /the locator smoke is out of date or was edited/);
  await s.uc("build", "acme", "contacts");
  edit(REG, "await use(new ContactsPage(page));", "await use(new ContactsPage(page)); // tweaked");
  await expectRule("the registration edited", "generated", /the fixture registration is out of date or was edited/);
  await s.uc("build", "acme", "contacts");
  s.write(`${PW}/tests/ui/contacts/more.spec.ts`, "import { test } from '../../../fixtures/ui';\n");
  await expectRule("another spec file", "extra-file", /the module's tests live in tests\/ui\/contacts\/cases\.spec\.ts/);
  rmSync(path.join(s.root, PW, "tests/ui/contacts/more.spec.ts"));
  assert.equal((await s.uc("check", "acme", "contacts")).code, 0, "back to clean");

  // a stale build: a later approval changes the inputs
  await cases(s, ["list", "create", "detail", "waiting"], ["list", "create", "detail", "waiting"]);
  r = await s.uc("check", "acme", "contacts");
  assert.match(r.out.problems[0], /^stale: testcases, approvals changed after the last build/);
});

test("the verified stamps: a full check covers pages and tests, --static stamps nothing, the domain flow refuses a stale one", async () => {
  const s = await setup();
  await cases(s, ["list", "create"]);
  await s.uc("build", "acme", "contacts");
  const ctx = s.ctx();
  assert.match(uiCodeUnverified(ctx, "pages"), /the page objects never passed ui-code\.mjs check acme contacts --pages/);
  writePages(s, ["pages/contacts/contacts.page.ts", "pages/contacts/components/new-contact.component.ts"]);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  const st = await s.uc("check", "acme", "contacts", "--static");
  assert.deepEqual([st.code, st.out.stamped], [0, false]);
  assert.match(st.out.note, /--static/);
  assert.ok(uiCodeUnverified(ctx, "tests"));
  // the compile commands' failures fail the check
  const tscFails = await main(["check", "acme", "contacts"], { root: s.root, exec: () => "error TS2304: Cannot find name 'contactsPage'", listTests });
  assert.ok(tscFails.out.problems.some((p) => /\[typecheck\] npx tsc --noEmit failed: error TS2304/.test(p)));
  const listFails = await main(["check", "acme", "contacts"], { root: s.root, exec, listTests: () => ({ error: "SyntaxError in cases.spec.ts" }) });
  assert.ok(listFails.out.problems.some((p) => /\[list\] playwright --list failed: SyntaxError/.test(p)));
  assert.equal((await s.uc("check", "acme", "contacts")).code, 0);
  assert.equal(uiCodeUnverified(ctx, "pages"), null);
  assert.equal(uiCodeUnverified(ctx, "tests"), null);
  // the flow's steps verify through the stamps
  const flow = FLOWS["playwright-ui"].build;
  const c = { root: s.root, product: "acme", module: "contacts", run: { runId: "acme-run-1" }, cfg: ctx.cfg, productDir: ctx.productDir, pwProject: ctx.pwProject };
  assert.equal(flow.find((b) => b.step === "pages").verify(c), null);
  assert.equal(flow.find((b) => b.step === "tests").verify(c), null);
  s.write(`${PW}/pages/contacts/contacts.page.ts`, `${PAGES["pages/contacts/contacts.page.ts"]}// edited\n`);
  assert.match(flow.find((b) => b.step === "pages").verify(c), /the page objects changed after ui-code\.mjs check acme contacts --pages/);
  assert.match(flow.find((b) => b.step === "tests").verify(c), /the tests changed after/);
});

test("the gate runs the UI code rules once scaffolded, and the smoke traces to templates, not cases", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  let g = gate("acme", "contacts", "playwright-ui", { root: s.root, compile: false });
  assert.equal(g.verdict, "pass", s.read(g.file));
  s.write(`${PW}/pages/contacts/contacts.page.ts`, PAGES["pages/contacts/contacts.page.ts"].replace("'New contact'", "'Add contact'"));
  g = gate("acme", "contacts", "playwright-ui", { root: s.root, compile: false });
  assert.equal(g.verdict, "changes-required");
  assert.match(s.read(g.file), /\| major \| pages\/contacts\/contacts\.page\.ts \| \d+ \| locator-grounding \|/);
  assert.doesNotMatch(s.read(g.file), /_locators\.smoke\.spec\.ts \| \d* \| traceability/, "the smoke's PG titles carry no case id, by design");
  assert.ok(id.get("list"));
});

test("noUiCases: a module whose approved cases are all @api has nothing for the UI side", async () => {
  const s = await setup();
  await cases(s, ["list", "api"], ["api"]);
  assert.match(noUiCases(s.ctx()), /every approved test case is @api/);
  await cases(s, ["list", "api"], ["list", "api"]);
  assert.equal(noUiCases(s.ctx()), false);
});

test("the scanner and parsers: comments, strings, templates and regexes never hide or fake a locator", () => {
  const src = [
    "// page.getByRole('button', { name: 'In a comment' })",
    "const s = \"page.getByText('in a string')\";",
    "const t = `${a}`;",
    "const r = /getByRole\\('x'/;",
    "this.ok = page.getByRole('button', { name: 'It\\'s here', exact: true });",
    "this.chained = this.root.getByLabel(\"Name *\");",
    "/* page.locator('css') */",
    "row(name: string) { return this.page.getByRole('row', { name }); }",
    "this.built = page.getByText(`Hello ${who}`);",
  ].join("\n");
  const p = parseLocators(src);
  assert.deepEqual(p.calls.map((c) => [c.method, c.line, c.name.kind, c.name.value]), [
    ["getByRole", 5, "literal", "It's here"],
    ["getByLabel", 6, "literal", "Name *"],
    ["getByRole", 8, "param", "name"],
    ["getByText", 9, "expr", "`Hello ${who}`"],
  ]);
  assert.deepEqual(p.props.map((x) => x.name), ["ok", "chained", "built"]);
  assert.deepEqual(scanTs("a / b / c").map((t) => t.type), ["ident", "punct", "ident", "punct", "ident"], "division is not a regex");
  const facts = snapshotFacts(readFileSync(path.join(FIX, "contacts-list-dialog.md"), "utf8"));
  assert.equal(locatorProblem({ method: "getByRole", role: "textbox", name: { kind: "literal", value: "Name *" } }, [facts]), null);
  assert.equal(locatorProblem({ method: "getByPlaceholder", name: { kind: "literal", value: "name@example.com" } }, [facts]), null);
  assert.match(locatorProblem({ method: "getByRole", role: "textbox", name: { kind: "literal", value: "Name" } }, [facts]), /in none/, "verbatim: 'Name' is not 'Name *'");
  assert.equal(lit("A contact's page"), `"A contact's page"`);
  assert.equal(lit(`a 'quoted' "word"`), `'a \\'quoted\\' "word"'`);
});

test("CLI: usage and paths", async () => {
  const s = await setup();
  await cases(s, ["list"]);
  assert.equal((await s.uc("build", "acme")).code, 2);
  assert.equal((await s.uc("check", "acme", "contacts", "--fast")).code, 2);
  assert.equal((await s.uc("build", "acme", "contacts", "--pages")).code, 2);
  assert.equal((await s.uc("check", "acme", "contacts")).code, 1, "nothing built yet");
  await s.uc("build", "acme", "contacts");
  const p = (await s.uc("paths", "acme", "contacts")).out;
  assert.equal(p.spec, `${PW}/tests/ui/contacts/cases.spec.ts`);
  assert.equal(p.smoke, `${PW}/tests/ui/contacts/_locators.smoke.spec.ts`);
  assert.equal(p.registration, `${PW}/fixtures/ui/pages/contacts.ts`);
  assert.equal(p.data, `${PW}/helpers/ui/contacts.data.ts`);
  assert.deepEqual(p.objects.map((o) => o.file), [`${PW}/pages/contacts/contacts.page.ts`]);
  assert.equal(p.objects[0].snapshots[0], `artifacts/acme/modules/contacts/explore/pages/contacts/states/${s.ids.list}.md`);
});

// ---------- the guard: what the two writers may run and write (config/permissions.yaml) ----------

const call = (agent, tool_name, tool_input) => normalize({ agent_type: agent, tool_name, tool_input }, { env: { CLAUDE_PROJECT_DIR: "/repo" }, host: "claude-code" });
const FULL = startRun({ mode: "full-run" });
const allowed = (input) => checkTool(input, FULL.root, {}, { framework: FULL.root }).allowed;
const sh = (agent, command) => allowed(call(agent, "Bash", { command }));
const w = (agent, rel) => allowed(call(agent, "Write", { file_path: path.join(FULL.root, rel) }));

test("guard: the UI writers run only ui-code.mjs build, check and paths", () => {
  for (const agent of ["pw-ui-pom-writer", "pw-ui-tests-writer"]) {
    for (const cmd of ["node scripts/ui-code.mjs build acme contacts", "node scripts/ui-code.mjs check acme contacts --pages", "node scripts/ui-code.mjs check acme contacts", "node scripts/ui-code.mjs paths acme contacts"])
      assert.equal(sh(agent, cmd), true, `${agent}: ${cmd}`);
    for (const cmd of ["npx tsc --noEmit", "npx playwright test --project=ui tests/ui/contacts --list", "node scripts/ui-code.mjs build acme contacts && rm -rf playwright-tests", "node -e \"require('fs').writeFileSync('x','y')\"", "node scripts/foundation.mjs render acme --side ui", "node scripts/testcases.mjs approve acme contacts", "npx playwright test"])
      assert.equal(sh(agent, cmd), false, `${agent}: ${cmd}`);
  }
});

test("guard: pw-ui-pom-writer writes only its module's page objects; fixtures/ui/index.ts and the registration are generated (D-056)", () => {
  const a = "pw-ui-pom-writer";
  assert.equal(w(a, `${PW}/pages/contacts/contacts.page.ts`), true);
  assert.equal(w(a, `${PW}/pages/contacts/components/new-contact.component.ts`), true);
  for (const f of [INDEX, REG, `${PW}/fixtures/ui/base.ts`, SPEC, SMOKE, `${PW}/helpers/ui/contacts.data.ts`, `${PW}/pages/contacts.page.ts`, "artifacts/acme/modules/contacts/ui-code/plan.json", "playwright-tests/other/pages/contacts/x.page.ts"])
    assert.equal(w(a, f), false, f);
});

test("guard: pw-ui-tests-writer writes only the cases spec and its module's data builders, never the generated smoke", () => {
  const a = "pw-ui-tests-writer";
  assert.equal(w(a, SPEC), true);
  assert.equal(w(a, `${PW}/helpers/ui/contacts.data.ts`), true);
  for (const f of [SMOKE, `${PW}/tests/ui/contacts/other.spec.ts`, `${PW}/tests/ui/contacts/helpers.ts`, REG, INDEX, `${PW}/pages/contacts/contacts.page.ts`, `${PW}/helpers/ui/dates.ts`, `${PW}/fixtures/ui/base.ts`, "artifacts/acme/modules/contacts/ui-code/coverage.json", "artifacts/acme/modules/contacts/ui-code/parked.json"])
    assert.equal(w(a, f), false, f);
});

// ---------- fix round 1: the validator's defects ----------

// Whether one page-object snippet gets a finding, judged as check judges it (a selector needs a reason).
const flagged = (src, facts) => parseLocators(src).calls.some((c) => locatorProblem(c, facts) || (c.selector !== undefined && !c.reason && !c.problem) || !!c.problem);
const LIST = () => [snapshotFacts(readFileSync(path.join(FIX, "contacts-list.md"), "utf8"))];

test("static check: every way around a verbatim literal is a finding; literals, Locator chaining and a method's own string parameter are not", () => {
  const facts = LIST();
  const bypasses = {
    "a selector in a variable": "const sel = '#evil';\nthis.a = page.locator(sel);",
    "String(...) as a selector": "this.a = page.locator(String('#evil'));",
    "a template selector": "this.a = page.locator(`#${id}`);",
    "options in a variable": "const o = { name: 'Delete all' };\nthis.a = page.getByRole('button', o);",
    "options spread": "this.a = page.getByRole('button', { ...{ name: 'Delete all' } });",
    "frameLocator": "this.a = page.frameLocator('#frame').getByRole('button', { name: 'New contact' });",
    "bracket access": "this.a = page['getByText']('Fake');",
    "page.$": "this.a = page.$('#x');",
    "page.$$": "this.a = page.$$('#x');",
    "evaluate": "async f() { await this.page.evaluate(() => 1); }",
    "waitForSelector": "async f() { await this.page.waitForSelector('#x'); }",
    "mainFrame().locator": "this.a = page.mainFrame().locator('#x');",
    "a template name": "this.a = page.getByText(`Con${'tacts'}`);",
    "a concatenated name": "this.a = page.getByText('Fake' + 'Name');",
    "a constant name": "const n = 'Fake name';\nthis.a = page.getByText(n);",
    "a name typed string elsewhere in the file": "constructor(page: Page) {\n  const n = 'Fake name';\n  this.a = page.getByText(n);\n}\nfoo(n: string) {}",
    "a parameter that is not a string": "row(name: number) { return this.page.getByRole('row', { name }); }",
    "an anonymous function's parameter": "const pick = (name: string) => page.getByText(name);",
    "a filter text not shown": "this.a = page.getByRole('row').filter({ hasText: 'Fake text' });",
  };
  for (const [what, src] of Object.entries(bypasses)) assert.ok(flagged(src, facts), what);
  const fine = {
    "a role and name verbatim": "this.a = page.getByRole('button', { name: 'New contact' });",
    "a whole text": "this.a = page.getByText('Showing 1-3 of 245');",
    "chaining a locator property": "this.b = page.getByRole('main');\nthis.a = page.locator(this.b);",
    "chaining a getBy*": "this.a = page.getByRole('main').locator(page.getByRole('table', { name: 'Contacts' }));",
    "a method's own string parameter": "row(name: string) { return this.page.getByRole('row', { name }); }",
    "a filter text shown whole": "this.a = page.getByRole('row').filter({ hasText: 'Jane Doe' });",
  };
  for (const [what, src] of Object.entries(fine)) assert.ok(!flagged(src, facts), what);
  const param = parseLocators("row(name: string) { return this.page.getByRole('row', { name }); }").calls[0].name;
  assert.deepEqual([param.kind, param.fn, param.index], ["param", "row", 0], "scoped to the method that declares it");
});

test("static check: names match verbatim and whole -- no substring, a test id only as a recorded attribute", () => {
  const facts = LIST();
  for (const src of ["this.a = page.getByText('e');", "this.a = page.getByText('Showing');", "this.a = page.getByTestId('a');", "this.a = page.getByTestId('totally-fake-id');", "this.a = page.getByRole('button', { name: 'New', exact: false });", "this.a = page.getByPlaceholder('Fake');"])
    assert.ok(flagged(src, facts), src);
  const withId = [snapshotFacts("- table \"Contacts\" [data-testid=contacts-table]\n- textbox \"Email\":\n  - /placeholder: name@example.com\n")];
  assert.ok(!flagged("this.a = page.getByTestId('contacts-table');", withId));
  assert.ok(flagged("this.a = page.getByTestId('contacts');", withId), "a part of a test id is not the test id");
  assert.ok(!flagged("this.a = page.getByPlaceholder('name@example.com');", withId));
  assert.ok(flagged("this.a = page.getByPlaceholder('name@');", withId));
});

test("a data-driven locator: every call site passes a literal, each literal is grounded, and the smoke checks it", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  const page = `${PW}/pages/contacts/contacts.page.ts`;
  s.write(page, PAGES["pages/contacts/contacts.page.ts"].replace("return this.page.getByRole('row', { name, exact: true });", "return this.page.getByRole('link', { name, exact: true });"));
  await s.uc("build", "acme", "contacts");
  const call = (arg) => fillSteps(s, (key) => (key.endsWith("step 1") ? [`      await contactsPage.row(${arg}).click();`] : null));
  call("'Jane Doe'");
  let r = await s.uc("build", "acme", "contacts");
  assert.ok(!s.read(SMOKE).includes("row("), "a data-driven locator exists only at run time: it is left out of the smoke");
  r = await s.uc("check", "acme", "contacts");
  assert.equal(r.code, 0, JSON.stringify(r.out.problems));
  call("'Nobody Here'");
  await s.uc("build", "acme", "contacts");
  r = await s.uc("check", "acme", "contacts");
  assert.ok(r.out.problems.some((p) => p.startsWith("tests/ui/contacts/cases.spec.ts:") && p.includes("[locator-grounding]") && /'Nobody Here' is in none .*through row\(…\)/.test(p)), JSON.stringify(r.out.problems));
  call("contactName");
  await s.uc("build", "acme", "contacts");
  r = await s.uc("check", "acme", "contacts");
  assert.ok(r.out.problems.some((p) => p.includes("[locator-param]") && /row\(…\) builds a locator from its argument 1, but this call passes contactName/.test(p)), JSON.stringify(r.out.problems));
  assert.ok(id.get("list"));
});

// Replaces the given regions of the cases spec (key -> lines), keeping the others.
function setRegions(s, map) {
  const { regions } = parseRegions(s.read(SPEC));
  for (const [k, v] of Object.entries(map)) regions.set(k, v);
  s.write(SPEC, renderSpec(s.ctx(), s.json(`${UC}/plan.json`), regions));
}

test("runtime data: a data-driven locator refines a grounded role by a builder's value; anything looser is a finding", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  const list = id.get("list");
  await s.uc("build", "acme", "contacts");
  const page = `${PW}/pages/contacts/contacts.page.ts`;
  const good = PAGES["pages/contacts/contacts.page.ts"].replace("return this.page.getByRole('row', { name, exact: true });", "return this.page.getByRole('link', { name, exact: true });")
    .replace("  async openNewContact(): Promise<void> {", "  async openContact(name: string): Promise<void> {\n    await this.row(name).click();\n  }\n\n  async openNewContact(): Promise<void> {");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  s.write(page, good);
  s.write(`${PW}/helpers/ui/contacts.data.ts`, "import { uniqueName } from '../../utils/shared/data';\n\nexport const buildContact = () => ({ name: uniqueName('contact'), email: 'ada@example.test' });\n");
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  const setupLines = ["import { recordCreated } from '../../../utils/shared/ledger';", "import { buildContact } from '../../../helpers/ui/contacts.data';"];
  const run = async (step, data = [], then = null) => {
    setRegions(s, { setup: setupLines, [`${list} data`]: data, [`${list} step 1`]: step, ...(then ? { [`${list} then`]: then } : {}) });
    await s.uc("build", "acme", "contacts");
    return (await s.uc("check", "acme", "contacts")).out.problems;
  };
  const DATA_LINE = ["    const contact = buildContact();"];
  // a value from the test's data region, directly, through a step-local const, or through a page-object wrapper,
  // in any step: allowed
  assert.deepEqual(await run(["      await contactsPage.row(contact.name).click();"], DATA_LINE), []);
  assert.deepEqual(await run(["      const name = contact.name;", "      await contactsPage.openContact(name);"], DATA_LINE, ["      await expect(contactsPage.row(contact.name)).toBeVisible();"]), [], "the Then step sees the test's data too");
  // a builder called in a step (or in setup) is not the test's data
  assert.ok((await run(["      const contact = buildContact();", "      await contactsPage.row(contact.name).click();"])).some((p) => p.includes("[locator-param]") && /data region/.test(p)));
  setupLines.push("const shared = buildContact();");
  assert.ok((await run(["      await contactsPage.row(shared.name).click();"])).some((p) => p.includes("[locator-param]")), "a module-level builder value is shared by every test and retry");
  setupLines.pop();
  await run(["      await contactsPage.row(contact.name).click();"], DATA_LINE, ["      await expect(contactsPage.table).toBeVisible();"]);
  assert.deepEqual(await run(["      await contactsPage.openContact('Jane Doe');"]), [], "a grounded literal, through the wrapper");
  assert.ok(!s.read(SMOKE).includes("row("), "left out of the smoke");
  // a value from anywhere else, or an ungrounded literal through the wrapper: findings
  assert.ok((await run(["      await contactsPage.row(String(Date.now())).click();"])).some((p) => p.includes("[locator-param]")));
  assert.ok((await run(["      const name = 'Nobody' + ' Here';", "      await contactsPage.row(name).click();"])).some((p) => p.includes("[locator-param]")));
  assert.ok((await run(["      await contactsPage.openContact('Nobody Here');"])).some((p) => p.includes("[locator-grounding]") && /'Nobody Here'.*through openContact/.test(p)));
  // the method's shape: exact getByRole or filter({ hasText }) only, non-async, only returning the locator
  await run(["      await contactsPage.openContact('Jane Doe');"]);
  for (const [what, src] of [
    ["no exact", "return this.page.getByRole('link', { name });"],
    ["getByText of the value", "return this.page.getByText(name);"],
    ["more than a return", "const x = 1;\n    return this.page.getByRole('link', { name, exact: true });"],
  ]) {
    s.write(page, good.replace("return this.page.getByRole('link', { name, exact: true });", src));
    await s.uc("build", "acme", "contacts");
    assert.ok((await s.uc("check", "acme", "contacts")).out.problems.some((p) => p.includes("[locator-param]")), what);
  }
  s.write(page, good.replace("return this.page.getByRole('link', { name, exact: true });", "return this.table.filter({ hasText: name });"));
  await s.uc("build", "acme", "contacts");
  assert.deepEqual((await s.uc("check", "acme", "contacts")).out.problems, [], "filter({ hasText: v }) on a grounded container");
});

test("the data builders hold data only; a helper the code imports is checked like a page object", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  const DATA = `${PW}/helpers/ui/contacts.data.ts`;
  for (const [what, text] of [
    ["a Playwright import", "import type { Page } from '@playwright/test';\nexport const sneaky = (page: Page) => page.locator('#evil');\n"],
    ["a page-object call", "export const pick = (po: any) => po.row(String(Date.now()));\n"],
    ["a selector API call", "export const zap = (p: any) => p.click('#evil');\n"],
    ["a page-object import", "import { ContactsPage } from '../../pages/contacts/contacts.page';\nexport const x = ContactsPage;\n"],
  ]) {
    s.write(DATA, text);
    const r = await s.uc("check", "acme", "contacts");
    assert.ok(r.out.problems.some((p) => p.startsWith("helpers/ui/contacts.data.ts") && p.includes("[data-file]")), `${what}: ${JSON.stringify(r.out.problems)}`);
  }
  s.write(DATA, "export const buildContact = () => ({ name: 'Ada Example', page: 1 });\n");
  assert.deepEqual((await s.uc("check", "acme", "contacts")).out.problems, [], "data, even a key named page");
  // another helpers/ui file the spec imports is held to the page-object rules
  s.write(`${PW}/helpers/ui/contacts.flows.ts`, "import type { Page } from '@playwright/test';\nexport const sneaky = (page: Page) => page.locator('#evil');\n");
  setRegions(s, { setup: ["import { recordCreated } from '../../../utils/shared/ledger';", "import { sneaky } from '../../../helpers/ui/contacts.flows';"] });
  const r = await s.uc("check", "acme", "contacts");
  assert.ok(r.out.problems.some((p) => p.startsWith("helpers/ui/contacts.flows.ts") && p.includes("[locator-policy]")), JSON.stringify(r.out.problems));
  assert.ok(id.get("list"));
});

test("steps call page objects plainly and never use Playwright's selector API on the page", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  const list = id.get("list");
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  const problems = async (lines) => {
    setRegions(s, { [`${list} step 1`]: lines });
    return (await s.uc("check", "acme", "contacts")).out.problems;
  };
  for (const [what, lines, rule] of [
    ["computed access", ["      await contactsPage['row']('Jane Doe').click();"], "po-access"],
    [".call", ["      await contactsPage.row.call(contactsPage, 'Jane Doe').click();"], "po-access"],
    [".bind", ["      const r = contactsPage.row.bind(contactsPage);", "      await r('Jane Doe').click();"], "po-access"],
    ["a method reference", ["      const r = contactsPage.row;", "      await r('Jane Doe').click();"], "po-access"],
    ["the page object passed on", ["      const po = contactsPage;", "      await po.row('Jane Doe').click();"], "po-access"],
    ["page.click", ["      await page.click('#evil');"], "raw-locator"],
    ["page.fill and textContent", ["      await page.fill('#evil', 'x');", "      await page.textContent('#x');"], "raw-locator"],
    ["page.mainFrame().click", ["      await page.mainFrame().click('#x');"], "raw-locator"],
    ["page passed on", ["      const p = page;", "      await p.click('#x');"], "raw-locator"],
  ]) assert.ok((await problems(lines)).some((p) => p.includes(`[${rule}]`)), `${what}`);
  assert.deepEqual(await problems(["      await page.goto('/contacts');", "      await contactsPage.row('Jane Doe jane@private.test 2026-10-01').click();", "      await contactsPage.search.fill('Jane');"]), [], "navigation, a page-object call and a locator action are fine");
  // in a page object, the legacy selector API needs a literal selector and a cited reason, like locator()
  s.write(`${PW}/pages/contacts/contacts.page.ts`, PAGES["pages/contacts/contacts.page.ts"].replace("async openNewContact(): Promise<void> {", "async zap(): Promise<void> {\n    await this.page.click('#evil');\n  }\n\n  async openNewContact(): Promise<void> {"));
  await s.uc("build", "acme", "contacts");
  assert.ok((await s.uc("check", "acme", "contacts", "--pages")).out.problems.some((p) => /\[locator-policy\] a click\(\) selector \(#evil\) without a cited reason/.test(p)));
  // a string field is a selector, not a locator chain
  s.write(`${PW}/pages/contacts/contacts.page.ts`, PAGES["pages/contacts/contacts.page.ts"].replace("this.page = page;", "this.page = page;\n    this.sel = '#evil';\n    this.x = page.locator(this.sel);").replace("readonly page: Page;", "readonly page: Page;\n  readonly sel: string;\n  readonly x: Locator;"));
  await s.uc("build", "acme", "contacts");
  assert.ok((await s.uc("check", "acme", "contacts", "--pages")).out.problems.some((p) => p.includes("[locator-policy]") && /locator\(\)'s selector must be a string literal \(found this \. sel\)/.test(p)));
});

test("the expected-result step really asserts, on a page object", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  const list = id.get("list");
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  const then = async (lines) => {
    setRegions(s, { [`${list} then`]: lines });
    return (await s.uc("check", "acme", "contacts")).out.problems.filter((p) => p.includes("[no-assertion]"));
  };
  for (const [what, lines] of [
    ["a tautology", ["      expect(true).toBe(true);"]],
    ["expect.poll on a constant", ["      await expect.poll(async () => 1).toBe(1);"]],
    ["expect.soft only", ["      await expect.soft(contactsPage.table).toBeVisible();"]],
    ["after a return", ["      return;", "      await expect(contactsPage.table).toBeVisible();"]],
    ["inside a dead branch", ["      if (Date.now() < 0) {", "        await expect(contactsPage.table).toBeVisible();", "      }"]],
    ["on the page only, when page objects exist", ["      await expect(page).toHaveURL(/contacts/);"]],
    ["on the page object's page", ["      await expect(contactsPage.page).toHaveURL(/contacts/);"]],
    ["no matcher", ["      expect(contactsPage.table);"]],
  ]) assert.ok((await then(lines)).length, what);
  assert.deepEqual(await then(["      await expect(contactsPage.table).toBeVisible();"]), []);
  assert.deepEqual(await then(["      await expect(contactsPage.row('Jane Doe')).not.toHaveCount(0);"]), [], "a data-driven locator counts");
  assert.deepEqual(await then(["      const rows = await contactsPage.table.count();", "      expect(await contactsPage.table.count()).toBeGreaterThan(0);"]), [], "data read through a page object");
});

test("a parked case is reported, recorded as not covered, and only an unconditional first statement parks", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  const list = id.get("list");
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  setRegions(s, { [`${list} step 1`]: ["      if (Date.now() < 0) test.fixme(true, 'never fires');"], [`${list} then`]: [] });
  let r = await s.uc("check", "acme", "contacts");
  assert.ok(r.out.problems.some((p) => p.includes("[empty-step]")) && r.out.problems.some((p) => p.includes("[silent-skip]")), "a conditional fixme parks nothing");
  setRegions(s, { [`${list} step 1`]: ["      await contactsPage.openNewContact();", "      test.fixme(true, 'too late');"], [`${list} then`]: ["      await expect(contactsPage.table).toBeVisible();"] });
  assert.ok((await s.uc("check", "acme", "contacts")).out.problems.some((p) => p.includes("[silent-skip]")), "not the first statement");
  setRegions(s, { [`${list} step 1`]: ["      test.fixme(true, 'needs a sort control in the page object');"], [`${list} then`]: [";"] });
  r = await s.uc("check", "acme", "contacts");
  assert.deepEqual(r.out.problems, []);
  assert.deepEqual(r.out.parked, [{ id: list, reason: "needs a sort control in the page object" }]);
  assert.ok(r.out.minor.some((m) => m.includes("[parked] approved case parked:") && m.includes("needs a sort control")));
  const cov = s.json(`${UC}/coverage.json`);
  assert.deepEqual(cov.parked, [{ id: list, reason: "needs a sort control in the page object" }]);
  const item = cov.items.find((i) => i.id === list);
  assert.deepEqual([item.status, item.reason], ["excluded", "parked"], "not counted as covered");
  const g = gate("acme", "contacts", "playwright-ui", { root: s.root, compile: false });
  assert.match(s.read(g.file), /\| minor \| tests\/ui\/contacts\/cases\.spec\.ts \| \d+ \| parked \| approved case parked: /);
  // unparked again: mapped to its test
  setRegions(s, { [`${list} step 1`]: ["      await contactsPage.openNewContact();"], [`${list} then`]: ["      await expect(contactsPage.table).toBeVisible();"] });
  await s.uc("check", "acme", "contacts");
  assert.equal(s.json(`${UC}/coverage.json`).items.find((i) => i.id === list).status, "mapped");
  // testInfo: attach and read only
  for (const lines of [["test.beforeEach(async ({}, ti) => { const k = 'skip'; (ti as any)[k](); });"], ["test.beforeEach(async ({}, ti) => { ti.annotations.push({ type: 'skip' }); });"], ["test.beforeEach(async ({}, ti) => { ti.expectedStatus = 'skipped'; });"], ["test.beforeEach(async () => { test.info().annotations.push({ type: 'skip' }); });"]]) {
    setRegions(s, { setup: ["import { recordCreated } from '../../../utils/shared/ledger';", ...lines] });
    assert.ok((await s.uc("check", "acme", "contacts")).out.problems.some((p) => /\[(test-info|test-reference)\]/.test(p)), lines[0]);
  }
  setRegions(s, { setup: ["import { recordCreated } from '../../../utils/shared/ledger';", "test.afterEach(async ({}, testInfo) => { await testInfo.attach('note', { body: testInfo.title }); });"] });
  assert.deepEqual((await s.uc("check", "acme", "contacts")).out.problems, [], "attach and reading the title are fine");
});

test("steps go through the page objects: a raw locator in a region is a finding", async () => {
  const s = await setup();
  await cases(s, ["list"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  for (const raw of ["await page.getByRole('button', { name: 'New contact' }).click();", "await page.locator('#x').click();", "await page['getByText']('Contacts').click();", "await page.evaluate(() => 1);", "await page.frameLocator('#f').getByRole('button').click();"]) {
    fillSteps(s, (key) => (key.endsWith("step 1") ? [`      ${raw}`] : null));
    const r = await s.uc("check", "acme", "contacts");
    assert.ok(r.out.problems.some((p) => p.includes("[raw-locator]")), `${raw}: ${JSON.stringify(r.out.problems)}`);
  }
});

test("no silent skip and no alias of test in a region; the fixme exemption is a real call, not text in a string", async () => {
  const s = await setup();
  const id = await cases(s, ["list", "create"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts", "pages/contacts/components/new-contact.component.ts"]);
  await s.uc("build", "acme", "contacts");
  const [create, list] = [id.get("create"), id.get("list")];
  const base = ["import { recordCreated } from '../../../utils/shared/ledger';"];
  // the list test's first step and expected step, and the setup region; every other region filled normally
  const rulesOf = async (setupLines, step, then) => {
    fillSteps(s, (key) => (key === `${list} step 1` && step ? step : key === `${list} then` && then ? then : null));
    const { regions } = parseRegions(s.read(SPEC));
    regions.set("setup", setupLines ?? base);
    s.write(SPEC, renderSpec(s.ctx(), s.json(`${UC}/plan.json`), regions));
    return (await s.uc("check", "acme", "contacts")).out.problems;
  };
  for (const [what, setupLines, step, rule] of [
    ["test.skip() in a step", null, ["      test.skip();"], "silent-skip"],
    ["test.skip(true, reason) in a step", null, ["      test.skip(true, 'not today');"], "silent-skip"],
    ["a skip inside beforeEach", [...base, "test.beforeEach(async () => { test.skip(); });"], null, "silent-skip"],
    ["test.describe.skip", [...base, "test.describe.skip('x', () => {});"], null, "test-reference"],
    ["testInfo.skip", [...base, "test.afterEach(async ({}, testInfo) => { testInfo.skip(); });"], null, "silent-skip"],
    ["test.info().skip()", null, ["      test.info().skip();"], "test-reference"],
    ["test.fail() in a step", null, ["      await contactsPage.openNewContact();", "      test.fail();"], "silent-skip"],
    ["an alias of test", [...base, "const t = test;", `t('${create} sneaky copy', async () => {});`], null, "test-reference"],
  ]) {
    const problems = await rulesOf(setupLines, step);
    assert.ok(problems.some((p) => p.includes(`[${rule}]`)), `${what}: ${JSON.stringify(problems)}`);
  }
  // a fixme anywhere but a first step is a skip too
  assert.ok((await rulesOf(null, null, ["      test.fixme(true, 'later');"])).some((p) => p.includes("[silent-skip]")));
  // the exemption text inside a string does not park the test: its empty expected step is still a finding
  let problems = await rulesOf(null, ["      const note = \"test.fixme(true, 'not automatable')\";"], ["      // nothing"]);
  assert.ok(problems.some((p) => p.includes("[empty-step]") && p.includes(list)), JSON.stringify(problems));
  // the real call parks it
  problems = await rulesOf(null, ["      test.fixme(true, 'needs the sort control in the page object');"], ["      // nothing yet"]);
  assert.deepEqual(problems, []);
});

test("the gate in compile mode: an alias of test, an id listed twice or unknown, and listed tests that differ from the plan", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  const list = id.get("list");
  const withExtra = (titles) => (cwd, side, module) => {
    const r = listSpecTitles(cwd, side, module);
    const suite = r.report.suites.find((x) => x.file.endsWith("cases.spec.ts"));
    suite.specs.push(...titles.map((title, i) => ({ title, file: suite.file, line: 900 + i, tests: [{ expectedStatus: "passed", annotations: [] }] })));
    return r;
  };
  let r = await main(["check", "acme", "contacts"], { root: s.root, exec, listTests: withExtra([`${list} declared again through a helper`]) });
  assert.ok(r.out.problems.some((p) => /\[traceability\] Playwright lists TC-contacts-\d+ twice/.test(p)), JSON.stringify(r.out.problems));
  assert.ok(r.out.problems.some((p) => /\[skeleton\] Playwright lists ".*declared again through a helper", which is not a test of the plan/.test(p)));
  r = await main(["check", "acme", "contacts"], { root: s.root, exec, listTests: withExtra(["TC-contacts-77 from nowhere"]) });
  assert.ok(r.out.problems.some((p) => /TC-contacts-77 is not an automated test case of this module/.test(p)), JSON.stringify(r.out.problems));
  // an alias in a helper is flagged in compile mode too
  s.write(`${PW}/helpers/ui/contacts.flows.ts`, "import { test } from '../../fixtures/ui';\nconst t = test;\nexport const nothing = t;\n");
  r = await s.uc("check", "acme", "contacts");
  assert.ok(r.out.problems.some((p) => p.includes("[test-declaration]") && /an alias of test/.test(p)), JSON.stringify(r.out.problems));
});

test("the smoke never clicks a commit, a sign-out, a form control or a path that sent a write", async () => {
  for (const [role, name] of [["button", "OK"], ["button", "Continue"], ["button", "Next"], ["button", "Done"], ["button", "Add to cart"], ["menuitem", "Empty trash"], ["button", "Sign out"], ["link", "Delete"], ["link", "Log out"]])
    assert.ok(smokeClickProblem({ role, name }), `${role} "${name}"`);
  assert.match(smokeClickProblem({ role: "button", name: "Open filters", inForm: true }), /inside a form or dialog/);
  assert.match(smokeClickProblem({ role: "textbox", name: "Name" }), /needs textbox input/);
  assert.equal(smokeClickProblem({ role: "button", name: "New contact" }), null);
  assert.equal(smokeClickProblem({ role: "tab", name: "Mine" }), null);
  // the network inventory recorded a POST while the dialog's state was reached: the path is not replayed
  const s = await setup();
  await cases(s, ["create"]);
  s.write("artifacts/acme/modules/contacts/explore/network-inventory.json", JSON.stringify([{ id: "NI-contacts-1", method: "POST", pathTemplate: "/api/drafts", statusCodes: [201], states: [s.ids.dialog] }]));
  await s.uc("build", "acme", "contacts");
  assert.equal(s.json(`${UC}/plan.json`).objects[1].smoke.skip, `the recorded transition into ${s.ids.dialog} sent POST /api/drafts`);
});

test("CSS reason: the citation is a snapshot of the same template, not any module file", async () => {
  const s = await setup();
  await cases(s, ["list"]);
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  const page = `${PW}/pages/contacts/contacts.page.ts`;
  const css = (cite) => PAGES["pages/contacts/contacts.page.ts"].replace("this.table = page.getByRole('table', { name: 'Contacts' });", `// locator: css because the table has no accessible name [${cite}]\n    this.table = page.locator('table.contacts');`);
  const check = async () => (await s.uc("build", "acme", "contacts"), (await s.uc("check", "acme", "contacts", "--pages")).out.problems);
  for (const cite of ["observation:explore/model.json", `observation:explore/pages/contacts-id/states/${s.ids.detail}.md`]) {
    s.write(page, css(cite));
    assert.ok((await check()).some((p) => p.includes("[locator-policy]") && p.includes("not a state snapshot of this page object's template")), cite);
  }
  s.write(page, css(`observation:explore/pages/contacts/states/${s.ids.dialog}.md`));
  assert.deepEqual(await check(), []);
  s.write(page, css("observation:explore/pages/contacts/dom-snapshot.md"));
  assert.deepEqual(await check(), [], "the page's first-state snapshot counts");
});

test("the smoke exemption: only the exact path of a scaffolded module, only tests tagged @locators-smoke", async () => {
  const ok = [{ expectedStatus: "passed", annotations: [] }];
  const args = { idRe: /TC-contacts-\d+/g, unapproved: new Set(), what: "test case", dir: "tests/ui/contacts", exempt: ["tests/ui/contacts/_locators.smoke.spec.ts"], exemptTag: "@locators-smoke" };
  const f = listFindings([
    { titlePath: ["PG-contacts-1 ContactsPage locators resolve @locators-smoke"], file: "contacts/_locators.smoke.spec.ts", line: 1, tests: ok },
    { titlePath: ["anything goes"], file: "contacts/sub/_locators.smoke.spec.ts", line: 2, tests: ok },
    { titlePath: ["untagged"], file: "contacts/_locators.smoke.spec.ts", line: 3, tests: ok },
  ], args);
  assert.deepEqual(f.map((x) => [x.file, x.line]), [["tests/ui/contacts/sub/_locators.smoke.spec.ts", 2], ["tests/ui/contacts/_locators.smoke.spec.ts", 3]], "a nested copy is traced; an untagged test is flagged");
  // not scaffolded (no plan): the smoke file is traced like any spec
  const s = await setup();
  await cases(s, ["list"]);
  await s.uc("build", "acme", "contacts");
  rmSync(path.join(s.root, UC, "plan.json"));
  s.write(SMOKE, "import { test } from '../../../fixtures/ui';\ntest('no id here', async ({ page }) => { await page.goto('/'); });\n");
  const g = gate("acme", "contacts", "playwright-ui", { root: s.root, compile: false });
  assert.match(s.read(g.file), /_locators\.smoke\.spec\.ts \| \d+ \| traceability \| test "no id here" carries no test case id/);
});

test("pw-ui-fixer: re-renders and re-checks with ui-code.mjs, and edits only inside the regions", () => {
  assert.equal(sh("pw-ui-fixer", "node scripts/ui-code.mjs build acme contacts"), true);
  const perms = readFileSync(path.join(FULL.root, "config", "permissions.yaml"), "utf8");
  // the config names the framework's scripts as {fw}/scripts/... (D-085); the prompt is read as the build renders it here
  assert.match(perms, /pw-ui-fixer:[\s\S]*?shell_allow: \["node \{fw\}\/scripts\/ui-code\.mjs build \*", "node \{fw\}\/scripts\/ui-code\.mjs check \*"/);
  const prompt = expandFw(readFileSync(path.join(path.dirname(FIX), "..", "..", "agents", "pw-ui-fixer.md"), "utf8"), "");
  assert.match(prompt, /edit only inside the `\/\/ ui-code:begin` … `\/\/ ui-code:end` regions/);
  assert.match(prompt, /run `node scripts\/ui-code\.mjs build <p> <m>`[^\n]*then `node scripts\/ui-code\.mjs check <p> <m>`/);
});

test("the smoke's commit words cover the social toggles, and Open only when it is not a link to a page", () => {
  for (const name of ["Star", "Favorite", "Unfavorite", "Follow", "Unfollow", "Subscribe", "Unsubscribe", "Like", "Pin", "Mute", "Block", "Report", "Accept", "Decline", "Open"])
    assert.ok(smokeClickProblem({ role: "button", name }), name);
  assert.ok(smokeClickProblem({ role: "menuitem", name: "Open" }));
  assert.equal(smokeClickProblem({ role: "link", name: "Open", url: "https://app.acme.test/contacts/101" }), null, "a link to a page is a GET route");
});

test("duplicate and unknown ids need a known set: the UI cases, or the API scenarios once api-code.mjs generated the module (D-056); without one neither rule applies", () => {
  const ok = [{ expectedStatus: "passed", annotations: [] }];
  const tests = [
    { titlePath: ["API-contacts-3 create, then read back"], file: "contacts/contacts.spec.ts", line: 1, tests: ok },
    { titlePath: ["API-contacts-3 delete what was created (see API-contacts-2)"], file: "contacts/contacts.spec.ts", line: 2, tests: ok },
  ];
  const api = listFindings(tests, { idRe: /API-contacts-\d+/g, unapproved: new Set(), what: "plan scenario", dir: "tests/api/contacts" });
  assert.deepEqual(api, [], "no known set (an API module never generated): neither rule");
  const generated = listFindings(tests, { idRe: /API-contacts-d+/g, unapproved: new Set(), what: "plan scenario", dir: "tests/api/contacts", known: new Set(["API-contacts-3"]) });
  assert.deepEqual(generated.map((f) => f.rule), ["traceability", "traceability"], "generated API code: API-contacts-3 listed twice, API-contacts-2 not a scenario of the module");
  const ui = listFindings(tests.map((t) => ({ ...t, titlePath: [t.titlePath[0].replaceAll("API-", "TC-")] })), { idRe: /TC-contacts-\d+/g, unapproved: new Set(), what: "test case", dir: "tests/ui/contacts", known: new Set(["TC-contacts-3"]) });
  assert.deepEqual(ui.map((f) => f.rule), ["traceability", "traceability"], "UI: TC-contacts-3 listed twice, TC-contacts-2 not an automated case");
});

// ---------- round 3: the per-test data region, scoping, run-unique builders ----------

async function dataSetup() {
  const s = await setup();
  const id = await cases(s, ["list", "create"]);
  await s.uc("build", "acme", "contacts");
  const page = `${PW}/pages/contacts/contacts.page.ts`;
  writePages(s, ["pages/contacts/contacts.page.ts", "pages/contacts/components/new-contact.component.ts"]);
  s.write(page, PAGES["pages/contacts/contacts.page.ts"].replace("return this.page.getByRole('row', { name, exact: true });", "return this.page.getByRole('link', { name, exact: true });"));
  s.write(`${PW}/helpers/ui/contacts.data.ts`, "import { uniqueName } from '../../utils/shared/data';\n\nexport const buildContact = () => ({ name: uniqueName('contact'), email: 'ada@example.test' });\n");
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  const list = id.get("list");
  const setupLines = ["import { recordCreated } from '../../../utils/shared/ledger';", "import { buildContact } from '../../../helpers/ui/contacts.data';"];
  const run = async (map) => {
    setRegions(s, { setup: setupLines, ...Object.fromEntries(Object.entries(map).map(([k, v]) => [k.replace("DATA", `${list} data`).replace("S1", `${list} step 1`).replace("THEN", `${list} then`), v])) });
    await s.uc("build", "acme", "contacts");
    return (await s.uc("check", "acme", "contacts")).out.problems;
  };
  return { s, id, list, run, setupLines };
}

test("the data region: generated at the top of each test, kept and parked like any region, and holding only builder consts", async () => {
  const { s, id, list, run } = await dataSetup();
  const spec = s.read(SPEC);
  assert.ok(spec.includes(`async ({ page, contactsPage }) => {\n    // the test's data: only \`const <name> = <builder>(…);\` with a builder from the module's data file; every step sees it\n    // ui-code:begin ${list} data\n`), "before the steps, in the test's own closure");
  assert.deepEqual(await run({ DATA: ["    const contact = buildContact();"], S1: ["      await contactsPage.row(contact.name).click();"] }), []);
  const filled = s.read(SPEC);
  await s.uc("build", "acme", "contacts");
  assert.equal(s.read(SPEC), filled, "a rebuild keeps the data region byte for byte");
  for (const [what, lines] of [
    ["a let", ["    let contact = buildContact();"]],
    ["a literal", ["    const contact = { name: 'Nobody Here' };"]],
    ["a builder of another module", ["    const contact = buildDeal();"]],
    ["a statement", ["    await contactsPage.openNewContact();"]],
    ["two calls in one const", ["    const contact = buildContact(); const other = buildContact().name.trim();"]],
  ]) assert.ok((await run({ DATA: lines, S1: ["      await contactsPage.openNewContact();"] })).some((p) => p.includes("[data-region]")), what);
  // a test unapproved again: its data region is parked with its steps, and comes back
  await run({ DATA: ["    const contact = buildContact();"], S1: ["      await contactsPage.row(contact.name).click();"] });
  const edited = { key: "list", ...CASES.list, steps: ["Open the Contacts list"] };
  await cases(s, [edited, "create"], []);
  const r = await s.uc("build", "acme", "contacts");
  assert.ok(r.out.parked.includes(`${list} data`), JSON.stringify(r.out.parked));
  await cases(s, [edited, "create"], [edited, "create"]);
  assert.ok((await s.uc("build", "acme", "contacts")).out.restored.includes(`${list} data`));
  assert.ok(s.read(SPEC).includes(`// ui-code:begin ${list} data\n    const contact = buildContact();\n`));
  assert.ok(id.get("create"));
});

test("a data name is bound per test: a step that re-declares, shadows or reassigns it is a finding, and loses the binding", async () => {
  const { run } = await dataSetup();
  const DATA = ["    const c = buildContact();"];
  for (const [what, map] of [
    ["shadowed in Then (the validator's B3)", { DATA, S1: ["      await contactsPage.row(c.name).click();"], THEN: ["      const c = { name: 'Nobody Here' };", "      await expect(contactsPage.row(c.name)).toBeVisible();"] }],
    ["destructured over it", { DATA, S1: ["      const { name: c } = { name: 'Nobody Here' };", "      await contactsPage.openNewContact();"] }],
    ["a parameter of the same name", { DATA, S1: ["      const pick = (c: { name: string }) => c.name;", "      await contactsPage.openNewContact();"] }],
    ["reassigned", { DATA, S1: ["      // @ts-ignore", "      c = { name: 'Nobody Here' };", "      await contactsPage.openNewContact();"] }],
  ]) assert.ok((await run(map)).some((p) => p.includes("[data-shadow]")), what);
  // a write to a member of the data (D-055's known limit) is a finding too; a read or a comparison is not
  for (const [what, line] of [["a member assignment", "c.name = 'Nobody Here';"], ["a compound assignment", "c.name += ' Jr';"], ["an increment", "c.count++;"], ["a bracket write", "c['name'] = 'Nobody Here';"], ["a delete", "delete c.email;"], ["Object.assign", "Object.assign(c, { name: 'Nobody Here' });"]])
    assert.ok((await run({ DATA, S1: ["      // @ts-ignore", `      ${line}`, "      await contactsPage.openNewContact();"] })).some((p) => p.includes("[data-write]")), what);
  assert.ok(!(await run({ DATA, S1: ["      if (c.name === 'x' || c.email == 'y') await contactsPage.row(c.name).click();"] })).some((p) => p.includes("[data-write]")), "reads and comparisons are not writes");
  // and the shadowed value reaching a locator is not bound data
  const problems = await run({ DATA, S1: ["      await contactsPage.openNewContact();"], THEN: ["      const c = { name: 'Nobody Here' };", "      await expect(contactsPage.row(c.name)).toBeVisible();"] });
  assert.ok(problems.some((p) => p.includes("[locator-param]")), JSON.stringify(problems));
  // without the test's own data region, nothing is bound
  assert.ok((await run({ DATA: [], S1: ["      await contactsPage.row(c.name).click();"], THEN: ["      await expect(contactsPage.table).toBeVisible();"] })).some((p) => p.includes("[locator-param]")));
});

test("builders are run-unique: a value a data-driven locator finds is built with uniqueName, never a fixed string", async () => {
  const { s, run } = await dataSetup();
  const map = { DATA: ["    const contact = buildContact();"], S1: ["      await contactsPage.row(contact.name).click();"] };
  const DATA_FILE = `${PW}/helpers/ui/contacts.data.ts`;
  s.write(DATA_FILE, "export const buildContact = () => ({ name: 'Ada Example', email: 'ada@example.test' });\n");
  let problems = await run(map);
  assert.ok(problems.some((p) => p.startsWith("helpers/ui/contacts.data.ts") && p.includes("[data-unique]") && /returns 'name' without uniqueName \(the fixed string 'Ada Example'\)/.test(p)), JSON.stringify(problems));
  s.write(DATA_FILE, "import { uniqueName } from '../../utils/shared/data';\n\nexport const buildContact = () => ({ name: uniqueName('contact'), email: 'ada@example.test' });\n");
  assert.deepEqual(await run(map), [], "the email is a fixed string, but no locator finds it");
  problems = await run({ ...map, S1: ["      await contactsPage.row(contact.email).click();"] });
  assert.ok(problems.some((p) => /\[data-unique\] buildContact\(\) returns 'email' without uniqueName/.test(p)), JSON.stringify(problems));
  s.write(DATA_FILE, "import { uniqueName } from '../../utils/shared/data';\n\nexport const buildContact = () => ({ name: `${uniqueName('contact')} Jr`, email: 'ada@example.test' });\n");
  assert.deepEqual(await run(map), [], "a template built on uniqueName is unique");
  for (const value of ["fixed ? 'Jane Doe' : uniqueName('contact')", "uniqueName('contact') || 'Jane Doe'", "uniqueName('contact') ?? 'Jane Doe'"]) {
    s.write(DATA_FILE, `import { uniqueName } from '../../utils/shared/data';\n\nexport const buildContact = (fixed = false) => ({ name: ${value}, email: 'ada@example.test' });\n`);
    problems = await run(map);
    assert.ok(problems.some((p) => /\[data-unique\] buildContact\(\) returns 'name' a fixed string 'Jane Doe' as one alternative/.test(p)), `${value}: ${JSON.stringify(problems)}`);
  }
  s.write(DATA_FILE, "import { uniqueName } from '../../utils/shared/data';\n\nexport const buildContact = (prefix = 'contact') => ({ name: prefix ? uniqueName(prefix) : uniqueName('contact'), email: 'ada@example.test' });\n");
  assert.deepEqual(await run(map), [], "every alternative built on uniqueName is unique");
});

test("the smoke's commit words also cover Watch, Unwatch, Bookmark and Retry", () => {
  for (const name of ["Watch", "Unwatch", "Bookmark", "Retry"]) assert.ok(smokeClickProblem({ role: "button", name }), name);
});

// S9-2b: a step region is read as an acorn syntax tree (types stripped), so every spelling of a forbidden construct is
// the same node: the unit tests of the region scanner.
test("S9-2b: step regions reject every spelling of a raw locator, a page object escape or a skip, and accept look-alikes", async () => {
  const s = await setup();
  const id = await cases(s, ["list"]);
  const list = id.get("list");
  await s.uc("build", "acme", "contacts");
  writePages(s, ["pages/contacts/contacts.page.ts"]);
  await s.uc("build", "acme", "contacts");
  fillSteps(s);
  const bs = String.fromCharCode(92); // built at run time: the escapes stay escapes in this file
  const problems = async (lines) => {
    setRegions(s, { [`${list} step 1`]: lines });
    return (await s.uc("check", "acme", "contacts")).out.problems;
  };
  const rejected = [
    ["optional chaining on page", ["      await page?.click('#x');"], "raw-locator"],
    ["optional chaining into a locator", ["      await page?.locator('#x').click();"], "raw-locator"],
    ["comments between the tokens", ["      await page /* a */ . /* b */ click('#x');"], "raw-locator"],
    ["a line break between the tokens", ["      await page", "        .click('#x');"], "raw-locator"],
    ["a unicode escape in the method name", [`      await page.cl${bs}u0069ck('#x');`], "raw-locator"],
    ["a concatenated computed member", ["      await page['cl' + 'ick']('#x');"], "raw-locator"],
    ["a template computed member", ["      await page[`click`]('#x');"], "raw-locator"],
    ["a selector method taken without calling it", ["      const f = page.locator;", "      await f('#x').click();"], "raw-locator"],
    ["page destructured", ["      const { click } = page;", "      await click('#x');"], "raw-locator"],
    ["page handed on in an object", ["      await helper({ page });"], "raw-locator"],
    ["page behind a cast", ["      await (page as any).click('#x');"], "raw-locator"],
    ["a frame behind a getter", ["      await page.frames()[0].click('#x');"], "raw-locator"],
    ["the page object handed on in an object", ["      await helper({ contactsPage });"], "po-access"],
    ["the page object method behind optional chaining", ["      await contactsPage?.row?.call(contactsPage, 'Jane Doe').click();"], "po-access"],
    ["a page object method taken optionally", ["      const r = contactsPage?.row;", "      await r('Jane Doe').click();"], "po-access"],
    ["a computed page object method behind a template", ["      await contactsPage[`row`]('Jane Doe').click();"], "po-access"],
    ["test aliased", ["      const t = test;", "      t.skip();"], "test-reference"],
    ["test by computed access", ["      test['fixme'](true, 'x');"], "test-reference"],
    ["a skip inside a nested function", ["      [1].forEach(() => test.skip());"], "silent-skip"],
    ["a skip behind optional chaining", ["      test.info()?.skip?.();"], "silent-skip"],
    ["code that does not parse", ["      await contactsPage.row('x'"], "syntax"],
    ["with hands the page on", ["      with (page) { click('#x'); }"], "raw-locator"],
    ["with hands a page object on", ["      with (contactsPage) { row('Jane Doe'); }"], "po-access"],
  ];
  for (const [what, lines, rule] of rejected) {
    const found = await problems(lines);
    assert.ok(found.some((p) => p.includes(`[${rule}]`)), `${what}: ${rule} expected, got ${JSON.stringify(found)}`);
  }
  // look-alikes are not findings: the words in comments and strings, a key named page, a plain step
  const accepted = [
    ["      // page.click('#x') and test.skip() are not allowed here", "      await contactsPage.row('Jane Doe jane@private.test 2026-10-01').click();"],
    ["      const label = 'page.click then test.fixme';", "      await contactsPage.search.fill(label);"],
    ["      const o = { page: 1, test: 2 };", "      await contactsPage.search.fill(String(o.page));"],
    ["      await page.goto(`/contacts`);", "      await expect(page).toHaveURL(/contacts/);"],
  ];
  for (const lines of accepted) assert.deepEqual(await problems(lines), [], lines.join(" ⏎ "));
});
