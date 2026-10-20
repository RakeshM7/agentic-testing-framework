import test from "node:test";
import assert from "node:assert/strict";
import { validateRunConfig } from "./run-config.mjs";

const base = { product: "acme", target: { url: "https://app.acme.test" }, modules: [{ slug: "contacts", name: "Contacts", nav_path: ["Contacts"] }] };

test("minimal config normalizes with safe defaults", () => {
  const { errors, normalized } = validateRunConfig(base);
  assert.deepEqual(errors, []);
  assert.equal(normalized.authorizations.mode, "readonly");
  assert.equal(normalized.permissions_file, "config/permissions.yaml");
  assert.equal(normalized.clarifications.unresolved_policy, "stop");
  assert.deepEqual(normalized.limits, { review_rounds: 3, heal_rounds: 3 });
  assert.deepEqual(normalized.concurrency, { modules: 1, clarification_rows: 1 });
  assert.equal(normalized.git.auto_commit, false);
});

test("product and an explicit module list are required", () => {
  const { errors } = validateRunConfig({ target: base.target });
  assert.ok(errors.some((e) => e.startsWith("product:")));
  assert.ok(errors.some((e) => e.startsWith("modules:")));
});

test("module entries need a kebab slug, a name, and a way to reach them; slugs are unique", () => {
  const { errors } = validateRunConfig({ ...base, modules: [{ slug: "Contacts", name: "C" }, { slug: "deals", name: "D", entry_url: "nope" }, { slug: "deals", name: "D2", nav_path: ["x"] }] });
  assert.ok(errors.some((e) => /modules\[0\]\.slug/.test(e)));
  assert.ok(errors.some((e) => /modules\[1\]\.entry_url/.test(e)));
  assert.ok(errors.some((e) => /duplicate 'deals'/.test(e)));
});

test("rejects unknown keys and bad enums", () => {
  const { errors } = validateRunConfig({ ...base, answers: [], authorizations: { mode: "fullrun" }, clarifications: { unresolved_policy: "ask" } });
  assert.ok(errors.includes("answers: unknown top-level key"));
  assert.ok(errors.some((e) => e.startsWith("authorizations.mode")));
  assert.ok(errors.some((e) => e.startsWith("clarifications.unresolved_policy")));
});

test("api discovery settings: API hosts, specs, auth header by variable NAME, budgets; defaults are conservative", () => {
  const ok = validateRunConfig({ ...base, target: { ...base.target, api_urls: ["https://api.acme.test/v2"] }, api: { specs: ["specs/acme.yaml"], auth_header: { name: "Authorization", env: "ACME_API_TOKEN", prefix: "Bearer " } } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.normalized.target.api_urls, ["https://api.acme.test/v2"]);
  assert.equal(ok.normalized.api.probe_budget, 50);
  assert.deepEqual(validateRunConfig(base).normalized.api.graphql, []);
  const { errors } = validateRunConfig({ ...base, target: { ...base.target, api_urls: ["ftp://x"] }, api: { auth_header: "Bearer abc", probe_budget: 0, token: "x" } });
  assert.ok(errors.some((e) => e.startsWith("target.api_urls")));
  assert.ok(errors.some((e) => e.startsWith("api.auth_header")));
  assert.ok(errors.some((e) => e.startsWith("api.probe_budget")));
  assert.ok(errors.includes("api.token: unknown key"));
});

test("exploration budgets: per-module max_pages 40 and max_states 150 by default; positive integers only (D-052)", () => {
  assert.deepEqual(validateRunConfig(base).normalized.explore, { max_pages: 40, max_states: 150 });
  assert.deepEqual(validateRunConfig({ ...base, explore: { max_states: 20 } }).normalized.explore, { max_pages: 40, max_states: 20 });
  const { errors } = validateRunConfig({ ...base, explore: { max_pages: 0, max_states: "lots", depth: 3 } });
  assert.ok(errors.some((e) => e.startsWith("explore.max_pages")));
  assert.ok(errors.some((e) => e.startsWith("explore.max_states")));
  assert.ok(errors.includes("explore.depth: unknown key"));
});

test("test cases: max_cases is 200 per module by default; a positive integer only; unknown keys rejected", () => {
  assert.deepEqual(validateRunConfig(base).normalized.testcases, { output_format: "gherkin", max_cases: 200 });
  assert.deepEqual(validateRunConfig({ ...base, testcases: { output_format: "csv", max_cases: 50 } }).normalized.testcases, { output_format: "csv", max_cases: 50 });
  const { errors } = validateRunConfig({ ...base, testcases: { max_cases: 0, budget: 3 } });
  assert.ok(errors.some((e) => e.startsWith("testcases.max_cases")));
  assert.ok(errors.includes("testcases.budget: unknown key"));
  assert.ok(validateRunConfig({ ...base, testcases: "gherkin" }).errors.includes("testcases: must be a mapping"));
});

// ---- the orchestrator's interview (D-063) ----
import { mkdtempSync, writeFileSync as writeFile, readFileSync as readFile, existsSync as has, mkdirSync as mkdir } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { draftRunConfig } from "./run-config.mjs";
import { buildDraft, slugify } from "./lib/run-config-draft.mjs";

const interviewRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), "interview-"));
  mkdir(path.join(root, "docs"));
  writeFile(path.join(root, "docs", "prd.md"), "# PRD");
  writeFile(path.join(root, "docs", "plan.xlsx"), "x");
  return root;
};
const answers = {
  name: "Acme CRM",
  visibility: "internal",
  description: "Sales CRM for the field team",
  url: "https://crm.acme.test",
  overview_url: "https://wiki.acme.test/crm",
  api: ["https://api.acme.test/v2", "https://api.acme.test/openapi.json"],
  modules: ["Contacts", { name: "Deals", url: "https://crm.acme.test/deals", references: ["docs/prd.md"] }],
  references: ["https://wiki.acme.test/crm", "docs/prd.md", "docs/plan.xlsx"],
  login: { needed: true },
};

test("interview answers become a valid, readonly run-config written once", () => {
  const root = interviewRoot();
  const d = draftRunConfig(answers, { root });
  assert.deepEqual(d.errors, []);
  assert.equal(d.file, "config/acme-crm.yaml");
  const cfg = yaml.load(readFile(path.join(root, d.file), "utf8"));
  assert.deepEqual(validateRunConfig(cfg).errors, []);
  assert.equal(cfg.authorizations.mode, "readonly");
  assert.deepEqual(cfg.about, { name: "Acme CRM", visibility: "internal", description: "Sales CRM for the field team" });
  assert.deepEqual(cfg.modules.map((m) => m.slug), ["contacts", "deals"]);
  assert.deepEqual(cfg.modules[1].nav_path, ["Deals"]);
  assert.equal(cfg.modules[1].entry_url, "https://crm.acme.test/deals");
  assert.deepEqual(cfg.target.api_urls, ["https://api.acme.test/v2"]);
  assert.deepEqual(cfg.api.specs, ["https://api.acme.test/openapi.json"]);
  assert.deepEqual(cfg.knowledge.references, ["https://crm.acme.test", "https://wiki.acme.test/crm"], "links go to knowledge, the target first");
  assert.deepEqual(cfg.feature.requirement_docs, ["docs/prd.md", "docs/plan.xlsx"], "local files are requirement docs, so their content is tracked");
  assert.ok(d.warnings.some((w) => /plan\.xlsx/.test(w)), "an Office file is flagged as unreadable");
  assert.equal(cfg.authorizations.authenticated_crawl, true);
  assert.equal(cfg.authorizations.session_state_file, "playwright-tests/acme-crm/.auth/state.json");
  assert.ok(d.next.some((n) => n.startsWith("make login PRODUCT=acme-crm")));
  // `make login` edits these two lines with sed; their shape must stay.
  const text = readFile(path.join(root, d.file), "utf8");
  assert.match(text, /^  authenticated_crawl: true$/m);
  assert.match(text, /^  session_state_file: .+$/m);
  assert.match(text, /^  url: https:\/\/crm\.acme\.test$/m);
  const again = draftRunConfig(answers, { root });
  assert.ok(again.errors.some((e) => /already exists/.test(e)), "never overwrites a config");
});

test("interview asks only what is needed and names every problem", () => {
  const root = interviewRoot();
  const minimal = buildDraft({ name: "Acme", visibility: "public", url: "https://acme.test", modules: ["Home"] }, { root });
  assert.deepEqual(minimal.errors, []);
  assert.equal(minimal.config.authorizations.authenticated_crawl, false);
  assert.deepEqual(minimal.next, []);
  const bad = buildDraft({ name: "", visibility: "maybe", url: "acme", modules: [], references: ["docs/missing.pdf"] }, { root });
  for (const re of [/^name:/, /^visibility:/, /^url:/, /^modules:/, /file not found: docs\/missing\.pdf/]) assert.ok(bad.errors.some((e) => re.test(e)), String(re));
  const internal = buildDraft({ name: "Acme", visibility: "internal", url: "https://acme.test", modules: ["Home"] }, { root });
  assert.ok(internal.errors.some((e) => /^description:/.test(e)), "an internal product with nothing to read is asked for a description");
  assert.equal(slugify("  Çrm & Sales!  "), "crm-sales");
  assert.equal(buildDraft({ ...answers, modules: ["Product"] }, { root }).config.modules[0].slug, "product-module", "'product' is reserved");
});

test("about is validated and defaults to a public product", () => {
  assert.equal(validateRunConfig(base).normalized.about.visibility, "public");
  const { errors } = validateRunConfig({ ...base, about: { visibility: "secret", owner: "x" } });
  assert.ok(errors.some((e) => e.startsWith("about.visibility")));
  assert.ok(errors.includes("about.owner: unknown key"));
});

// ---- selectable steps and the human's own test case files ----
import { setRunConfig, parseSetArgs } from "./run-config.mjs";
import { applyChanges, rewriteKeys } from "./lib/run-config-draft.mjs";
import { repoRoot } from "./lib/contract.mjs";

test("steps: absent = all six; a subset of the six slugs, no duplicates; an unknown slug names the allowed set", () => {
  assert.deepEqual(validateRunConfig(base).normalized.steps, ["explore", "clarifications", "testcases", "playwright-ui", "playwright-api", "k6"]);
  assert.deepEqual(validateRunConfig({ ...base, steps: ["testcases", "k6"] }).normalized.steps, ["testcases", "k6"]);
  assert.ok(validateRunConfig({ ...base, steps: ["explore", "load"] }).errors.includes("steps: unknown step 'load' (one of explore, clarifications, testcases, playwright-ui, playwright-api, k6)"));
  assert.ok(validateRunConfig({ ...base, steps: ["k6", "k6"] }).errors.includes("steps: duplicate k6"));
  for (const bad of [[], "explore", [1]]) assert.ok(validateRunConfig({ ...base, steps: bad }).errors.some((e) => e.startsWith("steps: must be a non-empty list")), JSON.stringify(bad));
});

test("test case files must exist (reported, not guessed); null means none; types are a subset of ui, api, performance", () => {
  const root = interviewRoot();
  const ok = validateRunConfig({ ...base, modules: [{ ...base.modules[0], testcases_file: "docs/prd.md" }], testcases: { import: null, types: ["ui", "performance"] } }, { root });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.normalized.testcases, { output_format: "gherkin", max_cases: 200, import: null, types: ["ui", "performance"] });
  const { errors } = validateRunConfig({ ...base, modules: [{ ...base.modules[0], testcases_file: "docs/cases.feature" }], testcases: { import: 3, types: ["ui", "ui", "load"], formats: [] } }, { root });
  assert.ok(errors.includes("modules[0].testcases_file: file not found: docs/cases.feature (give the path from the repo root, or an absolute path)"));
  assert.ok(errors.includes("testcases.import: must be a file path (from the repo root, or absolute) or null"));
  assert.ok(errors.some((e) => e.startsWith("testcases.types: a non-empty list of distinct [ui,api,performance]")));
  assert.ok(errors.includes("testcases.formats: unknown key"));
});

test("the interview's draft carries the steps, the human's test case files and the case types", () => {
  const root = interviewRoot();
  const d = draftRunConfig({ ...answers, steps: ["explore", "testcases"], testcases_files: { Deals: "docs/prd.md" }, testcases_import: "docs/prd.md", testcases_types: ["ui", "api"] }, { root });
  assert.deepEqual(d.errors, []);
  const cfg = yaml.load(readFile(path.join(root, d.file), "utf8"));
  assert.deepEqual(cfg.steps, ["explore", "testcases"]);
  assert.equal(cfg.modules[1].testcases_file, "docs/prd.md");
  assert.equal(cfg.modules[0].testcases_file, undefined);
  assert.deepEqual(cfg.testcases, { import: "docs/prd.md", types: ["ui", "api"] });
  const bad = draftRunConfig({ ...answers, name: "Acme Two", steps: ["explore", "nope"], modules: [{ name: "Contacts", testcases_file: "docs/missing.csv" }], testcases_files: { Billing: "docs/prd.md" } }, { root });
  assert.ok(bad.errors.some((e) => /^testcases_files\.Billing: not one of the modules \(contacts\)/.test(e)), String(bad.errors));
  assert.ok(!has(path.join(root, "config", "acme-two.yaml")), "nothing is written on an error");
  const bad2 = draftRunConfig({ ...answers, name: "Acme Three", steps: ["explore", "nope"], modules: [{ name: "Contacts", testcases_file: "docs/missing.csv" }] }, { root });
  for (const re of [/^steps: unknown step 'nope'/, /^modules\[0\]\.testcases_file: file not found: docs\/missing\.csv/]) assert.ok(bad2.errors.some((e) => re.test(e)), String(re));
  assert.equal(buildDraft({ ...answers, modules: [{ name: "Deals", testcases_file: "docs/prd.md" }] }, { root }).config.modules[0].testcases_file, "docs/prd.md");
});

// The example config, copied into a throwaway root that has the files the tests point at.
const exampleRoot = () => {
  const root = interviewRoot();
  writeFile(path.join(root, "docs", "contacts.feature"), "Feature: c");
  writeFile(path.join(root, "docs", "all cases.csv"), "id,module");
  const file = path.join(root, "config", "acme-crm.yaml");
  mkdir(path.dirname(file), { recursive: true });
  writeFile(file, readFile(path.join(repoRoot, "config", "run-config.example.yaml"), "utf8"));
  return { root, file };
};

test("the example config documents every new key and validates", () => {
  const text = readFile(path.join(repoRoot, "config", "run-config.example.yaml"), "utf8");
  for (const re of [/^steps: \[explore, clarifications, testcases, playwright-ui, playwright-api, k6\]$/m, /^    testcases_file: null +# /m, /^  import: null +# /m, /^  # types: \[ui, api, performance\]/m]) assert.match(text, re);
  assert.deepEqual(validateRunConfig(yaml.load(text)).errors, []);
});

test("set rewrites only steps, a module's testcases_file and testcases.import/types: every other byte and comment stays", () => {
  const { root, file } = exampleRoot();
  const before = readFile(file, "utf8");
  const r = setRunConfig(file, { steps: ["explore", "testcases", "playwright-ui"], testcasesFiles: { contacts: "docs/contacts.feature", deals: "docs/contacts.feature" }, testcasesImport: "docs/all cases.csv", testcasesTypes: ["ui", "api"] }, { root });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.changed, ["steps", "modules[contacts].testcases_file", "modules[deals].testcases_file", "testcases.import", "testcases.types"]);
  const after = readFile(file, "utf8");
  const a = before.split(/\r?\n/);
  const b = after.split(/\r?\n/);
  assert.deepEqual(a.filter((l) => !b.includes(l)), [
    "steps: [explore, clarifications, testcases, playwright-ui, playwright-api, k6]",
    "    testcases_file: null        # optional: your own test cases for this module (a path from the repo root), imported",
    "  import: null                  # optional: one file of your own test cases for every module; each case names its",
  ], "only the three replaced lines are gone");
  assert.deepEqual(b.filter((l) => !a.includes(l)), [
    "steps: [explore, testcases, playwright-ui]",
    "    testcases_file: docs/contacts.feature # optional: your own test cases for this module (a path from the repo root), imported",
    "    testcases_file: docs/contacts.feature",
    '  import: "docs/all cases.csv"  # optional: one file of your own test cases for every module; each case names its',
    "  types: [ui, api]",
  ], "replaced lines keep their comment, at its column when it fits; new keys are inserted");
  assert.equal(b.length, a.length + 2);
  const cfg = yaml.load(after);
  assert.deepEqual(cfg.modules.map((m) => m.testcases_file), ["docs/contacts.feature", "docs/contacts.feature"]);
  assert.deepEqual(validateRunConfig(cfg, { root }).errors, []);
  // the same answer again changes nothing
  assert.deepEqual(setRunConfig(file, { steps: ["explore", "testcases", "playwright-ui"] }, { root }).errors, []);
  assert.equal(readFile(file, "utf8"), after);
  // an empty file value clears it back to null
  assert.deepEqual(setRunConfig(file, { testcasesFiles: { deals: null } }, { root }).errors, []);
  assert.equal(yaml.load(readFile(file, "utf8")).modules[1].testcases_file, null);
});

test("set validates first and writes nothing on an error; a config without the keys gets them inserted; CRLF stays", () => {
  const { root, file } = exampleRoot();
  const before = readFile(file, "utf8");
  for (const [changes, re] of [
    [{ steps: ["explore", "smoke"] }, /^steps: unknown step 'smoke'/],
    [{ testcasesFiles: { contacts: "docs/nope.feature" } }, /^modules\[0\]\.testcases_file: file not found/],
    [{ testcasesFiles: { billing: "docs/contacts.feature" } }, /^--testcases-file billing: not a module of this config \(contacts, deals\)/],
    [{ testcasesTypes: ["load"] }, /^testcases\.types:/],
  ]) {
    const r = setRunConfig(file, changes, { root });
    assert.ok(r.errors.some((e) => re.test(e)), `${String(re)}: ${r.errors}`);
  }
  assert.equal(readFile(file, "utf8"), before, "nothing written");

  const plain = path.join(root, "config", "plain.yaml");
  writeFile(plain, ["# my product", "product: acme", "target:", "  url: https://app.acme.test", "modules:", "  - slug: contacts   # the first", "    name: Contacts", "    nav_path: [Contacts]", ""].join("\r\n"));
  assert.deepEqual(setRunConfig(plain, { steps: ["explore"], testcasesFiles: { contacts: "docs/contacts.feature" }, testcasesTypes: ["ui"] }, { root }).errors, []);
  assert.equal(readFile(plain, "utf8"), ["# my product", "product: acme", "steps: [explore]", "target:", "  url: https://app.acme.test", "modules:", "  - slug: contacts   # the first", "    testcases_file: docs/contacts.feature", "    name: Contacts", "    nav_path: [Contacts]", "", "testcases:", "  types: [ui]", ""].join("\r\n"));

  // a block-style steps list is replaced whole
  assert.equal(rewriteKeys("product: a\nsteps:\n  - explore\n  - k6\n# next\ntarget: x\n", { steps: ["k6"] }).text, "product: a\nsteps: [k6]\n# next\ntarget: x\n");
  // V-6: a one-line {...} module item gets the key inside its braces; every other byte stays
  const flow = path.join(root, "config", "flow.yaml");
  const flowText = "product: acme   # mine\ntarget: {url: 'https://app.acme.test'}\nmodules:\n  - {slug: contacts, name: Contacts, nav_path: [Contacts]}   # first\n  - {slug: deals, name: Deals, testcases_file: 'docs/contacts.feature', nav_path: [Deals]}\n";
  writeFile(flow, flowText);
  assert.deepEqual(setRunConfig(flow, { testcasesFiles: { contacts: "docs/contacts.feature" } }, { root }).errors, []);
  const flowAfter = readFile(flow, "utf8");
  assert.equal(flowAfter, flowText.replace("nav_path: [Contacts]}", "nav_path: [Contacts], testcases_file: docs/contacts.feature}"), "only the item's braces change");
  assert.deepEqual(setRunConfig(flow, { testcasesFiles: { deals: "docs/contacts.feature" } }, { root }).errors, []);
  assert.equal(readFile(flow, "utf8"), flowAfter.replace("testcases_file: 'docs/contacts.feature'", "testcases_file: docs/contacts.feature"), "an existing value is replaced in place");
  assert.deepEqual(setRunConfig(flow, { testcasesFiles: { deals: null } }, { root }).errors, []);
  assert.equal(yaml.load(readFile(flow, "utf8")).modules[1].testcases_file, null);
  // a {...} item over several lines is reported with the precise fallback; nothing is written
  const multi = path.join(root, "config", "multi.yaml");
  const multiText = "product: acme\ntarget: {url: 'https://app.acme.test'}\nmodules:\n  - {slug: contacts,\n     name: Contacts, nav_path: [Contacts]}\n";
  writeFile(multi, multiText);
  const refused = setRunConfig(multi, { testcasesFiles: { contacts: "docs/contacts.feature" } }, { root });
  assert.match(refused.errors[0], /no item with slug contacts that set can rewrite .* Add `testcases_file: docs\/contacts\.feature` to that module's item by hand, or use --testcases-import <path> with the cases tagged @module:contacts/);
  assert.equal(readFile(multi, "utf8"), multiText);
  assert.equal(applyChanges({ modules: [] }, { testcasesFiles: { x: null } }).errors.length, 1);
});

test("set's arguments: lists, module=path pairs, an empty value clears; nothing to set is an error", () => {
  assert.deepEqual(parseSetArgs(["--steps", "explore, k6", "--testcases-file", "contacts=docs/c.feature", "--testcases-file", "deals=", "--testcases-import", "", "--testcases-types", "ui,api"]).changes, { steps: ["explore", "k6"], testcasesFiles: { contacts: "docs/c.feature", deals: null }, testcasesImport: null, testcasesTypes: ["ui", "api"] });
  assert.match(parseSetArgs(["--testcases-file", "docs/c.feature"]).errors[0], /expected <module>=<path>/);
  assert.match(parseSetArgs([]).errors[0], /^nothing to set/);
});
