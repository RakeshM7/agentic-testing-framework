// Shared fixtures for the node:test suites. A throwaway root stands for this repository as it is laid out today, one
// directory that is both the workspace and the framework (D-085): it holds a copy of config/permissions.yaml, and the
// helpers pass it as the framework root wherever a script reads framework config (startRun, exploreSession), so a run's
// commands are `node scripts/...` and the browser config is the root's own. Templates and schemas still come from the
// real framework. scripts/workspace.test.mjs covers a workspace apart from its framework.
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { main as exploreMain } from "./explore.mjs";
import { HEADERS, append as appendCsv, csvPath } from "./lib/clarifications.mjs";
import { explorePaths } from "./lib/explore.mjs";
import { frameworkRoot, paths } from "./lib/contract.mjs";
import { parseCsv, serializeCsv } from "./lib/csv.mjs";
import { knowledgePaths, mergeGlossary, registerSource, render, runCheck, storeSnapshot } from "./lib/knowledge.mjs";
import { recordCanary } from "./lib/guard-check.mjs";
import { GROUPS, packageDir, recordDoctor } from "./lib/doctor.mjs";
import { initRun } from "./run.mjs";

export function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "atf-"));
  mkdirSync(path.join(root, "config"));
  copyFileSync(path.join(frameworkRoot, "config", "permissions.yaml"), path.join(root, "config", "permissions.yaml"));
  return root;
}

const MODULE_LINES = {
  contacts: "  - {slug: contacts, name: Contacts, entry_url: 'https://app.acme.test/contacts'}",
  deals: "  - {slug: deals, name: Deals, nav_path: [Deals]}",
};

export function writeConfig(root, { mode = "readonly", policy, product = "acme", apiUrls, extra = [], modules = ["contacts", "deals"] } = {}) {
  const file = path.join(root, "config", `${product}.yaml`);
  writeFileSync(
    file,
    [
      `product: ${product}`,
      apiUrls ? `target: {url: 'https://app.acme.test', api_urls: [${apiUrls.map((u) => `'${u}'`).join(", ")}]}` : "target: {url: 'https://app.acme.test'}",
      ...extra,
      "modules:",
      ...modules.map((m) => MODULE_LINES[m]),
      `authorizations: {mode: ${mode}}`,
      ...(policy ? [`clarifications: {unresolved_policy: ${policy}}`] : []),
    ].join("\n")
  );
  return file;
}

// A started run whose session has passed the guard liveness check (as on Claude Code) and the dependency check, unless
// `verified: false` (no guard record) or `doctored: false` (no dependency record).
export function startRun(opts = {}) {
  const root = tempRoot();
  const r = initRun(writeConfig(root, opts), { root, framework: root, runId: opts.runId ?? "acme-run-1", env: { CLAUDECODE: "1" } });
  if (r.errors) throw new Error(r.errors.join("\n"));
  if (opts.verified !== false) recordCanary(r.product, root, { host: "claude-code", agent: "orchestrator-agent" });
  if (opts.doctored !== false) recordDoctor(r.product, root, { groups: GROUPS, checks: [] });
  return { root, run: r.run, product: r.product };
}

export function put(root, rel, content) {
  const p = path.join(root, rel);
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, content);
}

// A module's endpoint catalogue the way the api-discovery stage leaves it: endpoints.mjs build over a one-endpoint
// network inventory (an empty inventory gives an empty catalogue, which is a valid "no API surface" outcome).
export async function buildCatalogue(root, { product = "acme", module = "contacts", inventory } = {}) {
  const { apiPaths, build } = await import("./lib/endpoints.mjs");
  const { writeJson } = await import("./lib/files.mjs");
  const ap = apiPaths(paths(product, root).productDir, module);
  writeJson(ap.inventory, inventory ?? [{ method: "GET", pathTemplate: `/api/v1/${module}`, statusCodes: [200], requestKeys: [], responseKeys: ["id"], pages: ["list"] }]);
  const r = build(ap, { module, cfg: { target: { url: "https://app.acme.test" }, modules: [{ slug: module, name: module }], api: {} }, runId: `${product}-run-1` });
  if (r.problems.length) throw new Error(r.problems.join("\n"));
  return ap;
}

// A valid product-level knowledge pass, the way the knowledge-generator produces it (via the scripts): every heading,
// one Main areas bullet per module, a tagged open point, rendered, checked and stamped (D-051).
export function writeProductKnowledge(root, product = "acme") {
  const p = paths(product, root);
  const kp = knowledgePaths(p.productDir);
  const cfg = JSON.parse(readFileSync(p.configFile, "utf8"));
  const s = registerSource(kp, cfg, { title: "Acme help center", location: "https://help.acme.test", type: "vendor-doc", runId: "acme-run-1" });
  const cite = `[${s.id}]`;
  put(root, `artifacts/${product}/knowledge/overview.md`, [
    "# Acme CRM", "",
    "## What it is", "", `Acme is a CRM for small sales teams ${cite}.`, "",
    "## Users and roles", "", `- Sales reps and their managers ${cite}.`, "",
    "## Main areas", "", ...cfg.modules.map((m) => `- **${m.name}**: the ${m.name.toLowerCase()} area ${cite}.`), "",
    "## Key concepts", "", `- Leads become contacts ${cite}.`, "",
    "## Integrations", "", `- Email sync ${cite}.`, "",
    "## Constraints and limits", "", `- Plans limit the number of seats ${cite}.`, "",
    "## Open points", "", "- (limits) The seat limit per plan is not documented.", "",
  ].join("\n"));
  put(root, `artifacts/${product}/knowledge/glossary.md`, `# Glossary

| Term | Definition | Scope | Sources |
|---|---|---|---|
| Lead | A prospective customer ${cite} | product | ${cite} |
`);
  render(kp, undefined, { runId: "acme-run-1" });
  const r = runCheck(kp, cfg, { runId: "acme-run-1" });
  if (!r.valid) throw new Error(`writeProductKnowledge: ${r.problems.join("\n")}`);
  return { kp, sourceId: s.id, cfg };
}

// A valid module pass: every notes heading, a quoted rule fact verified against the cached source text, the other
// categories cited or named by a tagged open point; merged, rendered, checked and stamped.
export function writeModuleKnowledge(root, module, product = "acme") {
  const p = paths(product, root);
  const kp = knowledgePaths(p.productDir);
  const cfg = JSON.parse(readFileSync(p.configFile, "utf8"));
  const s = registerSource(kp, cfg, { title: `${module} guide`, location: `https://help.acme.test/${module}`, type: "vendor-doc", module, runId: "acme-run-1" });
  storeSnapshot(kp, s.id, `<h1>${module}</h1>
Records can be bulk-updated.
A record name must be unique within the account.
Only admins can delete records.`, { captured_by: "script", runId: "acme-run-1" });
  const c = `[${s.id}]`;
  const dir = `artifacts/${product}/knowledge/modules/${module}`;
  put(root, `${dir}/overview.md`, `# ${module}

## Purpose

The ${module} module stores records ${c}.

## Who uses it

- Sales reps ${c}.

## Where it is

- The main menu ${c}.

## Open points

- (flows) The import flow is not documented.
`);
  put(root, `${dir}/glossary.md`, `| Term | Definition | Sources |
|---|---|---|
| Owner | User responsible for the record | ${c} |
`);
  put(root, `${dir}/notes.md`, [
    "## How it works", "", `- Records can be bulk-updated ${c}.`, "",
    "## Key entities and fields", "", `- A record has a name [${s.id} "a record name must be unique"].`, "",
    "## Key actions and flows", "", "## Business rules and validations", "", `- Record names are unique per account [${s.id} "must be unique within the account"].`, "",
    "## Roles and permissions", "", `- Admins delete records [${s.id} "Only admins can delete records"].`, "",
    "## Limits and constraints", "", "## Dependencies on other modules", "",
    "## Open points", "", "- (limits) Whether there is a maximum number of records is not documented.", "- (dependencies) Whether deals reference records is not documented.", "",
  ].join("\n"));
  mergeGlossary(kp, module);
  render(kp, module, { runId: "acme-run-1" });
  const r = runCheck(kp, cfg, { module, runId: "acme-run-1" });
  if (!r.valid) throw new Error(`writeModuleKnowledge(${module}): ${r.problems.join("\n")}`);
  return { kp, sourceId: s.id, cfg };
}

// A human editing clarifications.csv in Excel: set one row's Answer status (and optionally its Answer) directly.
export function humanEdit(file, id, { status, answer }) {
  const rows = parseCsv(readFileSync(file, "utf8"));
  const row = rows.find((r) => r[0] === id);
  if (!row) throw new Error(`${id}: no such row`);
  if (answer !== undefined) row[HEADERS.indexOf("Answer")] = answer;
  if (status !== undefined) row[HEADERS.indexOf("Answer status")] = status;
  writeFileSync(file, serializeCsv(rows));
}

// A recorded human approval of hand-written cases (ids): coverage.json lists them (when it does not exist yet) and
// approvals.json holds a yes on each one's content hash, the way `testcases.mjs approve` records it.
export function markApproved(root, ids, { product = "acme", module = "contacts" } = {}) {
  const dir = path.join(root, "artifacts", product, "modules", module, "testcases");
  const covFile = path.join(dir, "coverage.json");
  let cov;
  try {
    cov = JSON.parse(readFileSync(covFile, "utf8"));
  } catch {
    cov = { cases: [] };
  }
  const missing = ids.filter((id) => !cov.cases.some((c) => c.id === id));
  if (missing.length || !existsSync(covFile)) {
    cov.cases.push(...missing.map((id) => ({ id, hash: createHash("sha256").update(id).digest("hex") })));
    put(root, path.relative(root, covFile), JSON.stringify(cov));
  }
  const at = new Date().toISOString();
  const cases = Object.fromEntries(cov.cases.filter((c) => ids.includes(c.id)).map((c) => [c.id, { decision: "yes", comment: "", hash: c.hash, version: `v${c.hash.slice(0, 12)}`, run: null, at }]));
  put(root, path.relative(root, path.join(dir, "approvals.json")), JSON.stringify({ module, cases }));
}

// A module's test cases the way the pipeline makes them: the writer's cases.json (each case covering one flow), built
// and checked by scripts/testcases.mjs, then the cases in `approve` (keys) approved by a human at a terminal.
// cases: [{key, type?, priority?, mutates?, api?}]. -> Map key -> TC id
export async function buildCases(root, { product = "acme", module = "contacts", cases, approve = [] }) {
  const { main } = await import("./testcases.mjs");
  const dir = `artifacts/${product}/modules/${module}`;
  put(root, `${dir}/explore/flows/main.md`, "# Main flow\n\nThe contacts list and the New contact dialog.\n");
  const run = (cmd) => main([cmd, product, module], { root, interactive: { isTTY: true, ask: async () => module } });
  const flow = (await run("items")).out.items.find((i) => i.technique === "flow").id;
  const overlay = cases.map((c) => ({
    key: c.key, title: `The ${c.key.replaceAll("-", " ")} case lists the contact`, type: c.type ?? "functional", priority: c.priority ?? "p2",
    ...(c.mutates ? { mutates: true } : {}), ...(c.api ? { api: true } : {}),
    action: "the user opens the contact list", steps: ["Open Contacts"], expected: "the contact is listed in the table",
    covers: [flow], evidence: ["observation:explore/flows/main.md"],
  }));
  put(root, `${dir}/testcases/cases.json`, JSON.stringify({ cases: overlay }));
  for (const cmd of ["build", "check"]) {
    const r = await run(cmd);
    if (r.code) throw new Error(`buildCases: ${cmd}: ${JSON.stringify(r.out.problems)}`);
  }
  const ids = new Map(JSON.parse(readFileSync(path.join(root, dir, "testcases", "coverage.json"), "utf8")).cases.map((c) => [c.key, c.id]));
  if (approve.length) {
    const sheet = path.join(root, dir, "testcases", "approval.csv");
    const rows = parseCsv(readFileSync(sheet, "utf8"));
    const col = rows[0].indexOf("Approved");
    for (const key of approve) rows.find((r) => r[0] === ids.get(key))[col] = "yes";
    writeFileSync(sheet, serializeCsv(rows));
    const r = await run("approve");
    if (r.code) throw new Error(`buildCases: approve: ${JSON.stringify(r.out.problems)}`);
  }
  return ids;
}

// A product's foundations the way the pipeline makes them (D-054): rendered from templates/ by scripts/foundation.mjs
// and checked, with the compile commands (tsc, playwright --list, k6 inspect) stubbed to pass, so each side's verified
// stamp is current. overlays: {side: overlay object} written first. -> {side: check output}
export async function renderFoundation(root, sides = ["repo", "ui", "api", "k6"], { product = "acme", overlays = {} } = {}) {
  const { main } = await import("./foundation.mjs");
  const out = {};
  for (const side of sides) {
    if (overlays[side]) put(root, `artifacts/${product}/foundation/${side}-overlay.json`, JSON.stringify(overlays[side]));
    const r = await main(["render", product, "--side", side], { root });
    if (r.code) throw new Error(`renderFoundation: render ${side}: ${JSON.stringify(r.out)}`);
    const c = await main(["check", product, "--side", side], { root, exec: () => null });
    if (c.code) throw new Error(`renderFoundation: check ${side}: ${JSON.stringify(c.out.problems)}`);
    out[side] = c.out;
  }
  return out;
}

// Playwright's `test --list --reporter=json` of a module's specs, read from their literal test titles: what the gate's
// compile mode sees, without Playwright (D-053's list, injected into ui-code.mjs and the gate).
export function listSpecTitles(cwd, side, module) {
  const dir = path.join(cwd, "tests", side, module);
  const specs = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".spec.ts")).sort() : [];
  return {
    report: {
      config: {},
      suites: specs.map((f) => ({
        title: `${module}/${f}`, file: `${module}/${f}`,
        specs: [...readFileSync(path.join(dir, f), "utf8").matchAll(/^\s*test\((['"])((?:\\.|(?!\1).)*)\1/gm)].map((m, i) => ({ title: m[2].replace(/\\(.)/g, "$1"), file: `${module}/${f}`, line: i + 1, tests: [{ expectedStatus: "passed", annotations: [] }] })),
        suites: [],
      })),
    },
  };
}

// A module's UI code the way pw-ui-pom-writer and pw-ui-tests-writer make it (D-055): ui-code.mjs build, every step region
// filled, and check (scope "pages": check --pages, without filling) with the compile commands stubbed to pass, so the
// scope's verified stamp is current. The module's cases must be built and approved, and the foundation rendered.
export async function scaffoldUiCode(root, { product = "acme", module = "contacts", scope = "tests" } = {}) {
  const { main } = await import("./ui-code.mjs");
  const { parseRegions, renderSpec, uiCodeContext } = await import("./lib/ui-code.mjs");
  const uc = (...args) => main(args, { root, exec: () => null, listTests: listSpecTitles });
  const b = await uc("build", product, module);
  if (b.code) throw new Error(`scaffoldUiCode: build: ${JSON.stringify(b.out.problems)}`);
  if (scope === "tests") {
    const p = paths(product, root);
    const ctx = uiCodeContext({ root, product, module, run: JSON.parse(readFileSync(p.runFile, "utf8")), cfg: JSON.parse(readFileSync(p.configFile, "utf8")), productDir: p.productDir });
    const plan = JSON.parse(readFileSync(ctx.up.plan, "utf8"));
    const spec = path.join(ctx.pwProject, plan.files.spec);
    const { regions } = parseRegions(readFileSync(spec, "utf8"));
    regions.set("setup", ["import { recordCreated } from '../../../utils/shared/ledger';"]);
    for (const t of plan.tests) {
      t.steps.forEach((_, n) => regions.set(`${t.id} step ${n + 1}`, ["      await page.goto('/');", ...(t.mutates && n === 0 ? [`      recordCreated({ type: 'record', ref: '${t.id}', module: '${module}' });`] : [])]));
      regions.set(`${t.id} then`, [t.visual ? `      await expect(page).toHaveScreenshot('${t.id}.png');` : "      await expect(page).toHaveURL(/./);"]);
    }
    writeFileSync(spec, renderSpec(ctx, plan, regions));
  }
  const c = await uc("check", product, module, ...(scope === "pages" ? ["--pages"] : []));
  if (c.code) throw new Error(`scaffoldUiCode: check: ${JSON.stringify(c.out.problems)}`);
  return c.out;
}

// A module's API code the way pw-api-client-writer and pw-api-tests-writer make it (D-056): api-code.mjs build, the
// module's client fixtures registered in the generated fixtures/api/index.ts, every payload and glue slot filled (scope "tests"),
// and check (scope "clients": check --clients) with the compile commands stubbed to pass, so the scope's verified stamp
// is current. The module's API plan must be checked and the API foundation rendered.
export const API_INDEX = (module = "contacts") =>
  `import { test as base } from './base';\nimport { ${module}Clients, type ${module[0].toUpperCase()}${module.slice(1)}Clients } from './clients/${module}';\n\nexport const test = base.extend<${module[0].toUpperCase()}${module.slice(1)}Clients>({ ...${module}Clients });\n\nexport { expect } from './base';\n`;
export async function scaffoldApiCode(root, { product = "acme", module = "contacts", scope = "tests", fill } = {}) {
  const { main } = await import("./api-code.mjs");
  const { apiCodeContext, parseSlots, renderGlue, renderPayloads } = await import("./lib/api-code.mjs");
  const ac = (...args) => main(args, { root, exec: () => null, listTests: listSpecTitles });
  const b = await ac("build", product, module);
  if (b.code) throw new Error(`scaffoldApiCode: build: ${JSON.stringify(b.out.problems)}`);
  const p = paths(product, root);
  const ctx = apiCodeContext({ root, product, module, run: JSON.parse(readFileSync(p.runFile, "utf8")), cfg: JSON.parse(readFileSync(p.configFile, "utf8")), productDir: p.productDir });
  const model = JSON.parse(readFileSync(ctx.ap.plan, "utf8"));
  if (scope === "tests") {
    const pf = path.join(ctx.pwProject, model.files.payloads);
    const { regions } = parseSlots(readFileSync(pf, "utf8"));
    for (const x of model.payloads) regions.set(`payload ${x.name}`, fill?.(x) ?? ["  return { name: uniqueName('contact') };"]);
    writeFileSync(pf, renderPayloads(ctx, model, regions));
    if (model.glue.length) {
      const gf = path.join(ctx.pwProject, model.files.glue);
      const g = parseSlots(readFileSync(gf, "utf8")).regions;
      const create = model.clients.flatMap((c) => c.methods.filter((m) => m.crud === "create").map((m) => [c.fixture, m])).find(([, m]) => model.payloads.some((x) => x.endpoint === m.endpoint && x.kind === "body"));
      const builder = model.payloads.find((x) => x.endpoint === create[1].endpoint && x.kind === "body").name;
      for (const x of model.glue) g.set(`glue ${x.name}`, [`  const res = await c.clients.${create[0]}.${create[1].name}({ body: payloads.${builder}() });`, "  c.track(res);", "  return {};"]);
      writeFileSync(gf, renderGlue(ctx, model, g, new Map((JSON.parse(readFileSync(ctx.ap.testsOverlay, "utf8")).glue ?? []).map((x) => [x.scenario, x.reason]))));
    }
  }
  const c = await ac("check", product, module, ...(scope === "clients" ? ["--clients"] : []));
  if (c.code) throw new Error(`scaffoldApiCode: check: ${JSON.stringify(c.out.problems)}`);
  return { ctx, model, out: c.out };
}

const EXPLORE_FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "explore");

// A module-explorer session over the fixture module (scripts/fixtures/explore): records states from the fixture
// snapshots through explore.mjs as the agent would. -> {root, xp, ex, cap, state, model, item, write}
export function exploreSession(root) {
  const xp = explorePaths(paths("acme", root).productDir, "contacts");
  const ex = (...args) => exploreMain(args, { root, framework: root, env: {} });
  let n = 0;
  // the agent saves a capture under explore/captures/ and passes its path
  const cap = (name) => {
    mkdirSync(xp.captures, { recursive: true });
    const to = `captures/${++n}-${name}`;
    copyFileSync(path.join(EXPLORE_FIXTURES, name), path.join(xp.dir, to));
    return to;
  };
  const state = async (name, via, ...actions) => {
    const args = ["state", "acme", "contacts", "--snapshot", cap(name)];
    if (via) args.push("--via", via, ...actions.flatMap((a) => (/^FR-/.test(a) ? ["--item", a] : ["--action", a])));
    const r = await ex(...args);
    assert.equal(r.code, 0, JSON.stringify(r.out));
    return r.out;
  };
  const model = async () => {
    await ex("build", "acme", "contacts");
    return JSON.parse(readFileSync(xp.model, "utf8"));
  };
  const item = async (st, role, name) => (await model()).frontier.find((i) => i.state === st && i.role === role && (i.name === name || (i.examples ?? []).includes(name)));
  const write = (rel, data) => {
    mkdirSync(path.dirname(path.join(xp.dir, rel)), { recursive: true });
    writeFileSync(path.join(xp.dir, rel), typeof data === "string" ? data : JSON.stringify(data, null, 2));
  };
  return { root, xp, ex, cap, state, model, item, write };
}


// The whole readonly exploration of the fixture module, as the agent would do it. -> ids for the tests
export async function exploreFixture(s) {
  const list = await s.state("contacts-list.md");
  const dialog = await s.state("contacts-list-dialog.md", list.state, 'button "New contact"');
  await s.state("contacts-list.md", dialog.state, 'button "Cancel"');
  const mine = await s.state("contacts-list-tab-mine.md", list.state, 'tab "Mine"');
  await s.state("contacts-list.md", mine.state, 'tab "All"');
  await s.state("contacts-list.md", list.state, 'tab "All"');
  const detail = await s.state("contacts-detail.md", list.state, 'link "Jane Doe"');
  await s.state("contacts-list.md", detail.state, 'link "Back to contacts"');
  await s.state("contacts-detail.md", detail.state, 'link "Jane Doe"'); // the breadcrumb's own page
  const sorted = await s.state("contacts-list-sorted.md", list.state, 'columnheader "Name"');
  await s.state("contacts-list.md", sorted.state, 'columnheader "Name ▲"');
  await s.state("contacts-list.md", list.state, 'link "Acme CRM"');
  await s.state("contacts-list.md", list.state, 'link "Contacts"');
  const ids = { list: list.state, dialog: dialog.state, mine: mine.state, detail: detail.state, sorted: sorted.state };
  ids.name = (await s.item(ids.dialog, "textbox", "Name *")).id;
  ids.email = (await s.item(ids.dialog, "textbox", "Email")).id;
  ids.owner = (await s.item(ids.dialog, "combobox", "Owner")).id;
  ids.subscribed = (await s.item(ids.dialog, "checkbox", "Subscribed")).id;
  ids.search = (await s.item(ids.list, "searchbox", "Search contacts")).id;
  ids.sort = (await s.item(ids.list, "combobox", "Sort by")).id;
  ids.edit = (await s.item(ids.detail, "button", "Edit")).id;
  return ids;
}

// The agent's judgments and files after exploring, so that check passes.
export function finishExploration(s, ids) {
  const questions = [
    { question: "Is \"Name\" required when creating a contact?", steps: "1. Sign in.\n2. Open \"Contacts\".\n3. Click \"New contact\".\n4. Leave \"Name *\" empty and click \"Save\".\n5. Observe whether the contact is saved.", item: [ids.name], kq: ["KQ-contacts-1"] },
    { question: "What format does \"Email\" accept?", steps: "1. Sign in.\n2. Open \"Contacts\".\n3. Click \"New contact\".\n4. Type \"not-an-email\" in \"Email\" and click \"Save\".\n5. Observe the message.", item: [ids.email] },
  ];
  s.write("new-questions.json", questions);
  appendCsv(csvPath(paths("acme", s.root).productDir, "contacts"), "contacts", "acme-run-1", questions);
  s.write("captures/owner-note.md", "Billing shows the seat limit per plan: 5 seats on the starter plan.");
  s.write("captures/edit-popup.md", "Clicking Edit opened a new window; the browser tool stayed on the detail page.");
  s.write("captures/deals-link.md", "The deal page lists its contacts: deals reference records by id.");
  s.write("captures/subscribed.md", "Toggling \"Subscribed\" changes nothing on screen until the dialog is saved.");
  s.write("captures/deals-note.md", "Admin guide: there is a maximum number of records per plan, set under Billing.");
  s.write("overlay.json", {
    items: {
      [ids.subscribed]: { reason: "unreachable", detail: "toggling it changes nothing on screen until the dialog is saved", citation: "observation:explore/captures/subscribed.md" },
      [ids.edit]: { reason: "unreachable", detail: "opens the edit form in a new window the browser tool cannot follow", citation: "observation:explore/captures/edit-popup.md" },
    },
    kq: {
      "KQ-contacts-2": { status: "observed", evidence: "observation:explore/captures/deals-link.md" },
      "KQ-contacts-3": { status: "dismissed", reason: "the admin guide sets it per plan; nothing to explore here", citation: "observation:explore/captures/deals-note.md" },
      "KQ-product-1": { status: "observed", evidence: "observation:explore/captures/owner-note.md" },
    },
    inputs: {
      [ids.owner]: { reason: "its options are listed in interactions.json; no rule to ask about" },
      [ids.subscribed]: { reason: "a plain opt-in flag" },
      [ids.search]: { reason: "search is covered by the list flow" },
      [ids.sort]: { reason: "its options are listed in interactions.json" },
    },
  });
  s.write("flows/create-contact.md", `# Create a contact\nPreconditions: signed in.\n1. Open "Contacts" (${ids.list}).\n2. Click "New contact" (${ids.dialog}).\nExpected result: the "New contact" dialog opens.\n`);
  s.write("module-summary.md", "# Contacts\n## Pages\n- contacts, contacts-id\n");
}

// ---- a client's workspace with the framework installed (docs/packaging.md §3.1, §3.6) ------------------------------

const CLIENT_FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "client-workspace");
export const INSTALLED_PACKAGE = "node_modules/@testagentic/atf";

// installedWorkspace(): a client's test repo as `npm install` leaves it, for what only an installed framework does
// (atf sync's .gitignore block, the doctor's host-files check, the postinstall, agent fragments, atf init). Offline: no
// npm, no network.
//   - scripts/fixtures/client-workspace is copied into a temp directory: package.json, atf/atf.json, the overlay
//     atf/models.yaml (report-generator on haiku for Claude Code) and the run-config config/acme.yaml.
//   - A real copy of this framework (not a link: isInstalled() needs node_modules in its real path) goes to
//     <root>/node_modules/@testagentic/atf, so `{fw}` there is node_modules/@testagentic/atf. Left out, as the published
//     package leaves them out: every node_modules folder and scripts/fixtures.
//   - Every package in this repository's node_modules but the framework's own link (js-yaml, ajv, acorn, their own
//     dependencies, playwright) is linked into <root>/node_modules, as junctions on Windows (no admin rights needed),
//     so the copy's scripts import them as a client's would.
// -> { root: the workspace, framework: the installed copy }, both real paths. Pass them to in-process calls
// (build({ root, framework }), plan(argv, { workspace: root, framework }), runChecks(…, { root, framework })), or run the
// copy's own scripts (`node <framework>/bin/atf.mjs …`) for anything that depends on where the script lives.
export function installedWorkspace() {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-client-")));
  cpSync(CLIENT_FIXTURE, root, { recursive: true });
  const framework = path.join(root, ...INSTALLED_PACKAGE.split("/"));
  const skip = new Set([path.join(frameworkRoot, "scripts", "fixtures")]);
  cpSync(frameworkRoot, framework, { recursive: true, filter: (src) => path.basename(src) !== "node_modules" && !skip.has(src) });
  const deps = path.dirname(packageDir("js-yaml", frameworkRoot));
  for (const name of readdirSync(deps)) {
    if (name.startsWith(".") || name === "@testagentic" || name === "node_modules") continue;
    symlinkSync(path.join(deps, name), path.join(root, "node_modules", name), "junction");
  }
  return { root, framework };
}
