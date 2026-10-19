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
