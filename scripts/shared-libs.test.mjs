// The helpers every script-built agent shares (D-049): stable ids, citations, the verified stamp, the coverage ledger.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CITATION_KINDS, CITATION_PREFIXES, citationProblem } from "./lib/citations.mjs";
import { STATUSES, applyBudget, createLedger } from "./lib/coverage.mjs";
import { assignIds } from "./lib/registry.mjs";
import { stampVerified, unverifiedReason } from "./lib/verified.mjs";
import { put } from "./test-helpers.mjs";

const tmp = () => mkdtempSync(path.join(tmpdir(), "atf-shared-"));

test("registry: ids follow key order, survive rebuilds, and a gone key's id is never reused", () => {
  const file = path.join(tmp(), "registry.json");
  const opts = (runId) => ({ module: "contacts", runId, prefix: "EP", field: "endpoints" });
  const ids = (reg) => Object.fromEntries(Object.entries(reg.endpoints).map(([k, e]) => [k, e.id]));

  const r1 = assignIds(file, ["GET /b", "GET /a", "POST /a"], opts("run-1"));
  assert.deepEqual(ids(r1), { "GET /a": "EP-contacts-1", "GET /b": "EP-contacts-2", "POST /a": "EP-contacts-3" }, "assigned in key order, not input order");

  const r2 = assignIds(file, ["POST /a", "GET /b", "GET /a"], opts("run-2"));
  assert.deepEqual(ids(r2), ids(r1), "a rebuild keeps every id");
  assert.equal(r2.endpoints["GET /a"].firstSeen, "run-1");
  assert.equal(r2.endpoints["GET /a"].lastSeen, "run-2");

  const r3 = assignIds(file, ["GET /a", "POST /a", "DELETE /a"], opts("run-3"));
  assert.equal(r3.endpoints["GET /b"].status, "gone");
  assert.equal(r3.endpoints["GET /b"].id, "EP-contacts-2", "a gone key keeps its id");
  assert.equal(r3.endpoints["DELETE /a"].id, "EP-contacts-4", "a new key never takes a gone key's id");

  const r4 = assignIds(file, ["GET /a", "GET /b"], opts("run-4"));
  assert.equal(r4.endpoints["GET /b"].status, "active");
  assert.equal(r4.endpoints["GET /b"].id, "EP-contacts-2", "a key that comes back gets its old id");
  assert.equal(r4.next, 5);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), r4, "the registry on disk is what was returned");
});

test("registry: the map field, prefix and id format are options", () => {
  const file = path.join(tmp(), "plan-registry.json");
  const reg = assignIds(file, ["k2", "k1"], { module: "deals", runId: "r", prefix: "API", field: "scenarios" });
  assert.deepEqual(Object.fromEntries(Object.entries(reg.scenarios).map(([k, e]) => [k, e.id])), { k1: "API-deals-1", k2: "API-deals-2" });
  const custom = assignIds(path.join(tmp(), "r.json"), ["x"], { module: "deals", runId: "r", prefix: "K6", field: "workloads", format: ({ prefix, n }) => `${prefix}_${String(n).padStart(3, "0")}` });
  assert.equal(custom.workloads.x.id, "K6_001");
});

test("registry: field and prefix are required; nothing is written without them", () => {
  const file = path.join(tmp(), "registry.json");
  assert.throws(() => assignIds(file, ["x"], { module: "m", runId: "r", prefix: "EP" }), /`field`.*is required/);
  assert.throws(() => assignIds(file, ["x"], { module: "m", runId: "r", field: "endpoints" }), /`prefix`.*is required/);
  assert.throws(() => assignIds(file, ["x"]), /is required/);
  assert.equal(existsSync(file), false);
});

test("citations: each prefix holds when its target exists and is refused when it is missing", () => {
  const root = tmp();
  const productDir = path.join(root, "acme");
  const moduleDir = path.join(productDir, "modules", "contacts");
  put(root, "acme/knowledge/modules/contacts/notes.md", "x");
  put(root, "acme/modules/contacts/api/sources/openapi.json", "{}");
  put(root, "acme/modules/contacts/explore/flows.md", "x");
  const ctx = { rows: [{ id: "contacts-1", answer: "401" }, { id: "contacts-2", answer: " " }], cases: new Map([["TC-contacts-1", {}]]), productDir, moduleDir };

  assert.deepEqual(CITATION_KINDS, ["clarification", "testcase", "knowledge", "spec", "observation"]);
  assert.deepEqual(CITATION_PREFIXES, CITATION_KINDS.map((k) => `${k}:`));
  for (const ok of ["clarification:contacts-1", "testcase:TC-contacts-1", "knowledge:modules/contacts/notes.md#owners", "spec:sources/openapi.json", "observation:explore/flows.md"]) assert.equal(citationProblem(ok, ctx), null, ok);
  const refused = {
    "clarification:contacts-9": /no such row/,
    "clarification:contacts-2": /not answered yet/,
    "testcase:TC-contacts-9": /no such test case/,
    "knowledge:missing.md": /no such file under knowledge/,
    "spec:sources/missing.json": /no such file under api/,
    "observation:explore/missing.md": /no such file under the module/,
    "web:https://example.test": /a citation is clarification:<id>/,
  };
  for (const [c, why] of Object.entries(refused)) assert.match(citationProblem(c, ctx), why, c);
  assert.equal(citationProblem("testcase:TC-contacts-1", { ...ctx, cases: new Set(["TC-contacts-1"]) }), null, "cases may be a Set");
  // a network-inventory entry by its stable NI id must exist; the older #/<index> form only needs the file (D-052)
  put(root, "acme/modules/contacts/explore/network-inventory.json", JSON.stringify([{ id: "NI-contacts-3", method: "GET", pathTemplate: "/x" }]));
  assert.equal(citationProblem("observation:explore/network-inventory.json#NI-contacts-3", ctx), null);
  assert.equal(citationProblem("observation:explore/network-inventory.json#/0", ctx), null);
  assert.match(citationProblem("observation:explore/network-inventory.json#NI-contacts-9", ctx), /no entry NI-contacts-9/);
});

test("verified: a stamp holds until an input changes, then gives a reason", () => {
  const dir = tmp();
  const inputs = { plan: path.join(dir, "plan.json"), catalogue: path.join(dir, "catalogue.json") };
  writeFileSync(inputs.plan, "[1]");
  writeFileSync(inputs.catalogue, "[2]");
  const stamp = stampVerified(inputs);
  assert.deepEqual(Object.keys(stamp), ["plan", "catalogue"], "field names are the input names, in order");
  assert.match(stamp.plan, /^[0-9a-f]{64}$/);
  assert.equal(unverifiedReason(stamp, inputs), null);
  assert.match(unverifiedReason(undefined, inputs), /never passed/);
  assert.equal(unverifiedReason(null, inputs, { unstamped: "not checked" }), "not checked");

  writeFileSync(inputs.catalogue, "[3]");
  assert.equal(unverifiedReason(stamp, inputs), "changed after its check: catalogue");
  assert.equal(unverifiedReason(stamp, inputs, { changed: "stale" }), "stale");
  assert.equal(stampVerified({ gone: path.join(dir, "missing.json") }).gone, null, "a missing input stamps null");
});

test("coverage: every status, problems, and budget overflow deferred instead of dropped", () => {
  const led = createLedger({ reasons: ["not_testable", "out_of_scope"] });
  for (const id of ["op:1", "op:2", "op:3", "op:4", "op:5"]) led.addItem(id);
  led.resolve("op:1", { status: "mapped", refs: ["API-m-1"] });
  led.resolve("op:2", { status: "excluded", reason: "not_testable", detail: "needs a paid plan" });
  led.resolve("op:3", { status: "deferred", reason: "budget", detail: "over 300" });
  assert.deepEqual(STATUSES, ["mapped", "excluded", "pending", "deferred"]);
  assert.deepEqual(led.summary(), { total: 5, mapped: 1, excluded: 1, pending: 2, deferred: 1 });
  assert.deepEqual(led.problems(), ["op:4: unresolved", "op:5: unresolved"]);

  led.resolve("op:4", { status: "excluded", detail: "no reason given" });
  led.resolve("op:5", { status: "excluded", reason: "because", detail: "x" });
  led.addItem("op:1");
  led.resolve("op:3", { status: "deferred", detail: "no reason" });
  assert.deepEqual(led.problems().sort(), ["op:1: listed 2 times", "op:1: unresolved", "op:3: deferred without reason 'budget'", "op:4: excluded without a reason", "op:5: unknown exclusion reason 'because'"].sort());
  assert.throws(() => led.resolve("op:1", { status: "dropped" }), /unknown coverage status/);
  assert.throws(() => led.resolve("op:9", { status: "mapped" }), /not in the ledger/);

  const b = createLedger();
  const prio = { a: 3, b: 1, c: 2, d: 1, e: 1 };
  for (const id of Object.keys(prio)) b.addItem(id, { prio: prio[id] });
  b.resolve("a", { status: "mapped", refs: ["X-1"] });
  b.resolve("e", { status: "excluded", reason: "out_of_scope", detail: "x" });
  const { kept, deferred } = applyBudget(b.items, 2, (i) => i.prio);
  assert.deepEqual(kept.map((i) => i.id), ["b", "d"], "best rank first, ties in order; excluded items don't count");
  assert.deepEqual(deferred.map((i) => i.id), ["c", "a"]);
  assert.equal(b.items.length, 5, "nothing is dropped");
  assert.deepEqual(b.summary(), { total: 5, mapped: 0, excluded: 1, pending: 2, deferred: 2 });
  assert.deepEqual(b.items.find((i) => i.id === "a"), { prio: 3, id: "a", status: "deferred", reason: "budget", detail: "over the budget of 2" });
  assert.deepEqual(b.problems(), ["b: unresolved", "d: unresolved"], "deferred: budget is not a problem; pending still is");
});

test("coverage: a deferred item keeps no refs, so nothing reads it as covered", () => {
  const led = createLedger();
  for (const id of ["x", "y"]) led.addItem(id);
  led.resolve("x", { status: "mapped", refs: ["API-m-1"] });
  led.resolve("y", { status: "mapped", refs: ["API-m-2"] });
  const { deferred } = applyBudget(led.items, 1, (i) => (i.id === "x" ? 0 : 1));
  assert.deepEqual(deferred.map((i) => i.id), ["y"]);
  assert.equal("refs" in led.items[1], false);
  assert.deepEqual(led.items[0].refs, ["API-m-1"], "a kept item keeps its refs");
});

test("coverage: applyBudget refuses a budget that is not an integer >= 0, and changes nothing", () => {
  const led = createLedger();
  led.addItem("x");
  for (const bad of [NaN, -1, 1.5, "2", undefined, Infinity]) assert.throws(() => applyBudget(led.items, bad, () => 0), /budget must be an integer >= 0/, String(bad));
  assert.equal(led.items[0].status, "pending");
  assert.deepEqual(applyBudget(led.items, 0, () => 0).deferred.map((i) => i.id), ["x"], "a budget of 0 is valid");
});
