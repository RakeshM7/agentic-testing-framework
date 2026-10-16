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
