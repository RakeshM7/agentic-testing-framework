import test from "node:test";
import assert from "node:assert/strict";
import { validateRunConfig, matchAnswer, deriveSlug, FULL_PRODUCT_SLUG } from "./run-config.mjs";

test("rejects mode: fullrun", () => {
  const { errors } = validateRunConfig({ target: { url: "https://a.example.com" }, authorizations: { mode: "fullrun" } });
  assert.match(errors[0], /authorizations\.mode/);
});
test("defaults to readonly and no auto-invoke", () => {
  const { normalized } = validateRunConfig({ target: { url: "https://a.example.com" } });
  assert.equal(normalized.authorizations.mode, "readonly");
  assert.equal(normalized.feedback_loop.auto_invoke_implementor, false);
});
test("slug from hostname", () => assert.equal(deriveSlug("https://Eventhub.Rahul.com/x"), "eventhub"));
test("matcher normalizes punctuation", () => {
  const a = [{ match: "duplicate-email", answer: "x" }];
  assert.equal(matchAnswer(a, "What about Duplicate email handling?").answer, "x");
  assert.equal(matchAnswer(a, "Unrelated"), null);
});

const base = { target: { url: "https://a.example.com" } };
test("full-product slug fills defaults and flags the feature", () => {
  const { errors, normalized } = validateRunConfig({ ...base, feature: { slug: FULL_PRODUCT_SLUG }, full_product: { per_module: { maxPages: 60 } } });
  assert.deepEqual(errors, []);
  assert.equal(normalized.feature.full_product, true);
  assert.equal(normalized.full_product.explore_concurrency, 1);
  assert.equal(normalized.full_product.per_module.maxPages, 60);
  assert.equal(normalized.full_product.per_module.maxDepth, 4);
  assert.deepEqual(normalized.full_product.modules.exclude, []);
});
test("full-product defaults apply even with no full_product block", () => {
  const { normalized } = validateRunConfig({ ...base, feature: { slug: "full-product" } });
  assert.equal(normalized.full_product.max_parallel_tracks, 4);
});
test("ordinary feature slug is not full-product", () => {
  const { normalized } = validateRunConfig({ ...base, feature: { slug: "checkout" } });
  assert.equal(normalized.feature.full_product, undefined);
  assert.equal(normalized.full_product, undefined);
});
test("full_product block rejected on a non-full-product slug", () => {
  const { errors } = validateRunConfig({ ...base, feature: { slug: "checkout" }, full_product: {} });
  assert.match(errors[0], /only valid when feature\.slug/);
});
test("full_product rejects bad values", () => {
  const { errors } = validateRunConfig({
    ...base,
    feature: { slug: "full-product" },
    full_product: { explore_concurrency: 0, modules: { include: "deals" } },
  });
  assert.equal(errors.length, 2);
});

test("target.product defaults to the slug; explicit product wins; must be kebab-case", () => {
  assert.equal(validateRunConfig({ target: { url: "https://acme-crm.example.com" } }).normalized.target.product, "acme-crm");
  assert.equal(validateRunConfig({ target: { url: "https://x.example.com", slug: "s" } }).normalized.target.product, "s");
  assert.equal(validateRunConfig({ target: { url: "https://x.example.com", product: "freshsales" } }).normalized.target.product, "freshsales");
  assert.match(validateRunConfig({ target: { url: "https://x.example.com", product: "Fresh Sales" } }).errors[0], /target\.product/);
});
test("clarification limits default to 5/5 and validate", () => {
  const ok = validateRunConfig({ ...base, feature: { slug: "full-product" }, full_product: { clarifications: { csv_threshold: 8 } } });
  assert.deepEqual(ok.normalized.full_product.clarifications, { csv_threshold: 8, max_rounds: 5 });
  assert.deepEqual(validateRunConfig({ ...base, feature: { slug: "full-product" } }).normalized.full_product.clarifications, { csv_threshold: 5, max_rounds: 5 });
  const bad = validateRunConfig({ ...base, feature: { slug: "full-product" }, full_product: { clarifications: { max_rounds: 0 } } });
  assert.match(bad.errors[0], /max_rounds/);
});
