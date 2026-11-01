// intentArgv (C5): the Cockpit's intents as atf commands, and the gated commands.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GATED_COMMANDS, intentArgv } from "../src/cockpit-actions.js";

const base = { product: "acme", module: "contacts" };

test("intentArgv: the C5 table", () => {
  for (const i of ["explore", "testcases", "automate", "k6"]) assert.deepEqual(intentArgv(i, { ...base, environment: "default" }), [i, "acme", "--module", "contacts"]);
  assert.deepEqual(intentArgv("heal", { ...base, environment: "default", healStage: "playwright-ui" }), ["resume", "acme", "--stage", "playwright-ui", "--module", "contacts"]);
});

test("intentArgv: a named environment adds --env", () => {
  assert.deepEqual(intentArgv("explore", { ...base, environment: "staging" }), ["explore", "acme", "--module", "contacts", "--env", "staging"]);
  assert.deepEqual(intentArgv("heal", { ...base, environment: "staging", healStage: "k6" }), ["resume", "acme", "--stage", "k6", "--module", "contacts", "--env", "staging"]);
  assert.deepEqual(intentArgv("k6", base), ["k6", "acme", "--module", "contacts"], "no environment: the default");
});

test("intentArgv: refuses an unknown intent, a heal without its stage, and a missing product or module", () => {
  assert.throws(() => intentArgv("delete", base), /unknown intent/);
  assert.throws(() => intentArgv("heal", base), /heal needs the stage/);
  assert.throws(() => intentArgv("explore", { product: "acme" }), /product and a module/);
  assert.throws(() => intentArgv("explore", { module: "m" }), /product and a module/);
});

test("GATED_COMMANDS cover every intent's command", () => {
  assert.deepEqual(GATED_COMMANDS, ["run", "resume", "explore", "testcases", "automate", "k6"]);
  for (const i of ["explore", "testcases", "automate", "k6"]) assert.ok(GATED_COMMANDS.includes(intentArgv(i, base)[0]));
  assert.ok(GATED_COMMANDS.includes(intentArgv("heal", { ...base, healStage: "k6" })[0]));
});
