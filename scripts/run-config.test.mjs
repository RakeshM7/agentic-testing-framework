import test from "node:test";
import assert from "node:assert/strict";
import { validateRunConfig, matchAnswer, deriveSlug } from "./run-config.mjs";

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
