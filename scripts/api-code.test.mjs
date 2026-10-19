// The API code is generated from the endpoint catalogue and the verified API plan (D-056): one literal test per plan
// scenario, the clients, types, schemas and registration as managed files with a drift check, and the agents' code only
// in a cited client overlay, composite helpers and the payload and glue slots, each under rules that close the bypasses
// earlier validators found.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { main as planMain } from "./api-plan.mjs";
import { main } from "./api-code.mjs";
import { gate } from "./gate.mjs";
import { next, step } from "./orchestration.mjs";
import { apiCodeContext, apiCodeFindings, apiCodeUnverified, builtinPatchFindings, nameIn, runnerImportFindings, parseSlots, renderCompositeSeed, renderFacade, renderGlue, renderPayloads, renderSender, renderSupport, specTests, titleLit, tsType, valueIn } from "./lib/api-code.mjs";
import { PURE_GLOBALS, freeIdentifierFindings } from "./lib/agent-scope.mjs";
import { crudOf } from "./lib/endpoints.mjs";
import { repoRoot as repoDir } from "./lib/contract.mjs";
import { renderIndex } from "./lib/foundation.mjs";
import { scanTs } from "./lib/ts-scan.mjs";
import { planPaths } from "./lib/api-plan.mjs";
import { paths } from "./lib/contract.mjs";
import { apiPaths, build as buildCatalogue, saveSource, writeJson } from "./lib/endpoints.mjs";
import { checkTool } from "./lib/guard.mjs";
import { normalize } from "./hooks/hosts/claude.mjs";
import { listedTests, listFindings } from "./lib/gate/playwright.mjs";
import { API_INDEX, listSpecTitles, markApproved, put, renderFoundation, scaffoldApiCode, startRun } from "./test-helpers.mjs";

const MOD = "artifacts/acme/modules/contacts";
const PW = "playwright-tests/acme";
const CONTACT = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    id: { type: "integer", readOnly: true },
    name: { type: "string", minLength: 1, maxLength: 100 },
    email: { type: "string", format: "email" },
    status: { type: "string", enum: ["active", "lead"] },
    secret: { type: "string", writeOnly: true },
    nickname: { type: "string", nullable: true },
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
        parameters: [{ in: "query", name: "page", schema: { type: "integer", minimum: 1 } }],
        responses: { 200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Contact" } } } } }, 429: { description: "slow down" } },
      },
      post: {
        tags: ["Contacts"],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
        responses: { 201: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, 422: { content: { "application/json": { schema: { type: "object", properties: { message: { type: "string" } } } } } } },
      },
    },
    "/contacts/{contactId}": {
      parameters: [{ in: "path", name: "contactId", required: true, schema: { type: "integer" } }],
      get: { tags: ["Contacts"], responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, 404: { description: "not found" } } },
      put: { tags: ["Contacts"], requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, responses: { 200: { description: "ok" } } },
      delete: { tags: ["Contacts"], responses: { 204: { description: "gone" } } },
    },
    "/contacts/tags": {
      post: { tags: ["Contacts"], operationId: "addTag", requestBody: { content: { "application/json": { schema: { type: "object", properties: { label: { type: "string" } } } } } }, responses: { 201: { description: "ok" } } },
    },
  },
};
const FEATURE = ["Feature: Contacts", "  @TC-contacts-1 @p1 @api", "  Scenario: create a contact via the API", "    Given x", "  @TC-contacts-2 @p2 @functional", "  Scenario: list contacts", "    Given y", ""].join("\n");
const PEER = [{ name: "peer", role: "peer", session_state_file: "x.json" }];
const ARCHIVED = "Archived contacts can't be renamed: the request is refused.";

// A run with the catalogue, a checked plan (the POST happy path linked to TC-contacts-1) and the API foundation.
async function setup({ spec = SPEC, graphql, approved = ["TC-contacts-1", "TC-contacts-2"], budget, planOverlay = {}, check = true } = {}) {
  const { root } = startRun({ extra: budget ? [`api: {plan_budget: ${budget}}`] : [] });
  const p = paths("acme", root);
  const cfg0 = JSON.parse(readFileSync(p.configFile, "utf8"));
  cfg0.authorizations.identities = PEER;
  writeFileSync(p.configFile, JSON.stringify(cfg0));
  const ap = apiPaths(p.productDir, "contacts");
  if (spec) saveSource(ap, { kind: "openapi", location: "https://app.acme.test/openapi.json", content: spec, version: "3.0.3", status: "ok" });
  if (graphql) saveSource(ap, { kind: "graphql", location: "https://app.acme.test/graphql", content: graphql, getSupported: true, status: "ok" });
  put(root, `${MOD}/testcases/contacts-testcases.feature`, FEATURE);
  put(root, "artifacts/acme/knowledge/modules/contacts/notes.md", `# Contacts\n\n${ARCHIVED}\nRequests send X-Requested-With: XMLHttpRequest.\n`);
  markApproved(root, approved);
  assert.deepEqual(buildCatalogue(ap, { module: "contacts", cfg: JSON.parse(readFileSync(p.configFile, "utf8")), runId: "acme-run-1" }).problems, []);
  const pp = planPaths(p.productDir, "contacts");
  const plan = () => JSON.parse(readFileSync(pp.plan, "utf8"));
  const run = (cmd) => planMain([cmd, "acme", "contacts"], { root });
  await run("build");
  if (spec) {
    const post = plan().find((x) => x.key.endsWith("POST /api/v1/contacts|happy-path")).id;
    writeJson(pp.overlay, { ...(approved.includes("TC-contacts-1") ? { testcases: { "TC-contacts-1": [post] } } : {}), ...planOverlay });
    await run("build");
  }
  if (check) assert.equal((await run("check")).code, 0, JSON.stringify((await run("check")).out.problems));
  await renderFoundation(root, ["repo", "api"]);
  const ac = (...args) => main([args[0], "acme", "contacts", ...args.slice(1)], { root, exec: () => null, listTests: listSpecTitles });
  const ctx = () => apiCodeContext({ root, product: "acme", module: "contacts", run: JSON.parse(readFileSync(p.runFile, "utf8")), cfg: JSON.parse(readFileSync(p.configFile, "utf8")), productDir: p.productDir });
  const file = (rel) => path.join(root, PW, rel);
  const read = (rel) => readFileSync(file(rel), "utf8");
  const write = (rel, text) => put(root, `${PW}/${rel}`, text);
  const model = () => JSON.parse(readFileSync(ctx().ap.plan, "utf8"));
  const cov = () => JSON.parse(readFileSync(ctx().ap.coverage, "utf8"));
  const rules = (scope = "tests") => apiCodeFindings(ctx(), { scope });
  const ep = (method, pth) => JSON.parse(readFileSync(ap.catalogue, "utf8")).find((e) => e.method === method && e.path === pth).id;
  return { root, p, pp, ap, plan, run, ac, ctx, file, read, write, model, cov, rules, ep };
}
const ruleNames = (findings) => [...new Set(findings.map((f) => f.rule))].sort();
// One test's code in a spec: from its `test(` line to its closing `  });`.
function block(text, id) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => new RegExp(`^  test\\((['"])${id} `).test(l));
  if (at < 0) return null;
  const end = lines.findIndex((l, i) => i > at && l === "  });");
  return lines.slice(at, end + 1).join("\n");
}
// A slot body set in a slot file, keeping the rest generated.
function setSlot(s, rel, key, lines) {
  const ctx = s.ctx();
  const model = s.model();
  const { regions } = parseSlots(s.read(rel));
  regions.set(key, lines);
  const reasons = new Map((JSON.parse(existsSync(ctx.ap.testsOverlay) ? readFileSync(ctx.ap.testsOverlay, "utf8") : "{}").glue ?? []).map((g) => [g.scenario, g.reason]));
  s.write(rel, rel.endsWith(".glue.ts") ? renderGlue(ctx, model, regions, reasons) : renderPayloads(ctx, model, regions));
}

test("one literal test per plan scenario, in a file per resource, titled and tagged from the plan", async () => {
  const s = await setup();
  const b = await s.ac("build");
  assert.equal(b.code, 0, JSON.stringify(b.out.problems));
  const plan = s.plan();
  const model = s.model();
  assert.equal(model.tests.length, plan.length, "every plan scenario has a test");
  assert.deepEqual(model.files.specs, ["tests/api/contacts/contacts.spec.ts", "tests/api/contacts/tags.spec.ts"]);
  const declared = model.files.specs.flatMap((f) => specTests(s.read(f)).tests.map((t) => ({ ...t, file: f })));
  assert.equal(declared.length, plan.length, "no other test is declared");
  for (const t of model.tests) {
    const mine = declared.filter((d) => d.title === t.literal);
    assert.equal(mine.length, 1, `${t.id} once`);
    assert.equal(mine[0].file, t.file);
    const sc = plan.find((x) => x.id === t.id);
    assert.ok(t.literal.startsWith(`${t.id} `));
    assert.ok(t.tags.includes(`@${sc.priority}`) && t.tags.includes(`@${sc.type}`));
    assert.equal(t.tags.includes("@mutates"), sc.mutates, `${t.id}: @mutates exactly when the scenario changes data`);
  }
  const bola = model.tests.find((t) => t.rule === "bola");
  assert.ok(bola.tags.includes("@identity-peer"), "an identity scenario carries @identity-<name>");
  const happy = model.tests.find((t) => plan.find((x) => x.id === t.id).key.endsWith("POST /api/v1/contacts|happy-path"));
  assert.ok(happy.tags.includes("@TC-contacts-1"), "the approved test case it covers is a tag");
  assert.ok(model.tests.find((t) => t.endpoint === s.ep("POST", "/api/v1/contacts/tags")).file.endsWith("/tags.spec.ts"));
  // rebuilding changes nothing: generation is deterministic
  assert.deepEqual((await s.ac("build")).out.written, []);
});

test("a blocked scenario is a test.fixme with the plan's reason, excluded from coverage as blocked", async () => {
  const s = await setup();
  await s.ac("build");
  const blocked = s.plan().find((x) => x.blocked);
  assert.ok(blocked, "the documented 429 plans a blocked rate-limit scenario");
  const t = s.model().tests.find((x) => x.id === blocked.id);
  assert.equal(t.kind, "blocked");
  const code = block(s.read(t.file), t.id);
  assert.match(code, new RegExp(`test\\.fixme\\(true, 'blocked: ${blocked.blocked.slice(0, 30).replace(/[()]/g, ".")}`));
  assert.doesNotMatch(code, /expect\(/, "a blocked test sends nothing and asserts nothing");
  const item = s.cov().items.find((i) => i.id === t.id);
  assert.deepEqual([item.status, item.reason], ["excluded", "blocked"]);
  assert.ok(s.cov().blocked.some((x) => x.id === t.id));
});

test("the auth context follows the scenario: the run's session, no credentials, a malformed credential, another identity", async () => {
  const s = await setup();
  await s.ac("build");
  const spec = s.read("tests/api/contacts/contacts.spec.ts");
  const plan = s.plan();
  const of = (pred) => block(spec, plan.find(pred).id);
  const none = of((x) => x.request.auth === "none" && x.endpoint === s.ep("GET", "/api/v1/contacts"));
  assert.match(none, /async \(\{ noAuth \}\)/);
  assert.match(none, /new ContactsClient\(noAuth\)/);
  const malformed = of((x) => x.request.auth?.startsWith("malformed:"));
  assert.match(malformed, /new ContactsClient\(await malformedAuth\('session'\)\)/, "the spec's cookie scheme maps to the session scheme");
  const bola = of((x) => x.rule === "bola" && x.endpoint === s.ep("GET", "/api/v1/contacts/{contactId}"));
  assert.match(bola, /new ContactsClient\(await identity\('peer'\)\)/);
  assert.match(bola, /requireOk\(setup1/, "the object belongs to the run's own user: set up through the default client");
  const happy = of((x) => x.rule === "happy-path" && x.endpoint === s.ep("GET", "/api/v1/contacts"));
  assert.match(happy, /async \(\{ contactsClient \}\)/);
  assert.match(happy, /await contactsClient\.list\(/);
  assert.doesNotMatch(happy, /new ContactsClient/);
});

test("status assertions come from the plan: exact when sourced, the class when class-only, never a 5xx; then the schema, then the rules", async () => {
  const s = await setup();
  await s.ac("build");
  const spec = s.read("tests/api/contacts/contacts.spec.ts");
  const plan = s.plan();
  const missing = plan.find((x) => x.key.endsWith("POST /api/v1/contacts|field|/name:required:invalid"));
  const exact = block(spec, missing.id);
  assert.match(exact, /expect\(res\.status\(\), '[^']+ status \(spec\)'\)\.toBe\(422\);/);
  assert.match(exact, /contactsSchemas\.operations\['EP-contacts-\d+'\]\.errors\['422'\]/);
  const classOnly = block(spec, plan.find((x) => x.expect.statusClass === "4xx" && x.expect.source === "class-only").id);
  assert.match(classOnly, /toBeGreaterThanOrEqual\(400\);[\s\S]*toBeLessThan\(500\);/);
  const non5xx = block(spec, plan.find((x) => x.expect.statusClass === "non-5xx" && !x.blocked).id);
  assert.match(non5xx, /status below 500 \([^)]+\)'\)\.toBeLessThan\(500\);/);
  assert.doesNotMatch(non5xx, /toBeGreaterThanOrEqual/);
  const read = block(spec, plan.find((x) => x.rule === "happy-path" && x.endpoint === s.ep("GET", "/api/v1/contacts/{contactId}")).id);
  const at = (re) => read.search(re);
  assert.ok(at(/\.toBe\(200\)/) < at(/\.response, json\)/) && at(/\.response, json\)/) < at(/hasPointer\(json, '\/secret'\)/), "status, then schema, then the rules, in the plan's order");
  const allow = block(spec, plan.find((x) => x.rule === "http" && x.request.method).id);
  assert.match(allow, /if \(res\.status\(\) === 405\) expect\(hasHeader\(res, 'allow'\), '[^']*'\)\.toBe\(true\);/, "a rule with `when` holds only for that status");
  assert.match(allow, /contactsClient\.send\('(DELETE|PUT|PATCH|POST)', '\/api\/v1\/contacts\/\{contactId\}', \{ path: \{ contactId: goneId \} \}\)/, "an unsupported (changing) method goes through the guarded client, on an id this test created and deleted (U3)");
  for (const f of s.model().files.specs) assert.doesNotMatch(s.read(f), /toBe\(5\d\d\)|toBeGreaterThanOrEqual\(500\)/, "never a 5xx");
});

test("statusIn and GraphQL: a method per operation, queries over GET, errors asserted whatever the status", async () => {
  const intro = {
    data: {
      __schema: {
        queryType: { name: "Query" }, mutationType: { name: "Mutation" }, subscriptionType: null,
        types: [
          { kind: "OBJECT", name: "Query", fields: [{ name: "contacts", args: [{ name: "first", type: { kind: "NON_NULL", ofType: { kind: "SCALAR", name: "Int" } } }], type: { kind: "LIST", ofType: { kind: "OBJECT", name: "Contact" } } }] },
          { kind: "OBJECT", name: "Mutation", fields: [{ name: "createContact", args: [], type: { kind: "OBJECT", name: "Contact" } }] },
        ],
      },
    },
  };
  const s = await setup({ spec: null, graphql: intro, approved: [], check: false });
  const b = await s.ac("build");
  assert.equal(b.code, 0, JSON.stringify(b.out.problems));
  const model = s.model();
  const text = s.read(model.clients.find((c) => c.methods.some((m) => m.name === "contacts")).file);
  const mutation = s.read(model.clients.find((c) => c.methods.some((m) => m.name === "createContact")).file);
  assert.match(text, /async contacts\(req: \{ variables\?: \w+Variables \| Mutated; select\?: string; via\?: 'GET' \| 'POST';/);
  assert.match(text, /req\.via \?\? 'GET'/, "a query is sent as GET, so a readonly run can send it");
  assert.match(mutation, /async createContact\([^)]*\)[^{]*\{\n\s+return sendGraphql\([^\n]*req\.via \?\? 'POST'/);
  assert.match(text, /`query Contacts\(\$first: Int!\) \{ contacts\(first: \$first\) \{ __typename/);
  const plan = s.plan();
  const missing = plan.find((x) => x.key.endsWith("|gql-arg|first:missing"));
  const code = block(s.read(model.tests.find((t) => t.id === missing.id).file), missing.id);
  assert.match(code, /expect\(oneOf\(res\.status\(\), \[200, 400\]\), '[^']+ status one of 200\|400 \(graphql-over-http\)'\)\.toBe\(true\);/);
  assert.match(code, /expect\(graphqlErrors\(json\)\.length, '[^']*'\)\.toBeGreaterThan\(0\);/);
  assert.match(code, /mutate\(payloads\.\w+\(\), \{ pointer: '\/first', op: 'remove' \}\)/);
  const overGet = plan.find((x) => x.key.endsWith("|gql|mutation-over-get"));
  assert.match(block(s.read(model.tests.find((t) => t.id === overGet.id).file), overGet.id), /via: 'GET'/);
});

test("every endpoint has a client method; types and schema files come from the catalogue's schemas", async () => {
  const s = await setup();
  await s.ac("build");
  const cat = JSON.parse(readFileSync(path.join(s.p.productDir, "modules/contacts/api/discovered-endpoints.json"), "utf8"));
  const items = s.cov().items.filter((i) => i.kind === "endpoint");
  assert.equal(items.length, cat.length);
  for (const e of cat) {
    const it = items.find((i) => i.id === e.id);
    assert.equal(it.status, "mapped");
    const [file, name] = it.refs[0].split("#");
    assert.match(s.read(file), new RegExp(`async ${name}\\(`), `${e.id} -> ${it.refs[0]}`);
  }
  const model = s.model();
  assert.deepEqual(model.clients.map((c) => [c.class, c.fixture]), [["ContactsClient", "contactsClient"], ["ContactsTagsClient", "contactsTagsClient"]]);
  const types = s.read("clients/contacts/types.ts");
  assert.match(types, /export type ContactsCreateRequest = \{\n  email\?: string;\n  id\?: number;\n  name: string;\n  nickname\?: string \| null;/, "readOnly optional in a request, nullable as | null");
  assert.match(types, /export type ContactsListQuery = \{\n  page\?: number;\n\};/);
  const schema = JSON.parse(s.read("config/api/schemas/contacts/contacts.json"));
  assert.match(schema.$comment, /^Generated by scripts\/api-code\.mjs — do not edit\./);
  const create = schema.operations[s.ep("POST", "/api/v1/contacts")];
  assert.deepEqual(create.response.properties.nickname.type, ["string", "null"], "OpenAPI nullable becomes a JSON Schema null type for Ajv");
  assert.ok(create.errors["422"]);
  assert.equal(tsType({ allOf: [{ type: "object", properties: { a: { type: "string" } }, required: ["a"] }, { properties: { b: { type: "integer" } } }] }), "{\n  a: string;\n  b?: number;\n}");
  assert.match(s.read("clients/contacts/contacts.client.ts"), /^\/\/ Generated by scripts\/api-code\.mjs — do not edit\./);
  assert.doesNotMatch(s.read("clients/contacts/contacts.client.ts"), /expect\(/, "no assertion in a client");
});

test("regeneration keeps the slots; a slot whose scenarios are parked is kept aside and comes back", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const before = s.read("helpers/api/contacts.payloads.ts");
  const b = await s.ac("build");
  assert.deepEqual(b.out.written, [], "nothing to rewrite");
  assert.equal(s.read("helpers/api/contacts.payloads.ts"), before);
  // the tags endpoint's scenarios parked: its body builder is no longer needed, so its slot body is parked
  const tagsBody = s.model().payloads.find((x) => x.endpoint === s.ep("POST", "/api/v1/contacts/tags") && x.kind === "body").name;
  const tags = s.model().tests.filter((t) => t.payloads.includes(tagsBody)).map((t) => t.id);
  assert.ok(tags.length);
  writeJson(s.ctx().ap.testsOverlay, { park: tags.map((id) => ({ scenario: id, reason: "the tag service is not reachable from the test tenant" })) });
  const parked = await s.ac("build");
  assert.equal(parked.code, 0, JSON.stringify(parked.out.problems));
  assert.deepEqual(parked.out.parkedSlots, [`helpers/api/contacts.payloads.ts#payload ${tagsBody}`]);
  assert.ok(!s.read("helpers/api/contacts.payloads.ts").includes(tagsBody));
  for (const id of tags) {
    assert.match(block(s.read("tests/api/contacts/tags.spec.ts"), id), /test\.fixme\(true, 'parked: the tag service is not reachable from the test tenant'\);/);
    assert.deepEqual(["excluded", "parked"], [s.cov().items.find((i) => i.id === id).status, s.cov().items.find((i) => i.id === id).reason]);
  }
  writeJson(s.ctx().ap.testsOverlay, {});
  const back = await s.ac("build");
  assert.deepEqual(back.out.restored, [`helpers/api/contacts.payloads.ts#payload ${tagsBody}`]);
  assert.equal(s.read("helpers/api/contacts.payloads.ts"), before, "the body is back where it was");
  assert.equal((await s.ac("check")).code, 0);
  // a blocked scenario can't be parked, and a reason needs words
  const blocked = s.plan().find((x) => x.blocked).id;
  writeJson(s.ctx().ap.testsOverlay, { park: [{ scenario: blocked, reason: "parking a blocked one" }, { scenario: tags[0], reason: "xxxxxxxxxxxx" }] });
  const bad = await s.ac("build");
  assert.match(bad.out.problems.join("\n"), new RegExp(`${blocked} is already blocked by the plan`));
  assert.match(bad.out.problems.join("\n"), /at least three words/);
});

test("drift: a hand edit of a generated file fails check and the gate; build restores it", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  for (const rel of ["clients/contacts/contacts.client.ts", "clients/contacts/support.ts", "config/api/schemas/contacts/contacts.json", "fixtures/api/clients/contacts.ts", "tests/api/contacts/tags.spec.ts"]) {
    const was = s.read(rel);
    s.write(rel, rel.endsWith(".json") ? was.replace('"type": "integer"', '"type": "string"') : was.replace("\n", "\n// a harmless-looking edit\n"));
    const c = await s.ac("check");
    assert.equal(c.code, 1, rel);
    assert.match(c.out.problems.join("\n"), new RegExp(`${rel.replace(/[./]/g, "\\$&")}:\\d+ \\[generated\\] .* was edited or is out of date`), rel);
    const g = gate("acme", "contacts", "playwright-api", { root: s.root, compile: false });
    assert.equal(g.verdict, "changes-required", rel);
    await s.ac("build");
    assert.equal(s.read(rel), was);
  }
  // a file no build made, in a generated folder
  s.write("tests/api/contacts/extra.spec.ts", "import { test } from '../../../fixtures/api';\ntest('API-contacts-1 again', async () => {});\n");
  s.write("clients/contacts/raw.ts", "export const x = 1;\n");
  const rules = s.rules();
  assert.ok(rules.some((f) => f.rule === "extra-file" && f.file === "tests/api/contacts/extra.spec.ts"));
  assert.ok(rules.some((f) => f.rule === "extra-file" && f.file === "clients/contacts/raw.ts"));
});

test("check fails on a missing, extra or duplicate test, title or tag drift, a blocked scenario not fixme, a skip, no ledger, a tautology, a raw request", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const rel = "tests/api/contacts/contacts.spec.ts";
  const good = s.read(rel);
  const plan = s.plan();
  const model = s.model();
  const mutating = model.tests.find((t) => t.kind === "test" && t.creates && t.file === rel);
  const blocked = model.tests.find((t) => t.kind === "blocked");
  const code = block(good, mutating.id);
  const cases = [
    ["missing-test", good.replace(code, "")],
    ["duplicate-test", good.replace(code, `${code}\n\n${code}`)],
    ["extra-test", good.replace(code, `${code}\n  test('API-contacts-999 a test no scenario asked for', async () => {});`)],
    ["title-drift", good.replace(`${mutating.literal}'`, `${mutating.literal.replace(" @mutates", "")}'`)],
    ["fixme", good.replace(`test.fixme(true, 'blocked: ${blocked.reason}');`, "test.fixme(true, '');")],
    ["fixme", good.replace(`test.fixme(true, 'blocked: ${blocked.reason}');`, "// fixed")],
    ["silent-skip", good.replace(code, code.replace("const session", "test.skip(process.env.CI === undefined, 'later');\n    const session"))],
    ["ledger", good.replace(code, code.replace(", recordCreated, recordDeleted, owns })", ", recordDeleted, owns })"))],
    ["ledger", good.replace(code, code.replace(/await session\.end\([^\n]*\);/, ""))],
    ["no-assertion", good.replace(code, code.replace(/expect\(/g, "void ("))],
    ["assertion", good.replace(code, code.replace("const session", "expect(true).toBe(true);\n    const session"))],
    ["assertion", good.replace(code, code.replace("expect(res", "expect.soft(res"))],
    ["raw-request", good.replace(code, code.replace("const session", "const raw = await request.newContext();\n    const session"))],
    ["raw-request", good.replace(code, code.replace("const session", "await fetch('/x');\n    const session"))],
  ];
  for (const [rule, text] of cases) {
    s.write(rel, text);
    const found = ruleNames(s.rules());
    assert.ok(found.includes(rule), `${rule}: ${found.join(", ")}`);
    assert.ok(found.includes("generated"), "and any edit of a generated file is drift");
  }
  s.write(rel, good);
  assert.deepEqual(s.rules(), []);
  assert.ok(plan.length);
});

test("payload slots: data only, filled when a scenario needs them, no raw request, no alias, no computed access, no hard-coded URL, host or secret", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const rel = "helpers/api/contacts.payloads.ts";
  const key = "payload contactsCreateBody";
  const good = s.read(rel);
  // a GitHub token shape, built at run time so no secret-shaped literal sits in this file
  const token = ["gh", "p_", "A1b2C3d4".repeat(5)].join("");
  const cases = [
    ["payload-slot", []],
    ["payload-slot", ["  // nothing yet"]],
    ["raw-request", ["  return fetch('/x') as never;"]],
    ["type-escape", ["  return {} as any;"]],
    ["test-reference", ["  const t = test;", "  return { name: 'x' };"]],
    ["assertion", ["  const e = expect;", "  return { name: 'x' };"]],
    ["computed-access", ["  return ({} as Record<string, unknown>)['constructor'] as never;"]],
    ["computed-access", ["  const k = 'name';", "  return { name: uniqueName('c') }[k] as never;"]],
    ["call-apply-bind", ["  return { name: uniqueName.call(null, 'c') };"]],
    ["forbidden", ["  return { name: String(globalThis) };"]],
    ["forbidden", ["  return { name: process.env.NAME ?? 'x' };"]],
    ["forbidden", ["  return { name: `${process.env.NAME}` };"]],
    ["data-only", ["  return { name: await Promise.resolve('x') } as never;"]],
    ["data-only", ["  throw new Error('later');"]],
    ["hardcoded", ["  return { name: 'https:\\/\\/evil.test/x' };"]],
    ["hardcoded", ["  return { name: 'app.acme.test' };"]],
    ["hardcoded", [`  return { name: '${token}' };`]],
  ];
  for (const [rule, lines] of cases) {
    setSlot(s, rel, key, lines);
    const found = ruleNames(s.rules());
    assert.ok(found.includes(rule), `${rule} (${lines.join(" ")}): ${found.join(", ")}`);
  }
  s.write(rel, good.replace("import { uniqueEmail", "import { readFileSync } from 'node:fs';\nimport { uniqueEmail"));
  assert.ok(ruleNames(s.rules()).includes("skeleton"), "an import added outside the slots");
  s.write(rel, good);
  assert.deepEqual(s.rules(), []);
  const c = await s.ac("check");
  assert.equal(c.code, 0);
  assert.equal(s.cov().items.filter((i) => i.kind === "payload").every((i) => i.status === "mapped"), true);
});

test("glue: only for a cited business scenario, through the generated clients, tracked in the ledger, never deleting", async () => {
  const s0 = await setup({ check: false });
  const post = s0.ep("POST", "/api/v1/contacts");
  const put_ = s0.ep("PUT", "/api/v1/contacts/{contactId}");
  const scenario = { name: "archived-rename", endpoint: put_, type: "business", title: "renaming an archived contact is refused", request: { base: "valid", setup: [{ endpoint: post, pointer: "/id", param: "contactId" }] }, expect: { statusClass: "4xx", source: "knowledge:modules/contacts/notes.md" }, citations: ["knowledge:modules/contacts/notes.md"] };
  const s = await setup({ planOverlay: { scenarios: [scenario] } });
  const business = s.plan().find((x) => x.rule === "overlay");
  const other = s.plan().find((x) => x.rule === "happy-path");
  writeJson(s.ctx().ap.testsOverlay, { glue: [{ scenario: other.id, reason: "not a business scenario at all", cite: ["knowledge:modules/contacts/notes.md"] }] });
  assert.match((await s.ac("build")).out.problems.join("\n"), /glue is only for the planner's cited business scenarios/);
  writeJson(s.ctx().ap.testsOverlay, { glue: [{ scenario: business.id, reason: "archive the contact before renaming it", cite: ["knowledge:modules/contacts/notes.md"] }] });
  const { model } = await scaffoldApiCode(s.root);
  const g = model.glue[0];
  assert.equal(g.scenario, business.id);
  const code = block(s.read(model.tests.find((t) => t.id === business.id).file), business.id);
  // M2: after the setup, with the setup's values and the facade; what it arranges reaches the request
  assert.match(code, new RegExp(`const arranged = await glue\\.${g.name}\\(\\{ clients: contactsFacade\\(\\{ contactsClient, contactsTagsClient \\}\\), track: createdBy \\}, \\{ path: \\{ contactId: contactIdValue \\} \\}\\);`));
  assert.ok(code.indexOf("const arranged") > code.indexOf("const contactIdValue"), "the glue runs after the generated setup");
  assert.match(code, /contactsClient\.update\(\{ path: \{ contactId: arranged\.path\?\.contactId \?\? contactIdValue \}, body: mergeAgent\(payloads\.contactsUpdateBody\(\), arranged\.body\) \}\)/);
  const rel = "helpers/api/contacts.glue.ts";
  const key = `glue ${g.name}`;
  const good = s.read(rel);
  const cases = [
    ["glue-slot", []],
    ["glue", ["  await c.clients.contactsClient.delete({ path: { contactId: 1 } });"]],
    ["glue", ["  await c.clients.contactsClient.send('DELETE', '/api/v1/contacts/1');"]],
    ["glue", ["  await c.clients.contactsClient.update({ path: { contactId: given.path.contactId }, body: payloads.contactsCreateBody() });", "  return {};"]],
    ["forbidden", ["  const x = arguments[0];", "  return x;"]],
    ["builtin-patch", ["  Object.assign(c.clients.contactsClient, { zap: 1 });", "  return {};"]],
    ["builtin-patch", ["  given.path.contactId = 42;", "  return {};"]],
    ["glue", ["  const { contactsClient } = c.clients;", "  return {};"]],
    ["glue", ["  const clients = c.clients;", "  await clients.contactsClient.list();"]],
    ["computed-access", ["  await c['clients'].contactsClient.list();"]],
    ["call-apply-bind", ["  await c.clients.contactsClient.list.call(c.clients.contactsClient);"]],
    ["glue-slot", ["  await c.clients.contactsClient.create({ body: payloads.contactsCreateBody() });"]],
    ["shadow", ["  const c = 1;"]],
    ["test-reference", ["  test.info().annotations.push({ type: 'skip' });"]],
    ["assertion", ["  expect(1).toBe(1);"]],
    ["raw-request", ["  await fetch('/api/v1/contacts');"]],
    ["raw-request", ["  await new ContactsClient(undefined as never).list();"]],
  ];
  for (const [rule, lines] of cases) {
    setSlot(s, rel, key, lines);
    const found = ruleNames(s.rules());
    assert.ok(found.includes(rule), `${rule} (${lines.join(" ")}): ${found.join(", ")}`);
  }
  s.write(rel, good);
  assert.equal((await s.ac("check")).code, 0);
});

test("composite helpers: generated client calls only; no send, delete, assertion, raw request or foreign import", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const rel = "helpers/api/contacts.composite.ts";
  const ok = [
    "import type { APIResponse } from '@playwright/test';",
    "import type { ContactsClient } from '../../clients/contacts/contacts.client';",
    "import type { ContactsCreateRequest } from '../../clients/contacts/types';",
    "",
    "export async function createTwice(client: ContactsClient, body: ContactsCreateRequest): Promise<APIResponse[]> {",
    "  return [await client.create({ body }), await client.create({ body })];",
    "}",
    "",
  ].join("\n");
  s.write(rel, ok);
  assert.deepEqual(s.rules("clients"), []);
  const cases = [
    ["raw-request", ok.replace("import type { APIResponse }", "import axios from 'axios';\nimport type { APIResponse }")],
    ["session-reach", ok.replace("import type { ContactsCreateRequest } from '../../clients/contacts/types';", "import { sendRequest } from '../../clients/contacts/sender';\nimport type { ContactsCreateRequest } from '../../clients/contacts/types';")],
    ["session-reach", ok.replace("import type { ContactsClient } from", "import { ContactsClient } from")],
    ["re-export", `${ok}export { bodyOf } from '../../clients/contacts/support';\n`],
    ["free-identifier", ok.replace("  return [", "  const O = Object;\n  return [")],
    ["raw-request", ok.replace("import type { APIResponse }", "import { pick } from './util';\nimport type { APIResponse }")],
    ["raw-request", ok.replace("await client.create({ body })]", "await client.send('POST', '/x')]")],
    ["composite", ok.replace("await client.create({ body })]", "await client.delete({ path: { contactId: 1 } })]")],
    ["client-assertion", ok.replace("  return [", "  expect(body).toBeTruthy();\n  return [")],
    ["computed-access", ok.replace("await client.create({ body })]", "await client['create']({ body })]")],
    ["hardcoded", ok.replace("{ body })]", "{ body: { ...body, name: 'http://x.test' } })]")],
  ];
  for (const [rule, text] of cases) {
    s.write(rel, text);
    const found = ruleNames(s.rules("clients"));
    assert.ok(found.includes(rule), `${rule}: ${found.join(", ")}`);
  }
  s.write(rel, ok);
  assert.equal((await s.ac("check", "--clients")).code, 0);
});

test("client overlay: naming fixes and edge cases cited from the endpoint's own source, verbatim and whole", async () => {
  const s = await setup();
  const tags = s.ep("POST", "/api/v1/contacts/tags");
  const create = s.ep("POST", "/api/v1/contacts");
  const own = "spec:sources/spec-1.json#/paths/~1contacts~1tags/post";
  const overlay = (o) => writeJson(s.ctx().ap.clientOverlay, o);
  overlay({ methods: { [tags]: { name: "add", cite: [own] } } });
  assert.match((await s.ac("build")).out.problems.join("\n"), /'add' is not spelled by whole words of any cited source/, "a substring of addTag is not the name");
  overlay({ methods: { [tags]: { name: "addTag", cite: ["spec:sources/spec-1.json#/paths/~1contacts/post"] } } });
  assert.match((await s.ac("build")).out.problems.join("\n"), /is not a spec source of EP-contacts-\d+/, "another operation's node of the same file is not its source");
  overlay({ methods: { [tags]: { name: "addTag", cite: ["spec:sources/spec-1.json"] } } });
  assert.match((await s.ac("build")).out.problems.join("\n"), /is not a spec source of/, "the whole file is not the endpoint's own node");
  overlay({ methods: { [tags]: { name: "addTag", cite: ["knowledge:modules/contacts/notes.md"] } } });
  assert.match((await s.ac("build")).out.problems.join("\n"), /'addTag' is not spelled/, "a source that does not name it");
  overlay({ methods: { [create]: { name: "addTag", cite: [own] } } });
  assert.match((await s.ac("build")).out.problems.join("\n"), /is not a spec source of EP-contacts-\d+/, "a citation of another endpoint's source");
  overlay({ edgeCases: [{ endpoint: create, kind: "header", name: "Authorization", value: "x", cite: ["knowledge:modules/contacts/notes.md"] }] });
  assert.match((await s.ac("build")).out.problems.join("\n"), /carries credentials/);
  overlay({ edgeCases: [{ endpoint: create, kind: "header", name: "X-Requested-With", value: "XMLHttp", cite: ["knowledge:modules/contacts/notes.md"] }] });
  assert.match((await s.ac("build")).out.problems.join("\n"), /'XMLHttp' does not appear verbatim/);
  overlay({ edgeCases: [{ endpoint: create, kind: "note", text: "x", cite: ["testcase:TC-contacts-1"] }] });
  assert.match((await s.ac("build")).out.problems.join("\n"), /edgeCases\/0\/cite\/0 must match pattern/, "a test case is not a source for client code");
  overlay({
    classes: { tags: { name: "ContactsTagsClient", cite: [own] } },
    methods: { [tags]: { name: "addTag", cite: [own] } },
    edgeCases: [{ endpoint: create, kind: "header", name: "X-Requested-With", value: "XMLHttpRequest", cite: ["knowledge:modules/contacts/notes.md"] }],
  });
  const b = await s.ac("build");
  assert.match(b.out.problems.join("\n"), /'ContactsTags' is not spelled/, "a class name the source does not spell");
  overlay({ methods: { [tags]: { name: "addTag", cite: [own] } }, edgeCases: [{ endpoint: create, kind: "header", name: "X-Requested-With", value: "XMLHttpRequest", cite: ["knowledge:modules/contacts/notes.md"] }] });
  const ok = await s.ac("build");
  assert.equal(ok.code, 0, JSON.stringify(ok.out.problems));
  assert.match(s.read("clients/contacts/tags.client.ts"), /async addTag\(/);
  assert.match(s.read("clients/contacts/contacts.client.ts"), /async create\([^\n]*\n\s+return sendRequest\(this\.api, 'POST', '\/api\/v1\/contacts', \{ query: req\.query, headers: \{ \.\.\.\{ 'X-Requested-With': 'XMLHttpRequest' \}, \.\.\.req\.headers \}/);
  assert.ok(nameIn('"operationId": "addTag"', "addTag") && !nameIn('"operationId": "addTagged"', "addTag") && nameIn("Contact Tags", "ContactTags"));
  assert.ok(valueIn("X-Requested-With: XMLHttpRequest.", "XMLHttpRequest") && !valueIn("XMLHttpRequestX", "XMLHttpRequest"));
  // an edited overlay makes the build stale until it is rebuilt
  overlay({});
  assert.match((await s.ac("check")).out.problems.join("\n"), /stale: clientOverlay changed after the last build/);
});

test("the ledger: endpoints, scenarios, plan items deferred over the budget, payload slots pending until filled", async () => {
  const s = await setup({ budget: 20, check: false });
  await s.run("check");
  const b = await s.ac("build");
  assert.equal(b.code, 0, JSON.stringify(b.out.problems));
  const cov = s.cov();
  const kinds = new Set(cov.items.map((i) => i.kind));
  assert.deepEqual([...kinds].sort(), ["endpoint", "payload", "plan-item", "scenario"]);
  const deferred = cov.items.filter((i) => i.kind === "plan-item");
  assert.ok(deferred.length && deferred.every((i) => i.status === "deferred" && i.reason === "budget"));
  assert.ok(cov.items.filter((i) => i.kind === "payload").every((i) => i.status === "pending"), "an empty slot is pending");
  assert.equal(cov.summary.total, cov.items.length);
  const c = await s.ac("check");
  assert.equal(c.code, 1);
  assert.match(c.out.problems.join("\n"), /\[payload-slot\] contactsCreateBody\(\) is empty, and API-contacts-\d+/);
});

test("approved test cases tag their tests; a case no longer approved loses its tag (D-053)", async () => {
  const s = await setup();
  await s.ac("build");
  const linked = s.model().tests.find((t) => t.testcases.includes("TC-contacts-1"));
  assert.ok(linked.literal.endsWith("@TC-contacts-1"));
  markApproved(s.root, ["TC-contacts-2"]);
  const b = await s.ac("build");
  assert.match(b.out.warnings.join("\n"), new RegExp(`${linked.id}: TC-contacts-1 is no longer approved`));
  assert.doesNotMatch(s.model().tests.find((t) => t.id === linked.id).literal, /@TC-/);
});

test("lifecycle flows: each step through its client, bound to the created id, recorded and cleaned up", async () => {
  const s = await setup();
  await s.ac("build");
  const flow = s.plan().find((x) => x.key.endsWith("|flow|create-update-read"));
  const code = block(s.read("tests/api/contacts/contacts.spec.ts"), flow.id);
  assert.match(code, /const res1 = await contactsClient\.create\(\{ body: payloads\.contactsCreateBody\(\) \}\);/);
  assert.match(code, /const session = beginTest\(\{ module: 'contacts', label: '[^']+', recordCreated, recordDeleted, owns \}\);/, "the session records every create at once");
  assert.match(code, /const step2Id = refOf\(json1, '\/id'/);
  assert.match(code, /const sent2 = payloads\.contactsUpdateChangedBody\(\);\n[^\n]*\n\s+const res2 = await contactsClient\.update\(\{ path: \{ contactId: step2Id \}, body: sent2 \}\);/);
  assert.match(code, /expect\(mismatches\(json3, sent2\), '[^']*'\)\.toEqual\(\[\]\);/, "the read reflects the update");
  assert.match(code, /\} finally \{\n\s+await session\.end\(\{ contacts: \(ref\) => contactsClient\.delete\(\{ path: \{ contactId: ref \} \}\) \}\);/, "cleanup deletes, through its delete operation, only what this run owns");
  // M1: a type without a delete operation (tags) gets no deleter: the session leaves it recorded, never a recordDeleted
  const tag = s.plan().find((x) => x.rule === "happy-path" && x.endpoint === s.ep("POST", "/api/v1/contacts/tags"));
  const tagCode = block(s.read("tests/api/contacts/tags.spec.ts"), tag.id);
  assert.match(tagCode, /await session\.end\(\{ contacts: \(ref\) => contactsClient\.delete/);
  assert.doesNotMatch(tagCode, /tags: \(ref\)/);
});

test("the gate: an API module never generated is a blocker; once generated, Playwright's list must hold each scenario exactly once", async () => {
  const s = await setup();
  const r = gate("acme", "contacts", "playwright-api", { root: s.root, compile: false });
  const text = readFileSync(path.join(s.root, r.file), "utf8");
  assert.match(text, /the module's API code was never generated/);
  await scaffoldApiCode(s.root);
  assert.equal(gate("acme", "contacts", "playwright-api", { root: s.root, compile: false }).verdict, "pass");
  const listed = listSpecTitles(path.join(s.root, PW), "api", "contacts");
  const dup = structuredClone(listed);
  dup.report.suites[0].specs.push({ ...dup.report.suites[0].specs[0] });
  const tests = listedTests(dup.report);
  const f = listFindings(tests, { idRe: /API-contacts-\d+/g, unapproved: new Set(), what: "plan scenario", dir: "tests/api/contacts", known: new Set(s.model().tests.map((t) => t.id)) });
  assert.ok(f.some((x) => /lists API-contacts-\d+ twice/.test(x.problem)), "one test per scenario on the API side too");
  // through check, with Playwright's list injected (no compile command runs in a test)
  const viaCheck = await main(["check", "acme", "contacts"], { root: s.root, exec: () => null, listTests: () => dup });
  assert.match(viaCheck.out.problems.join("\n"), /\[traceability\] Playwright lists API-contacts-\d+ twice/);
  assert.match(viaCheck.out.problems.join("\n"), /\[missing-test\] Playwright lists "API-contacts-\d+ [^"]+" 2 times; the plan has it once/);
});

test("orchestration: the clients and tests steps count as done only after api-code.mjs check stamped what is on disk", async () => {
  const s = await setup();
  const go = () => next("acme", "playwright-api", "contacts", { root: s.root, compile: false });
  const act = go().actions[0];
  assert.equal(act.step, "discover");
  for (const name of ["discover", "plan"]) {
    step("acme", "playwright-api", "contacts", name, "start", undefined, { root: s.root });
    step("acme", "playwright-api", "contacts", name, "done", undefined, { root: s.root });
  }
  assert.equal(go().actions[0].step, "clients", "the API foundation is verified, so its step is skipped");
  step("acme", "playwright-api", "contacts", "clients", "start", undefined, { root: s.root });
  await s.ac("build");
  step("acme", "playwright-api", "contacts", "clients", "done", undefined, { root: s.root });
  const failed = go();
  assert.equal(failed.done?.failedStep, "clients");
  assert.match(failed.done.note, /the clients never passed api-code\.mjs check acme contacts --clients/);

  const t = await setup();
  const go2 = () => next("acme", "playwright-api", "contacts", { root: t.root, compile: false });
  for (const name of ["discover", "plan"]) {
    step("acme", "playwright-api", "contacts", name, "start", undefined, { root: t.root });
    step("acme", "playwright-api", "contacts", name, "done", undefined, { root: t.root });
  }
  step("acme", "playwright-api", "contacts", "clients", "start", undefined, { root: t.root });
  await scaffoldApiCode(t.root, { scope: "clients" });
  step("acme", "playwright-api", "contacts", "clients", "done", undefined, { root: t.root });
  assert.equal(go2().actions[0].step, "tests");
  step("acme", "playwright-api", "contacts", "tests", "start", undefined, { root: t.root });
  await scaffoldApiCode(t.root);
  step("acme", "playwright-api", "contacts", "tests", "done", undefined, { root: t.root });
  assert.equal(apiCodeUnverified(t.ctx(), "tests"), null);
  const after = go2();
  assert.ok(!after.done || after.done.outcome !== "failed", JSON.stringify(after));
});

test("typecheck: a failing tsc fails check and clears the stamp; --static stamps nothing", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  assert.equal(apiCodeUnverified(s.ctx(), "tests"), null);
  const bad = await main(["check", "acme", "contacts"], { root: s.root, exec: () => "tests/api/contacts/contacts.spec.ts(3,1): error TS2304", listTests: listSpecTitles });
  assert.equal(bad.code, 1);
  assert.match(bad.out.problems.join("\n"), /\[typecheck\] npx tsc --noEmit failed/);
  assert.match(apiCodeUnverified(s.ctx(), "tests"), /never passed/);
  const st = await main(["check", "acme", "contacts", "--static"], { root: s.root });
  assert.deepEqual([st.code, st.out.stamped], [0, false]);
  assert.equal((await main(["build", "acme", "contacts", "--clients"], { root: s.root })).code, 2, "usage");
});

test("guard: the generated files are managed, no caller writes one; each writer writes only its own files and runs only api-code.mjs", async () => {
  const s = await setup();
  await s.ac("build");
  const call = (agent, tool_name, tool_input) => normalize({ agent_type: agent, tool_name, tool_input }, { env: { CLAUDE_PROJECT_DIR: "/repo" }, host: "claude-code" });
  const w = (agent, rel) => checkTool(call(agent, "Write", { file_path: path.join(s.root, rel) }), s.root, {});
  const generated = ["fixtures/api/index.ts", "clients/contacts/facade.ts", "clients/contacts/contacts.client.ts", "clients/contacts/types.ts", "clients/contacts/support.ts", "config/api/schemas/contacts/contacts.json", "fixtures/api/clients/contacts.ts", "tests/api/contacts/contacts.spec.ts", "tests/api/contacts/new.spec.ts", "clients/contacts/CONTAC~1.TS", "TESTS/API/contacts/Contacts.Spec.ts"];
  for (const agent of ["pw-api-client-writer", "pw-api-tests-writer", "pw-api-fixer", "pw-api-scaffolder", "pw-repo-owner", undefined])
    for (const rel of generated) {
      const v = w(agent, `${PW}/${rel}`);
      assert.equal(v.allowed, false, `${agent ?? "unnamed"} may not write ${rel}`);
      assert.equal(v.rule, "managed-file", rel);
      assert.match(v.reason, /generated by scripts\/api-code\.mjs|generated from the module registrations/);
    }
  const own = { "pw-api-client-writer": [`${MOD}/api-code/client-overlay.json`, `${PW}/helpers/api/contacts.composite.ts`], "pw-api-tests-writer": [`${MOD}/api-code/tests-overlay.json`, `${PW}/helpers/api/contacts.payloads.ts`, `${PW}/helpers/api/contacts.glue.ts`] };
  for (const [agent, files] of Object.entries(own)) {
    for (const f of files) assert.equal(w(agent, f).allowed, true, `${agent} writes ${f}`);
    const other = Object.entries(own).find(([a]) => a !== agent)[1];
    for (const f of [...other, `${MOD}/api-code/plan.json`, `${MOD}/api-code/coverage.json`, `${PW}/helpers/api/schema.ts`, `${PW}/helpers/api/pagination.ts`]) assert.equal(w(agent, f).allowed, false, `${agent} may not write ${f}`);
    const sh = (cmd) => checkTool(call(agent, "Bash", { command: cmd }), s.root, {}).allowed;
    for (const cmd of ["node scripts/api-code.mjs build acme contacts", "node scripts/api-code.mjs check acme contacts", "node scripts/api-code.mjs check acme contacts --clients", "node scripts/api-code.mjs paths acme contacts"]) assert.equal(sh(cmd), true, `${agent}: ${cmd}`);
    for (const cmd of ["npx tsc --noEmit", "npx playwright test --list", "node scripts/ui-code.mjs build acme contacts", "node scripts/api-code.mjs build acme contacts; node -e 1", "echo x > playwright-tests/acme/tests/api/contacts/contacts.spec.ts"]) assert.equal(sh(cmd), false, `${agent}: ${cmd}`);
  }
  assert.equal(w("pw-api-fixer", `${PW}/helpers/api/contacts.payloads.ts`).allowed, true, "the fixer keeps the slot files");
});

test("titles and literals: one line, no id of another scenario, no quote that breaks the literal", () => {
  assert.equal(titleLit("API-contacts-1 a 'quoted' title"), `"API-contacts-1 a 'quoted' title"`);
  assert.equal(titleLit(`API-contacts-1 both ' and "`), `'API-contacts-1 both ’ and "'`);
  const blocks = specTests("test.describe('x', () => {\n  test('API-a-1 t', async ({ api }) => {\n    expect(1);\n  });\n});\n");
  assert.deepEqual(blocks.tests.map((t) => t.title), ["API-a-1 t"]);
  assert.equal(blocks.sig[blocks.tests[0].from].value, "expect", "the body starts after the arrow, not at the fixtures' braces");
});

test("paths lists what the writers read and write", async () => {
  const s = await setup();
  await s.ac("build");
  const out = (await s.ac("paths")).out;
  assert.equal(out.payloads, `${PW}/helpers/api/contacts.payloads.ts`);
  assert.equal(out.clientOverlay, `${MOD}/api-code/client-overlay.json`);
  assert.deepEqual(out.generated.specs, [`${PW}/tests/api/contacts/contacts.spec.ts`, `${PW}/tests/api/contacts/tags.spec.ts`]);
  assert.ok(out.generated.clients[0].methods.some((m) => m.startsWith("create (")));
  assert.ok(API_INDEX().includes("...contactsClients"));
});

test("the two prompts: build, write, rebuild at most twice, check; only planned scenarios and approved cases are automated", () => {
  for (const [agent, check] of [["pw-api-client-writer", "check <p> <m> --clients"], ["pw-api-tests-writer", "check <p> <m>"]]) {
    const prompt = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "agents", `${agent}.md`), "utf8");
    assert.deepEqual([...prompt.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ["Invocation", "Inputs", "What the script generates", "Steps", "Rules", "Return"], agent);
    assert.match(prompt, /node scripts\/api-code\.mjs build <p> <m>/);
    assert.ok(prompt.includes(`node scripts/api-code.mjs ${check}`), agent);
    assert.match(prompt, /at most twice more \(at most 3 builds\)/);
    assert.match(prompt, /Only planned scenarios are automated/);
    assert.match(prompt, /approved/);
    assert.match(prompt, /One plain command per call/);
    assert.doesNotMatch(prompt, /npx tsc|playwright test --list --project/, "the compile commands run inside check");
  }
});

test("U2: fixtures/api/index.ts is generated from every module's registration, the same bytes whoever writes it; any edit is drift", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root, { scope: "clients" });
  const index = s.read("fixtures/api/index.ts");
  assert.match(index, /^\/\/ Generated by scripts\/foundation\.mjs — do not edit\./);
  assert.match(index, /import \{ contactsClients, type ContactsClients \} from '\.\/clients\/contacts';\n\nexport const test = base\.extend<ContactsClients>\(\{ \.\.\.contactsClients \}\);\n\nexport \{ expect \} from '\.\/base';\n$/);
  assert.equal(index, renderIndex(path.join(s.root, PW), "api"));
  // another module's registration joins in name order; a file without the generator's header is not a registration
  s.write("fixtures/api/clients/billing.ts", "// Generated by scripts/api-code.mjs — do not edit. The module's client fixtures.\nexport type BillingClients = {\n};\n\nexport const billingClients = {\n};\n");
  s.write("fixtures/api/clients/zz.ts", "export type ZzClients = {\n};\nexport const zzClients = {\n};\n");
  assert.match(renderIndex(path.join(s.root, PW), "api"), /from '\.\/clients\/billing';\nimport \{ contactsClients[^\n]*\n\nexport const test = base\.extend<BillingClients & ContactsClients>\(\{ \.\.\.billingClients, \.\.\.contactsClients \}\);/);
  assert.doesNotMatch(renderIndex(path.join(s.root, PW), "api"), /zz/);
  const { main: foundation } = await import("./foundation.mjs");
  assert.equal((await foundation(["render", "acme", "--side", "api"], { root: s.root })).code, 0);
  const viaFoundation = s.read("fixtures/api/index.ts");
  await s.ac("build");
  assert.equal(s.read("fixtures/api/index.ts"), viaFoundation, "foundation.mjs render and api-code.mjs build write the same bytes");
  rmSync(s.file("fixtures/api/clients/billing.ts"));
  rmSync(s.file("fixtures/api/clients/zz.ts"));
  await s.ac("build");
  const good = s.read("fixtures/api/index.ts");
  // B1: nothing can silence expect, skip in a hook or override a fixture there any more: every edit is drift
  for (const text of [
    good.replace("export { expect } from './base';", "const noop = (): void => undefined;\nexport const expect = (..._a: unknown[]) => ({ toBe: noop });"),
    `${good}test.beforeEach(async ({}, info) => { info.skip(); });\n`,
    good.replace("({ ...contactsClients })", "({ ...contactsClients, ['contacts' + 'Client']: async ({}, use: (v: never) => Promise<void>) => use({} as never) })"),
    good.replace("({ ...contactsClients })", "({ ...contactsClients, api: async ({}, use) => use(undefined as never) })"),
  ]) {
    s.write("fixtures/api/index.ts", text);
    const f = s.rules("clients").filter((x) => x.rule === "fixture-registration");
    assert.match(f[0]?.problem ?? "", /fixtures\/api\/index\.ts differs from its render: it is generated from the module registrations/);
  }
  // an index hand-written before D-056: the build replaces it and keeps the old text, with a rebuild hint
  s.write("fixtures/api/index.ts", "import { test as base } from './base';\nexport const test = base.extend<{}>({});\nexport { expect } from './base';\n");
  const b = await s.ac("build");
  assert.match(b.out.warnings.join("\n"), /fixtures\/api\/index\.ts is now generated \(D-056\): the previous hand-written one is kept in artifacts\/acme\/foundation\/api-index\.legacy\.ts/);
  assert.equal(s.read("fixtures/api/index.ts"), good);
  assert.deepEqual(s.rules("clients"), []);
});

// The generated sender and facade, run in Node (type stripping): what the runtime enforces whatever the agents' code does.
async function runtime(s) {
  const dir = mkdtempSync(path.join(tmpdir(), "atf-sender-"));
  writeFileSync(path.join(dir, "support.mts"), renderSupport(s.ctx()));
  writeFileSync(path.join(dir, "sender.mts"), renderSender(s.ctx()).replace("from './support';", "from './support.mts';"));
  writeFileSync(path.join(dir, "facade.mts"), renderFacade(s.ctx(), s.model()));
  const support = await import(pathToFileURL(path.join(dir, "support.mts")).href);
  const sender = await import(pathToFileURL(path.join(dir, "sender.mts")).href);
  const facade = await import(pathToFileURL(path.join(dir, "facade.mts")).href);
  return { support, sender, facade };
}
const fakeRes = (status, body, headers = {}) => ({ ok: () => status >= 200 && status < 300, status: () => status, statusText: () => "", json: async () => body, headers: () => headers });

test("B2 runtime: a change to an entity this test did not create is refused, a create is recorded at once, track takes only a marked create, cleanup deletes only what is owned", async () => {
  const s = await setup();
  await s.ac("build");
  const { sender: m } = await runtime(s);
  const sent = [];
  const api = { fetch: async (url, init) => (sent.push(`${init.method} ${url}`), init.method === "POST" ? fakeRes(201, { id: 7 }) : init.method === "GET" ? fakeRes(200, { id: 42 }) : fakeRes(204, undefined)) };
  const calls = [];
  const ledger = { module: "contacts", label: "API-contacts-1", recordCreated: (e) => calls.push(`created ${e.type} ${e.ref}`), recordDeleted: (e) => calls.push(`deleted ${e.type} ${e.ref}`), owns: (type, ref) => ref !== "8" };
  const meta = { creates: { type: "contacts", pointer: "/id" } };
  await assert.rejects(m.sendRequest(api, "POST", "/contacts", { body: {} }, meta), /a create outside a test session/, "no create goes unrecorded");
  const session = m.beginTest(ledger);
  await assert.rejects(m.sendRequest(api, "DELETE", "/contacts/{contactId}", { path: { contactId: 42 } }, { deletes: { type: "contacts", param: "contactId" }, path: { contactId: { type: "contacts", kind: "integer", format: null } } }), /refused \(D-005\): DELETE \/contacts\/\{contactId\} names contactId=42, which this test did not create as a contacts/);
  await assert.rejects(m.sendRequest(api, "PUT", "/contacts/{contactId}", { path: { contactId: 42 }, body: {} }), /refused \(D-005\)/, "an update on any id, through send() too");
  await assert.rejects(m.sendGraphql(api, "/graphql", "mutation X { deleteContact(id: $id) }", { id: "42" }, "POST", undefined, { mutation: true, self: "contacts", deletes: { type: "contacts", param: "id" } }), /refused \(D-005\): mutation \/graphql sends the variables id=42/, "a GraphQL delete mutation (crud mutation) on an id this test did not create");
  assert.ok(!sent.some((x) => /42/.test(x)), "nothing was sent for a refused request");
  const read = await m.sendRequest(api, "GET", "/contacts/{contactId}", { path: { contactId: 42 } }, { path: { contactId: { type: "contacts", kind: "integer", format: null } } });
  assert.throws(() => m.createdBy(read), /not the response of a create this test sent/, "track can't put a pre-existing entity in the ledger");
  await assert.rejects(m.sendRequest(api, "DELETE", "/contacts/{contactId}", { path: { contactId: "not-a-number" } }, { path: { contactId: { type: "contacts", kind: "integer", format: null } } }), /is not a valid integer/, "N2: no non-numeric exception");
  await m.sendRequest(api, "DELETE", "/contacts/{contactId}", { path: { contactId: m.invalidPath("not-a-number") } }, { path: { contactId: { type: "contacts", kind: "integer", format: null } } });
  assert.ok(sent.includes("DELETE /contacts/not-a-number"), "only the plan's wrong-type fault (invalidPath, which only the generated spec imports) is sent as is");
  const created = await m.sendRequest(api, "POST", "/contacts", { body: {} }, meta);
  assert.deepEqual(calls, ["created contacts 7"], "recorded at once, by the sender");
  assert.deepEqual(m.createdBy(created), { type: "contacts", ref: "7", module: "contacts", label: "API-contacts-1" });
  await m.sendRequest(api, "PATCH", "/contacts/{contactId}", { path: { contactId: "7" }, body: {} }, { path: { contactId: { type: "contacts", kind: "integer", format: null } } });
  await assert.rejects(m.sendRequest(api, "PATCH", "/contacts/{contactId}", { path: { contactId: "7" }, body: {} }), /no entity type is known for it/, "N1: a reference of no known type names nothing this test owns");
  await m.sendRequest(api, "DELETE", "/contacts/{contactId}", { path: { contactId: "7" } }, { deletes: { type: "contacts", param: "contactId" } });
  assert.deepEqual(calls, ["created contacts 7", "deleted contacts 7"]);
  const api2 = { fetch: async (url, init) => (sent.push(`${init.method} ${url}`), init.method === "POST" ? fakeRes(201, { id: url.endsWith("tags") ? 9 : 8 }) : fakeRes(204, undefined)) };
  await m.sendRequest(api2, "POST", "/contacts/tags", { body: {} }, { creates: { type: "tags", pointer: "/id" } });
  await m.sendRequest(api2, "POST", "/contacts", { body: {} }, meta);
  const deleters = [];
  await session.end({ contacts: async (ref) => (deleters.push(ref), m.sendRequest(api2, "DELETE", "/contacts/{contactId}", { path: { contactId: ref } }, { deletes: { type: "contacts", param: "contactId" } })) });
  assert.deepEqual(deleters, [], "8 is not owned by this run (ledger owns() false), 7 is already deleted, tags has no delete operation");
  assert.deepEqual(calls, ["created contacts 7", "deleted contacts 7", "created tags 9", "created contacts 8"], "M1: no recordDeleted for a delete that did not happen");
  await assert.rejects(m.sendRequest(api, "DELETE", "/contacts/{contactId}", { path: { contactId: "7" } }), /refused/, "the session is over: nothing is owned any more");
});

test("B2 facade and B3 captured built-ins: glue and composite helpers get no delete or update; a later patch of a built-in can't change an assertion", async () => {
  const s = await setup();
  await s.ac("build");
  const { support: m, facade: f } = await runtime(s);
  const model = s.model();
  const contacts = model.clients.find((c) => c.fixture === "contactsClient");
  assert.deepEqual(contacts.methods.filter((x) => x.facade).map((x) => x.name).sort(), ["create", "list", "read"], "reads and creates; never delete, update or send");
  const fake = { delete: () => "deleted", update: () => "updated", updatePatch: () => "patched", send: () => "sent", list() { return this === fake ? "listed" : "unbound"; }, read: () => "read", create: () => "created" };
  const facade = f.contactsFacade({ contactsClient: fake, contactsTagsClient: { create: () => "tagged" } });
  assert.deepEqual(Object.keys(facade.contactsClient).sort(), ["create", "list", "read"]);
  assert.equal(facade.contactsClient.list(), "listed");
  assert.equal(facade.contactsClient.delete, undefined);
  assert.throws(() => Object.assign(facade.contactsClient, { delete: fake.delete }), /object is not extensible|Cannot add property/i, "frozen");
  // B3: patch the built-ins the assertions use, after the sender loaded, then check the helpers still tell the truth
  const res = fakeRes(404, {}, { "content-type": "application/json" });
  const saved = { includes: Array.prototype.includes, keys: Object.keys, stringify: JSON.stringify, indexOf: String.prototype.indexOf };
  try {
    Array.prototype.includes = () => true;
    Object.keys = () => ["allow"];
    JSON.stringify = () => "x";
    String.prototype.indexOf = () => 0;
    assert.equal(m.oneOf(res.status(), [200, 400]), false);
    assert.equal(m.hasHeader(res, "allow"), false);
    assert.equal(m.contains(["a"], "b"), false);
    assert.equal(m.contains("abc", "z"), false);
    assert.deepEqual(m.mismatches({ name: "a" }, { name: "b" }), ["/name"]);
  } finally {
    Object.assign(Array.prototype, { includes: saved.includes });
    Object.keys = saved.keys;
    JSON.stringify = saved.stringify;
    String.prototype.indexOf = saved.indexOf;
  }
});

test("B3 static: no agent file patches a built-in, a prototype or globalThis, nor an object it did not create", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const rel = "helpers/api/contacts.payloads.ts";
  const good = s.read(rel);
  for (const lines of [
    ["Object.getPrototypeOf([]).includes = () => true;"],
    ["Object.assign(Object, { keys: () => ['allow'] });"],
    ["Object.assign(JSON, { stringify: () => 'x' });"],
    ["Array.prototype.includes = () => true;"],
    ["JSON.stringify = () => 'x';"],
    ["Object.defineProperty(Array.prototype, 'includes', { value: () => true });"],
    ["export const k = ({} as { __proto__: unknown }).__proto__;"],
    ["uniqueName.x = 1;"],
    ["delete Object.keys;"],
  ]) {
    setSlot(s, rel, "helpers", lines);
    const found = ruleNames(s.rules());
    assert.ok(found.includes("builtin-patch") || found.includes("forbidden") || found.includes("computed-access"), `${lines.join(" ")}: ${found.join(", ")}`);
  }
  for (const lines of [["Reflect.set(Array.prototype, 'includes', () => true);"], ["export const p = new Proxy({}, {});"]]) {
    setSlot(s, rel, "helpers", lines);
    assert.ok(ruleNames(s.rules()).includes("forbidden"), lines.join(" "));
  }
  // a local object is fine to build up; Object.assign onto a new literal too
  setSlot(s, rel, "helpers", ["const base = { name: 'x' };", "base.name = 'y';", "export const merged = Object.assign({}, base, { status: 'lead' });"]);
  assert.deepEqual(ruleNames(s.rules()), []);
  s.write(rel, good);
  // the page-object form (not strict): own fields are fine, a built-in is not
  const sig = (text) => scanTs(text).filter((t) => t.type !== "comment");
  assert.deepEqual(builtinPatchFindings("p.ts", sig("class A { constructor(page) { this.save = page.x; } }"), () => 1, { strict: false }), []);
  assert.equal(builtinPatchFindings("p.ts", sig("Array.prototype.at = () => 1;"), () => 1, { strict: false })[0].rule, "builtin-patch");
});

test("U3: a changing request to an unknown id targets an entity this test created and deleted; without a create and a delete for the path it is a fixme", async () => {
  const spec = structuredClone(SPEC);
  spec.paths["/notes/{noteId}"] = { parameters: [{ in: "path", name: "noteId", required: true, schema: { type: "integer" } }], put: { tags: ["Contacts"], requestBody: { content: { "application/json": { schema: { type: "object", properties: { text: { type: "string" } } } } } }, responses: { 200: { description: "ok" } } } };
  const s = await setup({ spec, check: false });
  await s.run("check");
  const b = await s.ac("build");
  assert.equal(b.code, 0, JSON.stringify(b.out.problems));
  const plan = s.plan();
  const del = plan.find((x) => x.rule === "unknown-id" && x.endpoint === s.ep("DELETE", "/api/v1/contacts/{contactId}"));
  const t = s.model().tests.find((x) => x.id === del.id);
  assert.deepEqual(t.gone, { create: s.ep("POST", "/api/v1/contacts"), delete: s.ep("DELETE", "/api/v1/contacts/{contactId}"), deleteParam: "contactId", param: "contactId" });
  const code = block(s.read(t.file), t.id);
  assert.match(code, /const goneCreate = await contactsClient\.create\(\{ body: payloads\.contactsCreateBody\(\) \}\);\n\s+requireOk\(goneCreate, [^\n]*\);\n\s+const goneId = createdBy\(goneCreate\)\.ref;\n\s+requireOk\(await contactsClient\.delete\(\{ path: \{ contactId: goneId \} \}\), [^\n]*\);\n\s+const res = await contactsClient\.delete\(\{ path: \{ contactId: goneId \} \}\);/);
  assert.doesNotMatch(code, /unknownId\(/, "never a made-up id for a request that changes data");
  const read = plan.find((x) => x.rule === "unknown-id" && x.endpoint === s.ep("GET", "/api/v1/contacts/{contactId}"));
  assert.match(block(s.read(t.file), read.id), /contactsClient\.read\(\{ path: \{ contactId: unknownId\('integer', null\) \} \}\)/, "a read may use a valid id that does not exist");
  const note = plan.find((x) => x.rule === "unknown-id" && x.endpoint === s.ep("PUT", "/api/v1/notes/{noteId}"));
  const nt = s.model().tests.find((x) => x.id === note.id);
  assert.equal(nt.kind, "blocked");
  assert.match(nt.reason, /an unknown id for PUT \/api\/v1\/notes\/\{noteId\} is an entity this run created and deleted \(D-005\), and the catalogue has no create with a delete operation on that path/);
  assert.match(block(s.read(nt.file), nt.id), /test\.fixme\(true, 'blocked: an unknown id for PUT/);
});

test("D3 and M2: glue on a scenario that changes nothing still opens a session and cleans up what it created; the generated text and, when a compiler is given, tsc", async () => {
  const s0 = await setup({ check: false });
  const rename = { name: "archived-rename", endpoint: s0.ep("PUT", "/api/v1/contacts/{contactId}"), type: "business", title: "renaming an archived contact is refused", request: { base: "valid", setup: [{ endpoint: s0.ep("POST", "/api/v1/contacts"), pointer: "/id", param: "contactId" }] }, expect: { statusClass: "4xx", source: "knowledge:modules/contacts/notes.md" }, citations: ["knowledge:modules/contacts/notes.md"] };
  const hidden = { name: "archived-read", endpoint: s0.ep("GET", "/api/v1/contacts"), type: "business", title: "archived contacts are hidden from the list", request: { base: "valid" }, expect: { statusClass: "2xx", source: "knowledge:modules/contacts/notes.md" }, citations: ["knowledge:modules/contacts/notes.md"] };
  const s = await setup({ planOverlay: { scenarios: [rename, hidden] } });
  const [a, b] = ["archived-rename", "archived-read"].map((k) => s.plan().find((x) => x.key === `overlay|${k}`));
  assert.equal(b.mutates, false);
  writeJson(s.ctx().ap.testsOverlay, { glue: [a, b].map((x) => ({ scenario: x.id, reason: "archive a contact first, as the notes say", cite: ["knowledge:modules/contacts/notes.md"] })) });
  const { model } = await scaffoldApiCode(s.root, {
    fill: (x) => (x.endpoint === s.ep("POST", "/api/v1/contacts/tags") ? ["  return { label: uniqueName('tag') };"] : x.kind === "query" || x.kind === "headers" ? ["  return {};"] : ["  return { name: uniqueName('contact') };"]),
  });
  const code = block(s.read(model.tests.find((t) => t.id === b.id).file), b.id);
  assert.match(code, /const session = beginTest\(/, "D3: the session is always declared");
  assert.match(code, /await session\.end\(\{ contacts: \(ref\) => contactsClient\.delete\(\{ path: \{ contactId: ref \} \}\) \}\);/, "and cleans up what the glue created");
  assert.doesNotMatch(code, /created\.push/);
  const root = process.env.ATF_TSC_ROOT;
  if (!root || !existsSync(path.join(root, "node_modules", "typescript", "bin", "tsc"))) return; // like the gate's compile mode: only with a compiler
  const dir = mkdtempSync(path.join(root, "atf-g6-"));
  try {
    cpSync(s.file(""), dir, { recursive: true });
    const r = spawnSync(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "--noEmit", "-p", "."], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 0, `tsc: ${r.stdout}${r.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("M4: the slot files and the composite helpers may import the scaffolder's helpers/api/<topic>.ts, which are checked as agent code", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  s.write("helpers/api/pagination.ts", "export const firstPage = 1;\n");
  const rel = "helpers/api/contacts.payloads.ts";
  setSlot(s, rel, "imports", ["import { firstPage } from './pagination';"]);
  setSlot(s, rel, "helpers", ["export const startPage = firstPage;"]);
  assert.deepEqual(s.rules(), []);
  for (const [rule, line] of [["imports", "import { contactsCreateBody } from './contacts.glue';"], ["imports", "import { validateSchema } from './schema';"], ["imports", "import { test } from '../../fixtures/api';"], ["imports", "import * as fs from 'node:fs';"]]) {
    setSlot(s, rel, "imports", [line]);
    assert.ok(ruleNames(s.rules()).includes(rule), `${line}: ${ruleNames(s.rules())}`);
  }
  setSlot(s, rel, "imports", ["import { firstPage } from './pagination';"]);
  for (const [rule, text] of [["test-runner-import", "import { test } from '../../fixtures/api';\ntest.beforeEach(async ({}, i) => i.skip());\nexport const firstPage = 1;\n"], ["raw-request", "export const firstPage = 1;\nexport const go = () => fetch('/x');\n"], ["builtin-patch", "Object.assign(Object, { keys: () => [] });\nexport const firstPage = 1;\n"]]) {
    s.write("helpers/api/pagination.ts", text);
    const f = s.rules().filter((x) => x.file === "helpers/api/pagination.ts");
    assert.ok(f.some((x) => x.rule === rule && /imported by helpers\/api\/contacts\.payloads\.ts/.test(x.problem)), `${rule}: ${JSON.stringify(f.map((x) => x.rule))}`);
  }
});

test("older modules: build --adopt moves hand-written files out of the generated folders into api-code/legacy/", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  s.write("tests/api/contacts/old.spec.ts", "// hand-written before D-056\nexport {};\n");
  s.write("clients/contacts/old.client.ts", "export class Old {}\n");
  const before = s.rules();
  assert.ok(before.some((f) => f.rule === "extra-file" && /--adopt: it moves the file to artifacts\/acme\/modules\/contacts\/api-code\/legacy\//.test(f.fix)));
  const b = await s.ac("build", "--adopt");
  assert.deepEqual(b.out.adopted.map((x) => x.from).sort(), ["clients/contacts/old.client.ts", "tests/api/contacts/old.spec.ts"]);
  assert.ok(existsSync(path.join(s.ctx().ap.dir, "legacy", "tests/api/contacts/old.spec.ts")));
  assert.ok(!existsSync(s.file("tests/api/contacts/old.spec.ts")));
  assert.deepEqual(s.rules(), []);
  assert.equal((await s.ac("build", "--clients")).code, 2, "build takes --adopt only");
});

test("M4: pw-api-fixer writes only the slot files, the composite helpers and the gap helpers; its prompt sends overlay changes to their writers", async () => {
  const s = await setup();
  await s.ac("build");
  const call = (agent, tool_name, tool_input) => normalize({ agent_type: agent, tool_name, tool_input }, { env: { CLAUDE_PROJECT_DIR: "/repo" }, host: "claude-code" });
  const w = (rel) => checkTool(call("pw-api-fixer", "Write", { file_path: path.join(s.root, rel) }), s.root, {}).allowed;
  for (const f of [`${PW}/helpers/api/contacts.payloads.ts`, `${PW}/helpers/api/contacts.glue.ts`, `${PW}/helpers/api/contacts.composite.ts`, `${PW}/helpers/api/pagination.ts`]) assert.equal(w(f), true, f);
  for (const f of [`${MOD}/api-code/client-overlay.json`, `${MOD}/api-code/tests-overlay.json`, `${PW}/fixtures/api/index.ts`, `${PW}/clients/contacts/contacts.client.ts`, `${PW}/tests/api/contacts/contacts.spec.ts`, `${PW}/helpers/api/schema.ts`]) assert.equal(w(f), false, f);
  const prompt = readFileSync(path.join(repoDir, "agents", "pw-api-fixer.md"), "utf8");
  assert.doesNotMatch(prompt, /fix the agents' own parts instead:[^\n]*overlays in/i);
  assert.match(prompt, /client-overlay\.json[^\n]*report/i);
});

test("B1, both sides: no helper or page object takes the test runner (a hook, a skip, a fixture override, a fake expect for every spec that imports it)", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  s.write("helpers/api/hooks.ts", "import { test } from '../../fixtures/api';\ntest.beforeEach(async ({}, info) => { info.skip(); });\nexport const n = 1;\n");
  const r = gate("acme", "contacts", "playwright-api", { root: s.root, compile: false });
  assert.match(readFileSync(path.join(s.root, r.file), "utf8"), /helpers\/api\/hooks\.ts \| 1 \| test-runner-import \| helpers\/api\/hooks\.ts imports test from \.\.\/\.\.\/fixtures\/api/);
  const f = (text) => runnerImportFindings("pages/contacts/contacts.page.ts", text).map((x) => x.rule);
  assert.deepEqual(f("import { expect } from '@playwright/test';\n"), ["test-runner-import"]);
  assert.deepEqual(f("import { test as t } from '../../fixtures/ui';\n"), ["test-runner-import"]);
  assert.deepEqual(f("import * as pw from '@playwright/test';\n"), ["test-runner-import"]);
  assert.deepEqual(f("const pw = require('@playwright/test');\n"), ["test-runner-import"]);
  assert.deepEqual(f("import type { Page, Locator } from '@playwright/test';\nimport { type Page as P } from '@playwright/test';\n"), [], "type-only imports are fine");
});

// ---------- fix round 2: ownership by type, formats, plain-create facade, entity references, the sender's reach,
// the allowlist, the composite seed, older modules ----------

test("N1 and N2: ownership is (type, canonical id); every path value has its schema's format, a change names an owned entity; only invalidPath skips", async () => {
  const s = await setup();
  await s.ac("build");
  const { sender: m, support } = await runtime(s);
  const sent = [];
  const api = { fetch: async (url, init) => (sent.push(`${init.method} ${url}`), init.method === "POST" ? fakeRes(201, { id: 7 }) : fakeRes(200, {})) };
  const ledger = { module: "contacts", label: "API-contacts-1", recordCreated: () => {}, recordDeleted: () => {}, owns: () => true };
  const int = (type) => ({ type, kind: "integer", format: null });
  const session = m.beginTest(ledger);
  await m.sendRequest(api, "POST", "/contacts", { body: {} }, { creates: { type: "contacts", pointer: "/id" } });
  // N1: contacts 7 is owned; notes 7 is not, nor is an entity of another type with the same id
  await m.sendRequest(api, "PUT", "/contacts/{contactId}", { path: { contactId: 7 }, body: {} }, { path: { contactId: int("contacts") } });
  await assert.rejects(m.sendRequest(api, "PUT", "/notes/{noteId}", { path: { noteId: 7 }, body: {} }, { path: { noteId: int("notes") } }), /names noteId=7, which this test did not create as a notes/);
  // N2: the integer format, for reads too, and no non-numeric exception for a change
  for (const bad of ["7 ", "+7", "07", "7.0", "1e3", "-1", "", "abc"]) {
    await assert.rejects(m.sendRequest(api, "GET", "/contacts/{contactId}", { path: { contactId: bad } }, { path: { contactId: int("contacts") } }), /is not a valid integer/, JSON.stringify(bad));
    await assert.rejects(m.sendRequest(api, "DELETE", "/contacts/{contactId}", { path: { contactId: bad } }, { path: { contactId: int("contacts") } }), /refused/, JSON.stringify(bad));
  }
  await assert.rejects(m.sendRequest(api, "GET", "/files/{name}", { path: { name: "../etc" } }, { path: { name: { type: null, kind: "string", format: null } } }), /is not a valid string/, "a string segment: no slash, no dot-dot traversal");
  await assert.rejects(m.sendRequest(api, "GET", "/users/{userId}", { path: { userId: "x" } }, { path: { userId: { type: null, kind: "string", format: "uuid" } } }), /is not a valid uuid/);
  await m.sendRequest(api, "GET", "/contacts/{contactId}", { path: { contactId: support.unknownId("integer", null) } }, { path: { contactId: int("contacts") } });
  await assert.rejects(m.sendRequest(api, "GET", "/contacts/{contactId}", { path: { contactId: { invalid: "x" } } }, { path: { contactId: int("contacts") } }), /is not a string or a number/, "an object that merely looks like invalidPath's is refused");
  await m.sendRequest(api, "GET", "/contacts/{contactId}", { path: { contactId: m.invalidPath("x") } }, { path: { contactId: int("contacts") } });
  assert.ok(sent.includes("GET /contacts/x"));
  await session.end({});
  // the generated client hands the sender each path parameter's type and format
  const client = s.read("clients/contacts/contacts.client.ts");
  assert.match(client, /contactId: \{ type: 'contacts', kind: 'integer', format: null \}/);
  assert.match(client, /import \{ sendRequest \} from '\.\/sender';/);
});

test("N3a and X2: the catalogue classifies by path only; the facade offers reads and plain creates only, and an action-sounding create stays a recorded create", async () => {
  // X2: the path alone makes an action (a destructive or action segment, or an action after an id); hints never do
  assert.equal(crudOf("POST", "/contacts"), "create");
  assert.equal(crudOf("POST", "/contacts/tags"), "create");
  assert.equal(crudOf("POST", "/contacts/bulk-delete"), "action");
  assert.equal(crudOf("POST", "/contacts/purge"), "action");
  assert.equal(crudOf("POST", "/contacts/remove"), "action");
  assert.equal(crudOf("POST", "/orders/cancel"), "action");
  assert.equal(crudOf("POST", "/contacts/{contactId}/archive"), "action");
  assert.equal(crudOf("POST", "/blocks", { operationId: "createBlock" }), "create", "a hint is ignored");
  assert.equal(crudOf("POST", "/contacts/imports", { operationId: "purgeContacts" }), "create", "a hint is ignored");
  const spec = structuredClone(SPEC);
  const ok = { 201: { description: "ok" } };
  const body = { content: { "application/json": { schema: { type: "object", properties: { ids: { type: "array", items: { type: "integer" } } } } } } };
  spec.paths["/contacts/bulk-delete"] = { post: { tags: ["Contacts"], requestBody: body, responses: ok } };
  spec.paths["/contacts/jobs"] = { post: { tags: ["Contacts"], operationId: "purgeContacts", requestBody: body, responses: ok } };
  spec.paths["/contacts/merges"] = { post: { tags: ["Contacts"], summary: "Merge duplicate contacts", requestBody: body, responses: ok } };
  spec.paths["/contacts/blocks"] = { post: { tags: ["Contacts"], operationId: "createBlock", requestBody: body, responses: ok } };
  spec.paths["/contacts/batches"] = { post: { tags: ["Contacts"], summary: "Create a batch", requestBody: body, responses: ok } };
  spec.paths["/contacts/quick"] = { post: { tags: ["Contacts"], summary: "Create a contact and assign an owner", requestBody: body, responses: ok } };
  spec.paths["/contacts/{contactId}/archive"] = { parameters: [{ in: "path", name: "contactId", required: true, schema: { type: "integer" } }], post: { tags: ["Contacts"], responses: ok } };
  const s = await setup({ spec, check: false });
  await s.run("check");
  assert.equal((await s.ac("build")).code, 0);
  const catalogue = JSON.parse(readFileSync(s.ap.catalogue, "utf8"));
  const crud = (p) => catalogue.find((e) => e.method === "POST" && e.path === `/api/v1${p}`).crud;
  for (const p of ["/contacts/jobs", "/contacts/merges", "/contacts/blocks", "/contacts/batches", "/contacts/quick"]) assert.equal(crud(p), "create", `${p}: a create by its path, whatever its operationId or summary says`);
  for (const p of ["/contacts/bulk-delete", "/contacts/{contactId}/archive"]) assert.equal(crud(p), "action", p);
  const methods = s.model().clients.flatMap((c) => c.methods.map((m) => ({ ...m, client: c.fixture })));
  const inFacade = methods.filter((m) => m.facade).map((m) => `${m.method} ${m.path}`).sort();
  assert.deepEqual(inFacade, ["GET /api/v1/contacts", "GET /api/v1/contacts/{contactId}", "POST /api/v1/contacts", "POST /api/v1/contacts/tags"]);
  for (const p of ["/api/v1/contacts/bulk-delete", "/api/v1/contacts/jobs", "/api/v1/contacts/merges", "/api/v1/contacts/blocks", "/api/v1/contacts/batches", "/api/v1/contacts/quick", "/api/v1/contacts/{contactId}/archive"]) assert.ok(methods.some((m) => m.path === p && !m.facade), p);
  // what an action-sounding create makes is recorded at once and cleaned up like any create: it keeps meta.creates
  for (const p of ["/api/v1/contacts/jobs", "/api/v1/contacts/merges", "/api/v1/contacts/blocks", "/api/v1/contacts/batches", "/api/v1/contacts/quick"]) {
    const m = methods.find((x) => x.path === p);
    assert.ok(m.meta.creates, `${p} records what it creates`);
    assert.equal(m.meta.bulk, true, `${p}: its body's id arrays are references`);
  }
  for (const c of ["ContactsArchiveClient", "ContactsBulkDeleteClient", "ContactsJobsClient", "ContactsMergesClient", "ContactsBlocksClient", "ContactsBatchesClient", "ContactsQuickClient"]) assert.match(s.read("clients/contacts/facade.ts"), new RegExp(`Pick<${c}, never>`), c);
});

test("X1: no agent file names constructor, prototype, __proto__, caller, callee or arguments in any position, nor uses a computed member or key but a number or a loop counter", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const rel = "helpers/api/contacts.payloads.ts";
  const good = s.read(rel);
  const forms = [
    // the validator's repro: arbitrary code through destructured constructors
    [["const { constructor: C } = 'x';", "const { constructor: F } = C;", "F('Object.is = () => true')();"], ["forbidden-property"]],
    [["const { a: { constructor: F } } = { a: 'x' };", "export const f = F;"], ["forbidden-property"]],
    [["const { constructor } = [];", "export const f = constructor;"], ["forbidden-property"]],
    [["export const f = [].constructor;"], ["forbidden-property"]],
    [["export const f = [1]?.constructor;"], ["forbidden-property"]],
    [["export const p = ({ a: 1 }).__proto__;"], ["forbidden-property"]],
    [["function g() { return 1; }", "export const c = g.caller;"], ["forbidden-property"]],
    [["export const o = { prototype: 1 };"], ["forbidden-property"]],
    [["export const k = 'x'['constructor'];"], ["forbidden-property", "computed-access"]],
    [["export const has = 'constructor' in {};"], ["forbidden-property"]],
    [["export const k = `constructor${''}`;"], ["forbidden-property"]],
    [["export const f = 'x'[`${'con'}structor`];"], ["computed-access"]],
    [["const k = 'con' + 'structor';", "export const f = ('x' as unknown as Record<string, unknown>)[k];"], ["computed-access"]],
    [["const k = 'con' + 'structor';", "export const f = [1]?.[k];"], ["computed-access"]],
    [["const k = 'con' + 'structor';", "const { [k]: F } = 'x';", "export const f = F;"], ["computed-access"]],
    [["const k = 'con' + 'structor';", "export const o = { [k]: 1 };"], ["computed-access"]],
    [["export const v = /x/[`con${'struc'}tor`];"], ["computed-access"]],
    [["export const v = (1)[String(1)];"], ["computed-access"]],
    [["const list = [1, 2];", "for (let i = 0; i < list.length; i++) i = 1;", "export const v = list[i];"], ["computed-access"]],
    [["const list = [1, 2];", "let i = 0;", "export const v = list[i];"], ["computed-access"]],
  ];
  for (const [lines, rules] of forms) {
    setSlot(s, rel, "helpers", lines);
    const found = ruleNames(s.rules());
    for (const rule of rules) assert.ok(found.includes(rule), `${rule} (${lines.join(" ")}): ${found.join(", ")}`);
  }
  // inside a builder (a wrapped slot) and in a glue slot too
  setSlot(s, rel, "payload contactsCreateBody", ["  const { constructor: C } = 'x';", "  return { name: String(C) };"]);
  assert.ok(ruleNames(s.rules()).includes("forbidden-property"));
  s.write(rel, good);
  // a number literal and a for-loop counter still index; types are not code
  setSlot(s, rel, "helpers", ["const list = [1, 2, 3];", "let sum = 0;", "for (let i = 0; i < list.length; i++) sum += list[i];", "export const total = sum + list[0];", "export type First = (typeof list)[number];", "type Shape = { name: string };", "export type Name = Shape['name'];"]);
  assert.deepEqual(s.rules(), []);
  s.write(rel, good);
  assert.deepEqual(s.rules(), []);
  // the composite helpers, a whole agent file
  const comp = "helpers/api/contacts.composite.ts";
  const seed = renderCompositeSeed(s.ctx());
  s.write(comp, `${seed}\nexport const c = (1).constructor;\nexport const d = ({ a: 1 } as Record<string, number>)[String('a')];\n`);
  assert.deepEqual(ruleNames(s.rules("clients").filter((f) => f.file === comp)).filter((r) => ["forbidden-property", "computed-access"].includes(r)), ["computed-access", "forbidden-property"]);
  s.write(comp, seed);
  assert.deepEqual(s.rules("clients").filter((f) => f.file === comp), []);
});

test("X1 round 4: agent code writes no escape but the seven plain ones, every escape is decoded before the name rules, and ordinary TypeScript passes", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const rel = "helpers/api/contacts.payloads.ts";
  const good = s.read(rel);
  const bs = String.fromCharCode(92); // built at run time: the escapes stay escapes in this file
  const forms = [
    // D-1, the findings repro: a hex escape spells constructor and reaches Function
    [[`const { 'constr${bs}x75ctor': C } = 'x';`, `const { 'constr${bs}x75ctor': F } = C;`, "F('Object.is = () => true')();"], ["escape", "forbidden-property"]],
    [[`const { 'constr${bs}u{75}ctor': C } = 'x';`, "export const c = C;"], ["escape", "forbidden-property"]],
    [[`const { 'constr${bs}u0075ctor': C } = 'x';`, "export const c = C;"], ["escape", "forbidden-property"]],
    [[`const { 'constr${bs}165ctor': C } = 'x';`, "export const c = C;"], ["escape"]],
    // a line continuation
    [[`const { 'constr${bs}`, `uctor': C } = 'x';`, "export const c = C;"], ["escape", "forbidden-property"]],
    // identifiers written with \u escapes
    [[`const { constr${bs}u{75}ctor: C } = 'x';`, "export const c = C;"], ["escape", "forbidden-property"]],
    [[`export const f = 'x'.constr${bs}u0075ctor;`], ["escape", "forbidden-property"]],
    [[`export const f = ${bs}u0065val;`], ["escape", "free-identifier"]],
    [[`export const ${bs}u0061 = 1;`], ["escape"]],
    // a template's text, and any \x or \u even when it spells nothing harmful
    [["export const t = `constr" + bs + "x75ctor${1}`;"], ["escape", "forbidden-property"]],
    [[`export const s = '${bs}x41';`], ["escape"]],
    [["export const s = `" + bs + "u{41}`;"], ["escape"]],
    // D-2: a computed key inside an object pattern is still computed access
    [["const k = 'a';", "const { [k]: v } = { a: 1 };", "export const w = v;"], ["computed-access"]],
    // delete: only a member of an object this code created, written plainly
    [["export function drop(o: { a?: number }) { delete o.a; }"], ["builtin-patch"]],
    [["const o = { a: { b: 1 } };", "delete o.a.b;"], ["builtin-patch"]],
    [["const o = { a: 1 };", "delete (o.a);"], ["builtin-patch"]],
  ];
  for (const [lines, rules] of forms) {
    setSlot(s, rel, "helpers", lines);
    const found = ruleNames(s.rules());
    for (const rule of rules) assert.ok(found.includes(rule), `${rule} (${lines.join(" ")}): ${found.join(", ")}`);
  }
  // inside a builder (a wrapped slot) too
  setSlot(s, rel, "payload contactsCreateBody", [`  const { 'constr${bs}x75ctor': C } = 'x';`, "  return { name: String(C) };"]);
  assert.ok(ruleNames(s.rules()).includes("escape"));
  s.write(rel, good);
  // the seven plain escapes; array destructuring (D-2), typed locals (D-3) and a plain delete of an own member
  setSlot(s, rel, "helpers", [
    `export const plain = 'a${bs}n${bs}t${bs}r${bs}${bs}${bs}'${bs}"' + "${bs}"" + \`${bs}\`${1}\`;`,
    "const pair = [1, 2];",
    "const [a, b] = pair;",
    "const [[x], y = 3] = [[1], 2];",
    "let [p, q] = [a, b];",
    "export const sum = a + b + x + y + p + q;",
    "export function rows(m: Map<string, number>): string[] {",
    "  const out: string[] = [];",
    "  const byKey: Record<string, number> = {};",
    "  const seen = new Set<string>();",
    "  const pairs: Array<[string, number]> = [];",
    "  const modes = ['a', 'b'] as const;",
    "  for (const [k, v] of m) {",
    "    out.push(`${k}=${v}`);",
    "    byKey.last = v;",
    "    seen.add(k);",
    "    pairs.push([k, v]);",
    "  }",
    "  const body = { a: 1, b: 2 };",
    "  delete body.b;",
    "  return [...out, ...modes, String(pairs.length + body.a)];",
    "}",
  ]);
  assert.deepEqual(s.rules(), []);
  s.write(rel, good);
  // D-3 and D-4 in the composite helpers: a typed empty array and a throw are ordinary code
  const comp = "helpers/api/contacts.composite.ts";
  const seed = renderCompositeSeed(s.ctx());
  s.write(comp, `${seed}\nexport function firstOk(codes: number[]): number {\n  const out: number[] = [];\n  for (const c of codes) if (c < 400) out.push(c);\n  if (!out.length) throw new Error('no ok status');\n  return out[0];\n}\n`);
  assert.deepEqual(s.rules("clients").filter((f) => f.file === comp), []);
  s.write(comp, seed);
  // D-4: every keyword is a keyword, never a free identifier; this and with say what they are
  const f = (code, declared) => freeIdentifierFindings("x.ts", code, { declared, wrap: true }).map((x) => x.problem);
  assert.deepEqual(f("  if (!x) throw new Error('x');\n  void 0;\n  return typeof x === 'number' && x instanceof K ? 1 : 'a' in {} ? 2 : 3;", ["x", "K"]), []);
  assert.match(f("  return this;", [])[0], /uses this/);
});

test("X4: the plan's values are applied and planned first; an agent field that would replace one is refused; every other agent field is checked", async () => {
  const s0 = await setup({ check: false });
  const post = s0.ep("POST", "/api/v1/contacts");
  const put_ = s0.ep("PUT", "/api/v1/contacts/{contactId}");
  const scenario = { name: "archived-rename", endpoint: put_, type: "business", title: "renaming an archived contact is refused", request: { base: "valid", setup: [{ endpoint: post, pointer: "/id", param: "contactId" }], values: { "/name": "Ada" } }, expect: { statusClass: "4xx", source: "knowledge:modules/contacts/notes.md" }, citations: ["knowledge:modules/contacts/notes.md"] };
  const s = await setup({ planOverlay: { scenarios: [scenario] } });
  const business = s.plan().find((x) => x.rule === "overlay");
  writeJson(s.ctx().ap.testsOverlay, { glue: [{ scenario: business.id, reason: "archive the contact before renaming it", cite: ["knowledge:modules/contacts/notes.md"] }] });
  const { model } = await scaffoldApiCode(s.root);
  const code = block(s.read(model.tests.find((t) => t.id === business.id).file), business.id);
  assert.match(code, /body: planned\(mergeAgent\(planned\(withValues\(payloads\.contactsUpdateBody\(\), \{ '\/name': 'Ada' \}\), \['\/name'\]\), arranged\.body\), \['\/name'\]\)/, "values, planned, then the agent's fields");
  const { sender: m } = await runtime(s);
  const sent = [];
  const api = { fetch: async (url, init) => (sent.push(`${init.method} ${url} ${JSON.stringify(init.data ?? {})}`), init.method === "POST" ? fakeRes(201, { id: 7 }) : fakeRes(200, {})) };
  const session = m.beginTest({ module: "contacts", label: "x", recordCreated: () => {}, recordDeleted: () => {}, owns: () => true });
  await m.sendRequest(api, "POST", "/contacts", { body: {} }, { creates: { type: "contacts", pointer: "/id" } });
  const meta = { refs: { ownerId: "users", contactId: "contacts" } };
  const base = () => m.planned({ ownerId: 99, text: "x" }, ["/ownerId"]);
  assert.throws(() => m.mergeAgent(base(), { ownerId: 42 }), /refused: the agent body field ownerId would replace the value the plan sets at \/ownerId/, "never silently");
  assert.throws(() => m.mergeAgent(m.planned({ owner: { id: 99 } }, ["/owner/id"]), { owner: { id: 42 } }), /would replace/, "a parent of a planned pointer");
  await m.sendRequest(api, "PUT", "/notes", { body: m.mergeAgent(base(), { text: "y" }) }, meta);
  assert.ok(sent.at(-1).includes('"ownerId":99'), "the plan's value is still planned after the merge");
  await assert.rejects(m.sendRequest(api, "PUT", "/notes", { body: m.mergeAgent(base(), { contactId: 42 }) }, meta), /contactId=42/, "an agent field is checked");
  await m.sendRequest(api, "PUT", "/notes", { body: m.mergeAgent(base(), { contactId: 7 }) }, meta);
  assert.equal(m.mergeAgent(base(), undefined).ownerId, 99);
  await session.end({});
});

test("X3: a field with an id format, a field named after a resource or path parameter, and an id array of a destructive or action endpoint are references", async () => {
  const spec = structuredClone(SPEC);
  const ok = { 201: { description: "ok" } };
  const json = (properties) => ({ content: { "application/json": { schema: { type: "object", properties } } } });
  spec.paths["/contacts/notes"] = { post: { tags: ["Contacts"], requestBody: json({ text: { type: "string" }, contact: { type: "integer" }, ref: { type: "string", format: "uuid" }, owner: { type: "integer" }, pinned: { type: "boolean" } }), responses: ok } };
  spec.paths["/contacts/owners"] = { get: { tags: ["Contacts"], responses: { 200: { description: "ok" } } } };
  spec.paths["/contacts/bulk-delete"] = { post: { tags: ["Contacts"], requestBody: json({ items: { type: "array", items: { type: "integer" } } }), responses: { 200: { description: "ok" } } } };
  const s = await setup({ spec, check: false });
  await s.run("check");
  assert.equal((await s.ac("build")).code, 0);
  const model = s.model();
  const method = (p) => model.clients.flatMap((c) => c.methods).find((x) => x.method === "POST" && x.path === `/api/v1${p}`);
  assert.deepEqual(method("/contacts/notes").meta.refs, { ref: null }, "the uuid field");
  assert.equal(method("/contacts/bulk-delete").meta.bulk, true);
  assert.equal(method("/contacts/bulk-delete").meta.self, "contacts", "a collection action acts on its parent collection's entities");
  assert.equal(model.references.contact, "contacts");
  assert.equal(model.references.owner, null, "an owners resource exists, but no create of the catalogue makes one");
  assert.ok(!Object.hasOwn(model.references, "name") && !Object.hasOwn(model.references, "status"), "never a generic word");
  assert.match(s.read("clients/contacts/sender.ts"), /const NAMED: Readonly<Record<string, string \| null>> = \{ [^}]*contact: 'contacts'/);
  const dir = mkdtempSync(path.join(tmpdir(), "atf-sender-"));
  writeFileSync(path.join(dir, "support.mts"), renderSupport(s.ctx()));
  writeFileSync(path.join(dir, "sender.mts"), renderSender(s.ctx(), model).replace("from './support';", "from './support.mts';"));
  const m = await import(pathToFileURL(path.join(dir, "sender.mts")).href);
  const sent = [];
  const api = { fetch: async (url, init) => (sent.push(`${init.method} ${url} ${JSON.stringify(init.data ?? {})}`), fakeRes(201, { id: url === "/contacts" ? 7 : 8 })) };
  const session = m.beginTest({ module: "contacts", label: "x", recordCreated: () => {}, recordDeleted: () => {}, owns: () => true });
  await m.sendRequest(api, "POST", "/contacts", { body: {} }, { creates: { type: "contacts", pointer: "/id" } });
  const notes = method("/contacts/notes").meta;
  const bulk = method("/contacts/bulk-delete").meta;
  const uuid = ["3f2a6c1e", "0000", "4000", "8000", "000000000000"].join("-");
  for (const [body, meta, re] of [
    [{ text: "x", contact: 42 }, notes, /contact=42/],
    [{ text: "x", contacts: [7, 42] }, notes, /contacts=42/],
    [{ text: "x", Contact_s: 42 }, notes, /Contact_s=42/],
    [{ text: "x", ref: uuid }, notes, /ref=3f2a6c1e/],
    [{ text: "x", owner: 5 }, notes, /owner=5/],
    [{ items: [99] }, bulk, /items=99/],
    [{ items: [7, uuid] }, bulk, /items=3f2a6c1e/],
    [[7, 99], bulk, /an item=99/],
    [{ nested: { list: ["99"] } }, bulk, /list=99/],
    [{ target: uuid }, bulk, /target=3f2a6c1e/],
  ]) await assert.rejects(m.sendRequest(api, "POST", "/x", { body }, meta), re, JSON.stringify(body));
  await m.sendRequest(api, "POST", "/contacts/notes", { body: { text: "contacts", contact: 7, contacts: [7], pinned: true, ref: null } }, notes);
  await m.sendRequest(api, "POST", "/contacts/bulk-delete", { body: { items: [7], note: "a reason", count: 1 } }, bulk);
  await m.sendRequest(api, "POST", "/contacts/notes", { body: m.planned({ text: "x", owner: 5 }, ["/owner"]) }, notes);
  await m.sendRequest(api, "GET", "/contacts", { query: { contact: 42 } }, {});
  assert.equal(sent.length, 5, "only the owned, planned or read requests were sent");
  await session.end({});
});

test("N3b: a change's entity references (body, query, GraphQL variables, any depth) name entities this test created, of the referenced type; the plan's own values are planned", async () => {
  const s = await setup();
  await s.ac("build");
  const { sender: m } = await runtime(s);
  const sent = [];
  const api = { fetch: async (url, init) => (sent.push(`${init.method} ${url} ${JSON.stringify(init.data ?? init.params ?? {})}`), init.method === "POST" && url === "/contacts" ? fakeRes(201, { id: 7 }) : fakeRes(200, {})) };
  const ledger = { module: "contacts", label: "API-contacts-1", recordCreated: () => {}, recordDeleted: () => {}, owns: () => true };
  const session = m.beginTest(ledger);
  await m.sendRequest(api, "POST", "/contacts", { body: {} }, { creates: { type: "contacts", pointer: "/id" } });
  const notes = { refs: { contactId: "contacts", ownerIds: "contacts" } };
  await assert.rejects(m.sendRequest(api, "POST", "/notes", { body: { contactId: 42, text: "x" } }, notes), /refused \(D-005\): POST \/notes sends the body contactId=42/);
  await m.sendRequest(api, "POST", "/notes", { body: { contactId: 7, text: "x" } }, notes);
  await assert.rejects(m.sendRequest(api, "POST", "/notes", { body: { contactId: 7 } }, { refs: { contactId: "notes" } }), /contactId=7/, "an owned id of another type");
  await assert.rejects(m.sendRequest(api, "POST", "/notes", { body: { input: { ownerIds: [7, 42] } } }, notes), /ownerIds=42/, "nested, in an array");
  await assert.rejects(m.sendRequest(api, "POST", "/notes", { body: { owner_id: 42 } }, {}), /owner_id=42/, "an id field of no known type: any owned entity, and 42 is none");
  await assert.rejects(m.sendRequest(api, "DELETE", "/contacts/{contactId}", { path: { contactId: 7 }, query: { ownerId: 42 } }, { path: { contactId: { type: "contacts", kind: "integer", format: null } }, refs: { ownerId: "contacts" } }), /sends the query ownerId=42/);
  await m.sendRequest(api, "POST", "/notes", { body: m.planned({ contactId: 42, text: "x" }, ["/contactId"]) }, notes);
  assert.ok(sent.some((x) => x.startsWith("POST /notes") && x.includes('"contactId":42')), "the plan's own value (a mutation, a cited value) is sent");
  await m.sendRequest(api, "GET", "/contacts", { query: { ownerId: 42 } }, {});
  await assert.rejects(m.sendGraphql(api, "/graphql", "mutation X { addNote }", { input: { contactId: "42" } }, "POST", undefined, { mutation: true, refs: { contactId: "contacts" } }), /mutation \/graphql sends the variables contactId=42/);
  await m.sendGraphql(api, "/graphql", "query X { contact }", { contactId: "42" }, "POST", undefined, {});
  await session.end({});
  // the generated client tells the sender which entity each id field names, and the generated spec marks planned values
  const model = s.model();
  assert.ok(model.clients.every((c) => c.methods.every((x) => typeof x.name === "string")));
  const spec = s.read(model.files.specs[0]);
  assert.match(spec, /planned\(/, "a body mutation or a cited value is planned");
  assert.match(spec, /import \{ [^}]*beginTest[^}]* \} from '\.\.\/\.\.\/\.\.\/clients\/contacts\/sender';/);
});

test("N4: the session, the ledger and the raw sender live only in the generated sender.ts, which no agent file reaches, directly or through imports", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const { support, sender } = await runtime(s);
  for (const n of ["beginTest", "createdBy", "sendRequest", "sendGraphql", "invalidPath", "planned"]) {
    assert.equal(n in support, false, `support.ts exports no ${n}`);
    assert.equal(typeof sender[n], "function", `sender.ts exports ${n}`);
  }
  assert.doesNotMatch(renderFacade(s.ctx(), s.model()), /^import (?!type )/m, "the facade imports types only");
  const rel = "helpers/api/contacts.payloads.ts";
  setSlot(s, rel, "imports", ["import { firstPage } from './pagination';"]);
  setSlot(s, rel, "helpers", ["export const startPage = firstPage;"]);
  s.write("helpers/api/pagination.ts", "import { deep } from './deep';\nexport const firstPage = deep;\n");
  s.write("helpers/api/deep.ts", "export const deep = 1;\n");
  assert.deepEqual(s.rules(), []);
  for (const [rule, text] of [
    ["session-reach", "import { beginTest } from '../../clients/contacts/sender';\nexport const deep = 1;\nexport const go = beginTest;\n"],
    ["session-reach", "import { ContactsClient } from '../../clients/contacts/contacts.client';\nexport const deep = 1;\nexport const k = ContactsClient;\n"],
    ["session-reach", "import { test as t } from '../../fixtures/api';\nexport const deep = 1;\nexport const k = t;\n"],
    ["re-export", "export { createdBy } from '../../clients/contacts/sender';\nexport const deep = 1;\n"],
    ["re-export", "export * from '../../clients/contacts/support';\nexport const deep = 1;\n"],
    ["raw-request", "import { readFileSync } from 'node:fs';\nexport const deep = 1;\nexport const r = readFileSync;\n"],
    ["raw-request", "import '../../clients/contacts/sender';\nexport const deep = 1;\n"],
    ["session-reach", "import { beginTest } from '../../clients/contacts/support';\nexport const deep = 1;\nexport const go = beginTest;\n"],
  ]) {
    s.write("helpers/api/deep.ts", text);
    const f = s.rules().filter((x) => x.file === "helpers/api/deep.ts");
    assert.ok(f.some((x) => x.rule === rule && /imported by helpers\/api\/pagination\.ts/.test(x.problem)), `${rule} (${text.split("\n")[0]}): ${JSON.stringify(f.map((x) => x.rule))}`);
  }
  s.write("helpers/api/deep.ts", "import type { Entity } from '../../clients/contacts/support';\nimport type { TestSession } from '../../clients/contacts/sender';\nexport type Pair = [Entity, TestSession];\nexport const deep = 1;\n");
  assert.deepEqual(s.rules(), [], "types from anywhere: erased at run time");
});

test("B3 allowlist: agent code uses only what it declares or imports and the pure globals as calls; a member is assigned only on an object it created", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const rel = "helpers/api/contacts.payloads.ts";
  const good = s.read(rel);
  assert.ok(Object.isFrozen(PURE_GLOBALS));
  for (const n of ["Reflect", "Function", "Proxy", "globalThis", "Symbol", "structuredClone", "console", "eval"]) assert.equal(Object.hasOwn(PURE_GLOBALS, n), false, n);
  const bad = [
    [["const O = Object;", "O.is = () => true;"], ["free-identifier", "builtin-patch"]],
    [["const { keys } = Object;"], ["free-identifier"]],
    [["export const k = [Object, JSON].length;"], ["free-identifier"]],
    [["const f = (x: unknown) => x;", "export const g = f(JSON);"], ["free-identifier"]],
    [["export const c = { ...Math };"], ["free-identifier"]],
    [["export const n = Number.prototype;"], ["free-identifier"]],
    [["export const w = `${String}`;"], ["free-identifier"]],
    [["export const w = `${[1].map((x) => x)}-${(() => { return Object; })()}`;"], ["free-identifier"]],
    [["export const s = structuredClone({});"], ["free-identifier"]],
    [["export const t = setTimeout;"], ["free-identifier"]],
    [["const Object = { keys: () => [] };"], ["free-identifier"]],
    [["function set(o: { x: number }) { o.x = 1; }", "export const s = set;"], ["builtin-patch"]],
    [["let base = { a: 1 };", "base = JSON.parse('{}');", "base.a = 2;"], ["builtin-patch"]],
    [["enum Kind { A }"], ["free-identifier"]],
  ];
  for (const [lines, rules] of bad) {
    setSlot(s, rel, "helpers", lines);
    const found = ruleNames(s.rules());
    for (const rule of rules) assert.ok(found.includes(rule), `${rule} (${lines.join(" ")}): ${found.join(", ")}`);
  }
  setSlot(s, rel, "helpers", [
    "const base = { at: new Date().toISOString(), max: Number.MAX_SAFE_INTEGER, keys: Object.keys({ a: 1 }), s: String(1), ok: Number.isInteger(1) && Array.isArray([]) };",
    "base.s = encodeURIComponent('x y');",
    "const items = new Map<string, number>([['a', 1]]);",
    "items.set('b', Math.max(1, 2));",
    "export function pick<T>({ a, b = 2 }: { a: T; b?: number }, ...rest: number[]): [T, number, number] { return [a, b, rest.length]; }",
    "export const json = `${JSON.stringify(base)}:${pick({ a: 1 })[1]}`;",
  ]);
  assert.deepEqual(s.rules(), []);
  s.write(rel, good);
  // the glue and its builders: the same allowlist inside a slot, with the generated bindings in scope
  const f = (code, declared) => freeIdentifierFindings("x.ts", code, { declared, wrap: true }).map((x) => x.problem);
  assert.deepEqual(f("  const r = await c.clients.contactsClient.create({ body: payloads.contactsCreateBody() });\n  return { path: { contactId: c.track(r).ref } };", ["c", "payloads"]), []);
  assert.match(f("  const keys = Object.keys;\n  return {};", ["c"])[0], /Object\.keys is not an allowed use/);
  assert.match(f("  return { a: process.env.X };", [])[0], /process is not declared/);
});

test("N5: the composite seed passes the composite rules, and so does a helper written the way it says (facade types, facade calls)", async () => {
  const s = await setup();
  await scaffoldApiCode(s.root);
  const rel = "helpers/api/contacts.composite.ts";
  assert.equal(s.read(rel), renderCompositeSeed(s.ctx()));
  assert.deepEqual(s.rules("clients"), []);
  assert.match(renderCompositeSeed(s.ctx()), /ContactsClientFacade/);
  assert.match(s.read("clients/contacts/facade.ts"), /export type ContactsClientFacade = /);
  s.write(rel, [
    "import type { ContactsClientFacade } from '../../clients/contacts/facade';",
    "import type { ContactsCreateRequest } from '../../clients/contacts/types';",
    "import { contactsCreateBody } from './contacts.payloads';",
    "",
    "export async function createTwo(contacts: ContactsClientFacade, body: ContactsCreateRequest = contactsCreateBody()) {",
    "  const first = await contacts.create({ body });",
    "  const second = await contacts.create({ body: { ...body } });",
    "  return [first, second];",
    "}",
    "",
  ].join("\n"));
  assert.deepEqual(s.rules("clients"), []);
});

test("older modules: a plain build keeps a hand-written file with a generated name in api-code/legacy/ before replacing it; --adopt also moves the module's other helpers", async () => {
  const s = await setup();
  const { model } = await scaffoldApiCode(s.root);
  const legacy = (rel) => path.join(s.ctx().ap.dir, "legacy", rel);
  const spec = model.files.specs[0];
  s.write(spec, "// written by hand before D-056\nexport {};\n");
  s.write(model.files.payloads, "// hand-written payloads\nexport const contact = { name: 'x' };\n");
  const b = await s.ac("build");
  assert.equal(b.code, 0, JSON.stringify(b.out.problems));
  assert.ok(b.out.warnings.some((w) => w.startsWith(`${spec} was hand-written`)), JSON.stringify(b.out.warnings));
  assert.ok(b.out.warnings.some((w) => w.startsWith(`${model.files.payloads} was hand-written`)));
  assert.equal(readFileSync(legacy(spec), "utf8"), "// written by hand before D-056\nexport {};\n");
  assert.equal(readFileSync(legacy(model.files.payloads), "utf8"), "// hand-written payloads\nexport const contact = { name: 'x' };\n");
  assert.match(s.read(spec), /Generated by scripts\/api-code\.mjs/);
  assert.match(s.read(model.files.payloads), /^\/\/ Generated by scripts\/api-code\.mjs around/);
  s.write("helpers/api/contacts.util.ts", "export const x = 1;\n");
  assert.ok(s.rules().some((f) => f.rule === "extra-file" && f.file === "helpers/api/contacts.util.ts"));
  const a = await s.ac("build", "--adopt");
  assert.ok(a.out.adopted.some((x) => x.from === "helpers/api/contacts.util.ts"));
  assert.ok(existsSync(legacy("helpers/api/contacts.util.ts")) && !existsSync(s.file("helpers/api/contacts.util.ts")));
});
