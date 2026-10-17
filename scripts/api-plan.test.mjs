// The API test plan is script-built from the endpoint catalogue (D-046): a fixed rule catalogue, stable ids, sourced
// expectations, a coverage ledger with nothing pending, and an overlay that can only annotate and add cited scenarios.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { main } from "./api-plan.mjs";
import { next, step } from "./orchestration.mjs";
import { gate } from "./gate.mjs";
import { planPaths, planUnverified } from "./lib/api-plan.mjs";
import { csvPath, readRows, record } from "./lib/clarifications.mjs";
import { paths } from "./lib/contract.mjs";
import { apiPaths, build as buildCatalogue, saveSource, writeJson } from "./lib/endpoints.mjs";
import { INTROSPECTION_QUERY } from "./lib/graphql.mjs";
import { validateRunConfig } from "./run-config.mjs";
import { put, startRun } from "./test-helpers.mjs";

const MOD = "artifacts/acme/modules/contacts";
const CONTACT = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", readOnly: true },
    name: { type: "string", minLength: 1, maxLength: 100 },
    email: { type: "string", format: "email" },
    status: { type: "string", enum: ["active", "lead"] },
    phone: { type: "string", pattern: "^\\+[0-9]{6,15}$" },
    secret: { type: "string", writeOnly: true },
  },
};
const SPEC = {
  openapi: "3.0.3",
  info: { title: "Acme" },
  servers: [{ url: "https://app.acme.test/api/v1" }],
  security: [{ session: [] }],
  components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "sid" } }, schemas: { Contact: CONTACT } },
  paths: {
    "/contacts": {
      get: {
        tags: ["Contacts"],
        parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }, { in: "query", name: "per_page", schema: { type: "integer", minimum: 1, maximum: 100 } }],
        responses: { 200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Contact" } } } } } },
      },
      post: {
        tags: ["Contacts"],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
        responses: { 201: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, 422: { content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" } } } } } }, 409: { description: "duplicate" } },
      },
    },
    "/contacts/{contactId}": {
      parameters: [{ in: "path", name: "contactId", required: true, schema: { type: "integer" } }],
      get: { tags: ["Contacts"], responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, 404: { description: "not found" } } },
      put: { tags: ["Contacts"], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, responses: { 200: { description: "ok" } } },
      patch: { tags: ["Contacts"], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, responses: { 200: { description: "ok" } } },
      delete: { tags: ["Contacts"], responses: { 204: { description: "gone" }, 500: { description: "boom" } } },
    },
    "/contacts/tags": {
      post: { tags: ["Contacts"], requestBody: { content: { "application/json": { schema: { type: "object", properties: { label: { type: "string" } } } } } }, responses: { 201: { description: "ok" }, 402: { description: "plan limit" } } },
    },
  },
};
const FEATURE = ["Feature: Contacts", "  @TC-contacts-1 @p1 @api", "  Scenario: create a contact via the API", "    Given x", "  @TC-contacts-2 @p2 @functional", "  Scenario: list contacts", "    Given y", ""].join("\n");

function setup({ spec = SPEC, identities, budget, graphql } = {}) {
  const extra = [];
  if (budget) extra.push(`api: {plan_budget: ${budget}}`);
  const { root } = startRun({ extra });
  const p = paths("acme", root);
  if (identities) {
    const cfg = JSON.parse(readFileSync(p.configFile, "utf8"));
    cfg.authorizations.identities = identities;
    writeFileSync(p.configFile, JSON.stringify(cfg));
  }
  const ap = apiPaths(p.productDir, "contacts");
  if (spec) saveSource(ap, { kind: "openapi", location: "https://app.acme.test/openapi.json", content: spec, version: "3.0.3", status: "ok" });
  if (graphql) saveSource(ap, { kind: "graphql", location: "https://app.acme.test/graphql", content: graphql, getSupported: true, status: "ok" });
  put(root, `${MOD}/explore/network-inventory.json`, JSON.stringify([{ method: "GET", pathTemplate: "/api/v1/contacts", statusCodes: [200], requestKeys: [], responseKeys: ["id", "name"], pages: ["/contacts"] }]));
  put(root, `${MOD}/testcases/contacts-testcases.feature`, FEATURE);
  const cfg = JSON.parse(readFileSync(p.configFile, "utf8"));
  assert.deepEqual(buildCatalogue(ap, { module: "contacts", cfg, runId: "acme-run-1" }).problems, []);
  const pp = planPaths(p.productDir, "contacts");
  const plan = () => JSON.parse(readFileSync(pp.plan, "utf8"));
  const cov = () => JSON.parse(readFileSync(pp.coverage, "utf8"));
  const overlay = (o) => writeJson(pp.overlay, o);
  const run = (cmd) => main([cmd, "acme", "contacts"], { root });
  const ep = (method, p_) => JSON.parse(readFileSync(ap.catalogue, "utf8")).find((e) => e.method === method && e.path === p_).id;
  return { root, p, pp, plan, cov, overlay, run, ep };
}
const LINK_TC = (s) => ({ testcases: { "TC-contacts-1": [s.plan().find((x) => x.key.endsWith("POST /api/v1/contacts|happy-path")).id] }, exclude: [{ match: "status:*:402", reason: "not_testable", detail: "needs an account at its plan limit" }] });

test("rule catalogue: one happy path per operation, one fault per negative, 2-value boundaries, readOnly only as mass assignment", async () => {
  const s = setup();
  const r = await s.run("build");
  assert.deepEqual(r.out.problems, []);
  const plan = s.plan();
  const post = s.ep("POST", "/api/v1/contacts");
  const on = (id) => plan.filter((x) => x.endpoint === id);
  for (const e of JSON.parse(readFileSync(path.join(s.p.productDir, "modules/contacts/api/discovered-endpoints.json"), "utf8"))) assert.ok(on(e.id).some((x) => x.rule === "happy-path"), `${e.id} has a happy path (TCL2)`);
  const field = (ptr, rule, kind) => on(post).find((x) => x.key.endsWith(`|field|${ptr}:${rule}:${kind}`));
  assert.deepEqual(field("/name", "maxLength", "invalid").request.mutation, { in: "body", pointer: "/name", op: "length", value: 101 });
  assert.deepEqual(field("/name", "maxLength", "valid").request.mutation.value, 100);
  assert.deepEqual(field("/name", "minLength", "invalid").request.mutation.value, 0);
  assert.equal(field("/name", "required", "invalid").request.mutation.op, "remove");
  assert.equal(field("/status", "enum", "invalid").request.mutation.value, "atf-not-in-enum");
  assert.deepEqual(field("/status", "enum", "valid").request.mutation.values, ["active", "lead"]);
  assert.equal(field("/phone", "pattern", "invalid").request.mutation.value, "!");
  assert.ok(field("/", "additionalProperties", "invalid"), "additionalProperties:false gets an unknown-property negative");
  for (const x of plan.filter((x) => x.request.mutation)) assert.equal(typeof x.request.mutation.op, "string", "single fault: exactly one mutation");
  assert.equal(on(post).filter((x) => x.key.includes("|field|/id:")).length, 0, "no validation negatives on a readOnly field");
  const mass = on(post).find((x) => x.rule === "mass-assignment");
  assert.deepEqual(mass.expect.rules[0], { assert: "ignored-if-accepted", pointer: "/id", value: 999999, source: "spec" });
  const read = on(s.ep("GET", "/api/v1/contacts/{contactId}")).find((x) => x.rule === "happy-path");
  assert.deepEqual(read.expect.rules, [{ assert: "absent", pointer: "/secret", source: "spec" }], "writeOnly fields must not come back");
  const list = on(s.ep("GET", "/api/v1/contacts"));
  assert.ok(list.find((x) => x.key.endsWith("|param|query.per_page:maximum:invalid")).request.mutation.value === 101, "parameter constraints reach the plan");
  assert.equal(r.out.levels.TCL2, true);
});

test("dedupe: the same request schema gets field negatives once plus one smoke negative; PATCH has no required negatives", async () => {
  const s = setup();
  await s.run("build");
  const put_ = s.plan().filter((x) => x.endpoint === s.ep("PUT", "/api/v1/contacts/{contactId}") && x.rule === "field");
  assert.equal(put_.length, 1, "one smoke negative on the second endpoint with the same schema (the create is canonical)");
  const deduped = s.cov().excluded.filter((x) => x.reason === "deduped" && x.item.startsWith(`field:${s.ep("PUT", "/api/v1/contacts/{contactId}")}:`));
  assert.ok(deduped.length > 5 && deduped.every((x) => /same request schema as EP-/.test(x.detail)));
  const patch = s.ep("PATCH", "/api/v1/contacts/{contactId}");
  assert.ok(!s.cov().mapped.some((m) => m.item === `field:${patch}:/name:required`), "PATCH is partial: a missing field is not a fault");
});

test("expectations: spec status when documented, else the status class plus one question per fault class; answers must be applied", async () => {
  const s = setup();
  await s.run("build");
  const post = s.ep("POST", "/api/v1/contacts");
  const missing = s.plan().find((x) => x.endpoint === post && x.key.endsWith("/name:required:invalid"));
  assert.deepEqual(missing.expect, { status: 422, source: "spec", schema: "error:422" });
  const noCreds = s.plan().find((x) => x.endpoint === post && x.rule === "auth");
  assert.deepEqual(noCreds.expect, { statusClass: "4xx", source: "class-only" });
  for (const x of s.plan()) for (const r of [x.expect, ...(x.expect.rules ?? [])]) assert.ok(r.source, `${x.id}: every expectation names its source`);

  const csv = csvPath(s.p.productDir, "contacts");
  const questions = () => readRows(csv).map((r) => r.question);
  assert.deepEqual(s.cov().questions.map((q) => q.fault), ["auth", "notFound", "validation"]);
  assert.ok(questions().every((q) => q.startsWith("Contacts API: which HTTP status code")));
  await s.run("build");
  assert.equal(questions().length, 3, "rebuilding never duplicates a question");

  const authQ = s.cov().questions.find((q) => q.fault === "auth").id;
  record(csv, authQ, { answer: "401 everywhere", runId: "acme-run-1" });
  s.overlay(LINK_TC(s));
  await s.run("build");
  assert.ok(s.cov().pending.some((p) => p.item === `question:${authQ}`), "an answered question is pending until it is applied");
  assert.equal((await s.run("check")).code, 1);
  s.overlay({ ...LINK_TC(s), statusRules: [{ fault: "auth", status: 401, citation: `clarification:${authQ}` }] });
  await s.run("build");
  assert.deepEqual(s.plan().find((x) => x.key === noCreds.key).expect, { status: 401, source: `clarification:${authQ}` });
});

test("safety: anything that can change data acts on an entity this run created, runs only in full-run, and is cleaned up", async () => {
  const s = setup();
  await s.run("build");
  const plan = s.plan();
  const create = s.ep("POST", "/api/v1/contacts");
  for (const x of plan.filter((x) => x.mutates)) {
    assert.ok(x.requires.includes("full-run"), `${x.id} mutates, so full-run only`);
    for (const st of x.request.setup ?? []) assert.equal(st.endpoint, create, `${x.id}: a mutating request's id comes from a create, never a list (D-005)`);
  }
  for (const x of plan.filter((x) => !x.mutates)) assert.deepEqual(x.requires, [], `${x.id} is a read, so it runs in readonly`);
  const del = s.ep("DELETE", "/api/v1/contacts/{contactId}");
  const createHappy = plan.find((x) => x.endpoint === create && x.rule === "happy-path");
  assert.deepEqual(createHappy.cleanup, { endpoint: del });
  const tags = plan.find((x) => x.endpoint === s.ep("POST", "/api/v1/contacts/tags") && x.rule === "happy-path");
  assert.equal(tags.leavesData, true, "a create without a delete operation is flagged");
  assert.equal(tags.cleanup, null);
  const flows = plan.filter((x) => x.type === "lifecycle").map((x) => x.key.split("|").at(-1)).sort();
  assert.deepEqual(flows, ["create-delete-read", "create-read", "create-update-read", "delete-idempotent", "put-idempotent"]);
  const uaf = plan.find((x) => x.key.endsWith("|flow|create-delete-read"));
  assert.deepEqual(uaf.steps.map((st) => st.endpoint), [create, del, s.ep("GET", "/api/v1/contacts/{contactId}")]);
  assert.deepEqual(uaf.steps[2].expect, { status: 404, source: "spec" });
  const method = plan.filter((x) => x.rule === "http" && x.key.endsWith("|method") && x.key.split("|")[0].endsWith("{}"));
  assert.ok(method.length);
  assert.ok(method.every((x) => x.request.target === "unknown-id"), "a wrong method on an item path only ever names an id that does not exist");
  assert.ok(s.cov().excluded.some((x) => x.item.endsWith(":http:method") || x.reason === "unsafe_probe"), "no destructive method is probed on a collection path");
});

test("stable ids: rebuilding keeps every id; an added scenario takes the next number; a removed endpoint retires its ids", async () => {
  const s = setup();
  await s.run("build");
  const before = new Map(s.plan().map((x) => [x.key, x.id]));
  const post = s.ep("POST", "/api/v1/contacts");
  s.overlay({ scenarios: [{ name: "duplicate-email", endpoint: post, type: "business", title: "A second contact with the same email is refused", request: { base: "valid", repeat: 2 }, expect: { status: 409, source: "spec", rules: [] }, citations: ["testcase:TC-contacts-1"] }] });
  await s.run("build");
  for (const x of s.plan()) if (before.has(x.key)) assert.equal(x.id, before.get(x.key), `${x.key} kept its id`);
  const added = s.plan().find((x) => x.key === "overlay|duplicate-email");
  assert.equal(added.id, `API-contacts-${before.size + 1}`);

  const spec = structuredClone(SPEC);
  delete spec.paths["/contacts/tags"];
  const ap = apiPaths(s.p.productDir, "contacts");
  saveSource(ap, { kind: "openapi", location: "https://app.acme.test/openapi.json", content: spec, version: "3.0.3", status: "ok" });
  buildCatalogue(ap, { module: "contacts", cfg: JSON.parse(readFileSync(s.p.configFile, "utf8")), runId: "acme-run-1" });
  await s.run("build");
  const retired = s.cov().retired;
  assert.ok(retired.length > 0);
  assert.ok(!s.plan().some((x) => retired.includes(x.id)), "a retired id is never reused");
});

test("coverage and check: an @api test case is pending until linked; check stamps verified; any later change unverifies", async () => {
  const s = setup();
  await s.run("build");
  assert.deepEqual(s.cov().pending.map((p) => p.item).sort(), ["status:" + s.ep("POST", "/api/v1/contacts/tags") + ":402", "testcase:TC-contacts-1"]);
  const r = await s.run("check");
  assert.equal(r.code, 1);
  assert.ok(planUnverified(s.pp));
  s.overlay(LINK_TC(s));
  await s.run("build");
  const ok = await s.run("check");
  assert.deepEqual(ok.out, { valid: true, deferred: 0, problems: [] });
  assert.equal(planUnverified(s.pp), null);
  assert.deepEqual(s.plan().find((x) => x.testcases.includes("TC-contacts-1")).priority, "p1", "a linked test case raises the priority");
  assert.ok(s.cov().excluded.some((x) => x.item.endsWith(":402") && x.reason === "not_testable"));
  const md = readFileSync(s.pp.md, "utf8");
  for (const h of ["## Scenarios", "## Documented-only endpoints", "## Leaves data", "## Class-only expectations", "## Questions raised", "## Not covered"]) assert.ok(md.includes(h), h);

  const plan = s.plan();
  plan[0].expect = { status: 200, source: "spec" };
  writeJson(s.pp.plan, plan);
  assert.match(planUnverified(s.pp), /changed after api-plan.mjs check/, "a hand edit after check is caught");
});

test("overlay: citations must resolve, exclusions need a matching item, and generated scenarios cannot be renamed", async () => {
  const s = setup();
  await s.run("build");
  s.overlay({ statusRules: [{ fault: "validation", status: 400, citation: "clarification:contacts-99" }], exclude: [{ match: "nothing:*", reason: "out_of_scope", detail: "x" }], testcases: { "TC-contacts-1": ["API-contacts-9999"] } });
  const r = await s.run("build");
  assert.equal(r.code, 1);
  assert.ok(r.out.problems.some((p) => p.includes("clarification:contacts-99") && p.includes("no such row")));
  assert.ok(r.out.problems.some((p) => p.includes("matches no coverage item")));
  assert.ok(r.out.problems.some((p) => p.includes("is not a planned scenario")));
  s.overlay({ scenarios: [{ name: "x", endpoint: "EP-contacts-1", title: "t", request: {}, expect: { status: 200, source: "made-up" }, citations: ["testcase:TC-contacts-1"] }] });
  const bad = await s.run("build");
  assert.equal(bad.code, 1, "the overlay schema rejects an unsourced expectation");
  assert.ok(bad.out.problems[0].startsWith("plan-overlay.json"));
});

test("identities: object-level authorization is planned per identity when configured, excluded with a reason when not", async () => {
  const without = setup();
  await without.run("build");
  assert.ok(without.cov().excluded.some((x) => x.item.startsWith("bola:") && x.reason === "needs_identity"));
  const s = setup({ identities: [{ name: "peer", role: "peer", session_state_file: "playwright-tests/acme/.auth/peer.json" }] });
  await s.run("build");
  const bola = s.plan().filter((x) => x.rule === "bola");
  assert.ok(bola.length >= 3);
  for (const x of bola) {
    assert.ok(x.requires.includes("identity:peer"));
    assert.equal(x.request.auth, "identity:peer");
  }
  assert.deepEqual(validateRunConfig({ product: "a", target: { url: "https://a.test" }, modules: [{ slug: "m", name: "M", nav_path: ["M"] }], authorizations: { identities: [{ name: "peer", role: "peer" }] } }).errors, ["authorizations.identities[0]: needs credentials_file and/or session_state_file (paths, never values)"]);
});

test("GraphQL: errors are asserted with the status GraphQL-over-HTTP allows; a mutation over GET is planned once", async () => {
  const intro = {
    data: {
      __schema: {
        queryType: { name: "Query" },
        mutationType: { name: "Mutation" },
        subscriptionType: null,
        types: [
          { kind: "OBJECT", name: "Query", fields: [{ name: "contacts", args: [{ name: "first", type: { kind: "NON_NULL", ofType: { kind: "SCALAR", name: "Int" } } }], type: { kind: "LIST", ofType: { kind: "OBJECT", name: "Contact" } } }] },
          { kind: "OBJECT", name: "Mutation", fields: [{ name: "createContact", args: [], type: { kind: "OBJECT", name: "Contact" } }, { name: "deleteContact", args: [], type: { kind: "SCALAR", name: "Boolean" } }] },
        ],
      },
    },
  };
  assert.ok(INTROSPECTION_QUERY);
  const s = setup({ spec: null, graphql: intro });
  await s.run("build");
  const g = s.plan().filter((x) => x.endpoint.startsWith("EP-"));
  const happy = g.find((x) => x.key === "GQL query contacts|happy-path");
  assert.deepEqual(happy.expect.rules.map((r) => r.assert), ["errors-absent", "present"]);
  const missing = g.find((x) => x.key.endsWith("|gql-arg|first:missing"));
  assert.deepEqual(missing.expect, { statusIn: [200, 400], source: "graphql-over-http", rules: [{ assert: "errors-present", source: "graphql-over-http" }] });
  assert.equal(g.filter((x) => x.key.endsWith("|gql|mutation-over-get")).length, 1);
});

test("budget: the lowest-priority scenarios are not planned and their items are deferred, not excluded; check passes and reports them (D-050)", async () => {
  const s = setup({ budget: 20 });
  await s.run("build");
  s.overlay(LINK_TC(s));
  const built = await s.run("build");
  assert.deepEqual(built.out.problems, []);
  assert.ok(s.plan().length <= 20);
  assert.ok(s.plan().filter((x) => x.rule === "happy-path").length >= 6, "every operation keeps its happy path");
  assert.ok(s.plan().some((x) => x.testcases.includes("TC-contacts-1")), "a linked test case stays");
  assert.ok(!s.plan().some((x) => x.type === "http"), "p3 http scenarios go first");
  const cov = s.cov();
  assert.ok(cov.deferred.length > 0);
  assert.equal(built.out.deferred, cov.deferred.length);
  assert.ok(cov.deferred.every((d) => d.reason === "budget" && d.detail === "over api.plan_budget (20)"));
  assert.ok(cov.deferred.some((d) => d.item.startsWith("http:")));
  assert.ok(!cov.excluded.some((x) => x.reason === "budget"), "budget is no longer an exclusion reason");
  const listed = [...cov.mapped, ...cov.excluded, ...cov.pending].map((x) => x.item);
  assert.ok(cov.deferred.every((d) => !listed.includes(d.item)), "a deferred item is in no other list");
  assert.deepEqual(cov.pending, []);
  const ok = await s.run("check");
  assert.deepEqual(ok.out, { valid: true, deferred: cov.deferred.length, problems: [] }, "deferred counts as resolved, and check reports how many");
  assert.equal(planUnverified(s.pp), null);
  const md = readFileSync(s.pp.md, "utf8");
  assert.ok(md.includes("## Deferred (over the budget)"));
  assert.ok(cov.deferred.every((d) => md.includes(`- ${d.item}: over api.plan_budget (20)`)));
});

test("orchestration: the plan step counts as done only after api-plan.mjs check passed on what is on disk", async () => {
  const s = setup();
  const go = () => next("acme", "playwright-api", "contacts", { root: s.root, compile: false });
  for (const name of ["discover", "plan"]) {
    const a = go().actions[0];
    assert.equal(a.step, name);
    step("acme", "playwright-api", "contacts", name, "start", undefined, { root: s.root });
    if (name === "plan") await s.run("build"); // pending items remain: check never passed
    step("acme", "playwright-api", "contacts", name, "done", undefined, { root: s.root });
  }
  const failed = go();
  assert.equal(failed.done.outcome, "failed");
  assert.equal(failed.done.failedStep, "plan");
  assert.match(failed.done.note, /did not pass api-plan.mjs check/);

  const t = setup();
  const go2 = () => next("acme", "playwright-api", "contacts", { root: t.root, compile: false });
  for (const name of ["discover", "plan"]) {
    step("acme", "playwright-api", "contacts", go2().actions[0].step, "start", undefined, { root: t.root });
    if (name === "plan") {
      await t.run("build");
      t.overlay(LINK_TC(t));
      await t.run("build");
      assert.equal((await t.run("check")).code, 0);
    }
    step("acme", "playwright-api", "contacts", name, "done", undefined, { root: t.root });
  }
  assert.equal(go2().actions[0].step, "scaffold");
});

test("gate: a scenario that needs an identity must carry @identity-<name> in its test title", async () => {
  const s = setup({ identities: [{ name: "peer", role: "peer", session_state_file: "x.json" }] });
  await s.run("build");
  const bola = s.plan().find((x) => x.rule === "bola");
  const title = (x) => `${x.id} t${x.mutates ? " @mutates" : ""}`;
  put(s.root, "playwright-tests/acme/tests/api/contacts/c.spec.ts", s.plan().map((x) => `test('${title(x)}', async () => { recordCreated(); });`).join("\n") + "\n");
  gate("acme", "contacts", "playwright-api", { root: s.root, compile: false });
  const findings = readFileSync(path.join(s.p.results("acme-run-1"), "contacts", "playwright-api", "gate-findings.md"), "utf8");
  assert.match(findings, new RegExp(`${bola.id} needs identity 'peer' but its title lacks @identity-peer`));
});
