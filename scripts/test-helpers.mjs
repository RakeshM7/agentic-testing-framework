// Shared fixtures for the node:test suites: a throwaway repo root with the real config/permissions.yaml.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HEADERS } from "./lib/clarifications.mjs";
import { paths, repoRoot } from "./lib/contract.mjs";
import { parseCsv, serializeCsv } from "./lib/csv.mjs";
import { knowledgePaths, mergeGlossary, registerSource, render, runCheck, storeSnapshot } from "./lib/knowledge.mjs";
import { recordCanary } from "./lib/guard-check.mjs";
import { GROUPS, recordDoctor } from "./lib/doctor.mjs";
import { initRun } from "./run.mjs";

export function tempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "atf-"));
  mkdirSync(path.join(root, "config"));
  copyFileSync(path.join(repoRoot, "config", "permissions.yaml"), path.join(root, "config", "permissions.yaml"));
  return root;
}

export function writeConfig(root, { mode = "readonly", policy, product = "acme", apiUrls, extra = [] } = {}) {
  const file = path.join(root, "config", `${product}.yaml`);
  writeFileSync(
    file,
    [
      `product: ${product}`,
      apiUrls ? `target: {url: 'https://app.acme.test', api_urls: [${apiUrls.map((u) => `'${u}'`).join(", ")}]}` : "target: {url: 'https://app.acme.test'}",
      ...extra,
      "modules:",
      "  - {slug: contacts, name: Contacts, entry_url: 'https://app.acme.test/contacts'}",
      "  - {slug: deals, name: Deals, nav_path: [Deals]}",
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
  const r = initRun(writeConfig(root, opts), { root, runId: opts.runId ?? "acme-run-1", env: { CLAUDECODE: "1" } });
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
