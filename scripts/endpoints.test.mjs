import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { main } from "./endpoints.mjs";
import { specLinksInHtml } from "./lib/api-discovery.mjs";
import { paths } from "./lib/contract.mjs";
import { FLOWS } from "./lib/domain-flows.mjs";
import { apiPaths, build, crudOf, isIdSegment, nameKey, noiseReason, normalizePath, restKey, saveSource, writeJson } from "./lib/endpoints.mjs";
import { INTROSPECTION_QUERY, operationsFromIntrospection } from "./lib/graphql.mjs";
import { parseSpec } from "./lib/openapi.mjs";
import { createClient, denyReason, firstItemId, loadAuth, probeEndpoints, shapeOf } from "./lib/probe.mjs";
import { put, startRun } from "./test-helpers.mjs";

const CFG = {
  target: { url: "https://app.acme.test", api_urls: ["https://api.acme.test/v2"] },
  modules: [{ slug: "contacts", name: "Contacts" }, { slug: "deals", name: "Deals" }],
  api: {},
  authorizations: {},
};

const OAS3 = {
  openapi: "3.0.3",
  info: { title: "Acme" },
  servers: [{ url: "https://app.acme.test/api/{version}", variables: { version: { default: "v1" } } }],
  security: [{ session: [] }],
  components: {
    securitySchemes: { session: { type: "apiKey", in: "cookie", name: "sid" }, token: { type: "http", scheme: "bearer" } },
    schemas: {
      Contact: { type: "object", required: ["id", "name"], properties: { id: { type: "integer" }, name: { type: "string" }, owner: { $ref: "#/components/schemas/User" } } },
      User: { type: "object", properties: { id: { type: "integer" }, manager: { $ref: "#/components/schemas/User" } } },
      Error: { type: "object", properties: { message: { type: "string" } } },
    },
  },
  paths: {
    "/contacts": {
      get: {
        tags: ["Contacts"],
        operationId: "listContacts",
        parameters: [{ in: "query", name: "page", schema: { type: "integer" } }, { in: "query", name: "per_page", schema: { type: "integer" } }, { in: "header", name: "Accept", schema: { type: "string" } }],
        responses: { 200: { description: "ok", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Contact" } } } } } },
      },
      post: {
        tags: ["Contacts"],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } },
        responses: { 201: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, 422: { content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
      },
    },
    "/contacts/{contactId}": {
      parameters: [{ in: "path", name: "contactId", required: true, schema: { type: "integer" } }],
      get: { tags: ["Contacts"], responses: { 200: { content: { "application/json": { schema: { $ref: "#/components/schemas/Contact" } } } }, 404: { description: "x" } } },
      delete: { tags: ["Contacts"], security: [{ token: [] }], responses: { 204: { description: "gone" } } },
    },
    "/contacts/search": { post: { tags: ["Contacts"], responses: { 200: { description: "ok" } } } },
    "/deals": { get: { tags: ["Deals"], responses: { 200: { description: "ok" } } } },
    "/owners": { get: { tags: ["Users"], security: [], responses: { 200: { content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/User" } } } } } } } },
  },
};

const SWAGGER2 = {
  swagger: "2.0",
  info: { title: "Legacy" },
  host: "api.acme.test",
  basePath: "/v2",
  schemes: ["https"],
  securityDefinitions: { basicAuth: { type: "basic" }, key: { type: "apiKey", in: "header", name: "X-Api-Key" } },
  security: [{ key: [] }],
  paths: {
    "/contacts/{id}/notes": {
      post: {
        consumes: ["application/json"],
        parameters: [{ in: "path", name: "id", required: true, type: "string" }, { in: "body", name: "body", required: true, schema: { type: "object", properties: { text: { type: "string" } } } }],
        responses: { 201: { schema: { type: "object", properties: { id: { type: "string" } } } } },
      },
    },
    "/contacts/{id}/avatar": { post: { parameters: [{ in: "path", name: "id", required: true, type: "string" }, { in: "formData", name: "file", type: "file", required: true }], security: [{ basicAuth: [] }], responses: { 200: {} } } },
  },
};

// ---------- spec parsing ----------

test("OpenAPI 3: servers with variables, merged params, standard headers dropped, refs resolved, cycles cut", () => {
  const { version, operations } = parseSpec(OAS3, { location: "https://app.acme.test/openapi.json" });
  assert.equal(version, "3.0.3");
  const list = operations.find((o) => o.method === "GET" && o.path === "/contacts");
  assert.deepEqual(list.server, { origin: "https://app.acme.test", basePath: "/api/v1" });
  assert.deepEqual(list.params.map((p) => p.name), ["page", "per_page"], "Accept is a standard header");
  assert.equal(list.responses[200].schema.items.properties.owner.properties.manager.properties.manager["x-circular"], true);
  const item = operations.find((o) => o.method === "GET" && o.path === "/contacts/{contactId}");
  assert.deepEqual(item.params, [{ in: "path", name: "contactId", required: true, type: "integer" }], "path-level params are inherited");
  assert.deepEqual(item.security, [[{ scheme: "session", type: "apiKey", in: "cookie", name: "sid", scopes: [] }]]);
  const del = operations.find((o) => o.method === "DELETE");
  assert.equal(del.security[0][0].scheme, "bearer");
  assert.deepEqual(operations.find((o) => o.path === "/owners").security, [], "security: [] means no auth");
  assert.equal(operations.find((o) => o.method === "POST" && o.path === "/contacts").requestBody.schema.required[1], "name");
  assert.equal(item.ref, "#/paths/~1contacts~1{contactId}/get");
});

test("Swagger 2.0: host/basePath, body and formData parameters, basic and apiKey schemes", () => {
  const { operations } = parseSpec(SWAGGER2, { location: "spec.json" });
  const notes = operations.find((o) => o.path.endsWith("/notes"));
  assert.deepEqual(notes.server, { origin: "https://api.acme.test", basePath: "/v2" });
  assert.deepEqual(notes.requestBody.contentTypes, ["application/json"]);
  assert.equal(notes.params.length, 1, "the body is not a parameter");
  assert.deepEqual(notes.security, [[{ scheme: "key", type: "apiKey", in: "header", name: "X-Api-Key", scopes: [] }]]);
  const avatar = operations.find((o) => o.path.endsWith("/avatar"));
  assert.deepEqual(avatar.requestBody.contentTypes, ["multipart/form-data"]);
  assert.equal(avatar.security[0][0].scheme, "basic");
  assert.throws(() => parseSpec({ info: {} }), /not an OpenAPI/);
});

// ---------- paths, keys, names, noise ----------

test("paths: ids become {id}, versions and configured literals stay, keys erase names and prefix foreign hosts", () => {
  assert.equal(normalizePath("/api/v2/contacts/123/").path, "/api/v2/contacts/{id}");
  assert.equal(normalizePath("https://App.acme.test//contacts/3f2b8c1e-1d2a-4b3c-9d8e-0a1b2c3d4e5f?x=1").path, "/contacts/{id}");
  assert.equal(normalizePath("/reports/2024", { literals: ["2024"] }).path, "/reports/2024");
  assert.equal(isIdSegment("v1"), false);
  assert.equal(isIdSegment("5f2b8c1e9d8e0a1b"), true);
  assert.equal(restKey("get", "https://app.acme.test", "/contacts/{contactId}", "https://app.acme.test"), "GET /contacts/{}");
  assert.equal(restKey("get", "https://api.acme.test", "/v2/contacts", "https://app.acme.test"), "GET //api.acme.test/v2/contacts");
  assert.equal(nameKey("Sales Accounts"), nameKey("sales_account"));
  assert.equal(nameKey("Companies"), "company");
  assert.equal(crudOf("POST", "/contacts"), "create");
  assert.equal(crudOf("GET", "/contacts/{id}"), "read");
  assert.equal(crudOf("POST", "/contacts/search"), "action");
  assert.equal(crudOf("POST", "/contacts/{id}/merge"), "action");
});

test("noise in the network inventory is excluded with a reason, never silently", () => {
  const ctx = { firstParty: ["app.acme.test", "api.acme.test"], names: new Set(["contact"]), others: new Map([["deal", "deals"]]), pagePaths: new Set(["/contacts"]) };
  const r = (e, origin = null) => noiseReason(e, { origin, p: normalizePath(e.pathTemplate).path }, ctx)?.reason ?? null;
  assert.equal(r({ method: "OPTIONS", pathTemplate: "/api/contacts" }), "preflight");
  assert.equal(r({ method: "GET", pathTemplate: "/collect" }, "https://www.google-analytics.com"), "third_party");
  assert.equal(r({ method: "GET", pathTemplate: "/static/app.js" }), "static_asset");
  assert.equal(r({ method: "POST", pathTemplate: "/api/telemetry/events" }), "telemetry");
  assert.equal(r({ method: "GET", pathTemplate: "/healthz" }), "health");
  assert.equal(r({ method: "POST", pathTemplate: "/api/session/refresh" }), "auth_plumbing");
  assert.equal(r({ method: "GET", pathTemplate: "/contacts", responseKeys: [] }), "page_navigation");
  assert.equal(r({ method: "GET", pathTemplate: "/api/deals/{id}" }), "out_of_module");
  assert.equal(r({ method: "GET", pathTemplate: "/api/contacts/{id}" }), null);
  assert.equal(r({ method: "GET", pathTemplate: "/api/owners" }), null, "support calls of the module stay");
});

// ---------- build ----------

function fixture(root, { spec = OAS3, inventory, overlay, probes } = {}) {
  const ap = apiPaths(paths("acme", root).productDir, "contacts");
  if (spec) saveSource(ap, { kind: "openapi", location: "https://app.acme.test/openapi.json", content: spec, version: spec.openapi ?? spec.swagger, status: "ok" });
  if (inventory) writeJson(ap.inventory, inventory);
  if (overlay) writeJson(ap.overlay, overlay);
  if (probes) writeJson(ap.probes, { meta: {}, results: probes });
  writeJson(ap.sitemap, [{ url: "https://app.acme.test/contacts", slug: "list", title: "Contacts", links: [] }]);
  return ap;
}
const INVENTORY = [
  { method: "GET", pathTemplate: "/api/v1/contacts", statusCodes: [200], requestKeys: [], responseKeys: ["id", "name", "owner", "avatar_url"], pages: ["list"] },
  { method: "GET", pathTemplate: "/api/v1/contacts/{id}", statusCodes: [200, 403], requestKeys: [], responseKeys: ["id", "name", "owner"], pages: ["detail"] },
  { method: "GET", pathTemplate: "/api/v1/owners", statusCodes: [200], requestKeys: [], responseKeys: ["id"], pages: ["list"] },
  { method: "PATCH", pathTemplate: "/api/v1/contacts/{id}/tags", statusCodes: [200], requestKeys: ["tags"], responseKeys: ["tags"], pages: ["detail"] },
  { method: "GET", pathTemplate: "/api/v1/deals", statusCodes: [200], requestKeys: [], responseKeys: [], pages: ["list"] },
  { method: "GET", host: "cdn.vendor.test", pathTemplate: "/sdk.js", statusCodes: [200], requestKeys: [], responseKeys: [], pages: ["list"] },
  { method: "GET", pathTemplate: "/contacts", statusCodes: [200], requestKeys: [], responseKeys: [], pages: ["list"] },
];
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const ctxOf = (runId = "acme-run-1") => ({ module: "contacts", cfg: { ...CFG, target: { url: "https://app.acme.test" } }, runId });

test("build: resource-scoped spec + observed endpoints, every input accounted for, nothing out of scope pulled in", () => {
  const { root } = startRun();
  const ap = fixture(root, { inventory: INVENTORY });
  const r = build(ap, ctxOf());
  assert.deepEqual(r.problems, []);
  const cat = read(ap.catalogue);
  const keys = cat.map((e) => e.key);
  for (const k of ["GET /api/v1/contacts", "POST /api/v1/contacts", "GET /api/v1/contacts/{}", "DELETE /api/v1/contacts/{}", "POST /api/v1/contacts/search", "GET /api/v1/owners", "PATCH /api/v1/contacts/{}/tags"]) assert.ok(keys.includes(k), k);
  assert.ok(!keys.includes("GET /api/v1/deals"), "another module's endpoint is not catalogued");
  const cov = read(ap.coverage);
  assert.equal(cov.status, "complete");
  assert.equal(cov.mapped.length + cov.excluded.length, cov.inputs.spec + cov.inputs.inventory + cov.inputs.docs + cov.inputs.graphql);
  const reasons = Object.fromEntries(cov.excluded.map((x) => [x.input, x.reason]));
  assert.equal(reasons["spec:spec-1:GET /deals"], "out_of_module");
  assert.equal(reasons["inventory:4:GET /api/v1/deals"], "out_of_module");
  assert.equal(reasons["inventory:5:GET /sdk.js"], "third_party");
  assert.equal(reasons["inventory:6:GET /contacts"], "page_navigation");
  assert.deepEqual(cov.candidateResources, [{ resource: "owners", observedEndpoints: 1 }]);

  const byKey = Object.fromEntries(cat.map((e) => [e.key, e]));
  const owners = byKey["GET /api/v1/owners"];
  assert.equal(owners.source, "openapi", "an observed support call pulls in its documented operation");
  assert.equal(owners.auth, "none");
  const list = byKey["GET /api/v1/contacts"];
  assert.deepEqual(list.observed, { ui: true, probe: false });
  assert.deepEqual(list.pagination, { style: "page", params: ["page", "per_page"] });
  assert.equal(list.auth, "session");
  assert.equal(list.path, "/api/v1/contacts");
  assert.equal(list.basePath, "/api/v1");
  const del = byKey["DELETE /api/v1/contacts/{}"];
  assert.equal(del.auth, "bearer");
  assert.equal(del.mutates, true);
  assert.equal(del.observed.ui, false);
  assert.equal(byKey["POST /api/v1/contacts/search"].mutates, true, "POST stays mutating");
  assert.equal(byKey["POST /api/v1/contacts/search"].queryLike.source, "name");
  const item = byKey["GET /api/v1/contacts/{}"];
  assert.equal(item.path, "/api/v1/contacts/{contactId}", "spec parameter names win");
  assert.deepEqual(new Set(item.links.map((l) => `${l.from}${l.pointer}`)), new Set([`${byKey["POST /api/v1/contacts"].id}/id`, `${list.id}/0/id`]));
  assert.ok(item.links.every((l) => l.param === "contactId" && l.source === "inferred"));
  assert.deepEqual(byKey["POST /api/v1/contacts"].errorSchemas["422"].properties.message, { type: "string" });
  const tags = byKey["PATCH /api/v1/contacts/{}/tags"];
  assert.equal(tags.source, "network");
  assert.deepEqual(tags.params, [{ in: "path", name: "id", required: true, source: "network" }]);

  const drift = read(ap.drift).map((d) => `${d.type}:${d.endpoint === list.id ? "list" : d.endpoint === item.id ? "item" : d.endpoint}${d.detail ? ":" + d.detail : ""}`);
  assert.ok(drift.includes("undocumented_response_key:list:avatar_url"));
  assert.ok(drift.includes("undocumented_status:item:403"));
  assert.ok(drift.includes(`undocumented_endpoint:${tags.id}`));
  assert.ok(drift.includes(`unobserved_documented_endpoint:${del.id}`));
});

test("ids are stable across rebuilds and runs; gone endpoints keep their id and it is never reused", () => {
  const { root } = startRun();
  const ap = fixture(root, { inventory: INVENTORY });
  build(ap, ctxOf());
  const first = Object.fromEntries(read(ap.catalogue).map((e) => [e.key, e.id]));
  writeJson(ap.inventory, INVENTORY.slice(0, 3)); // PATCH .../tags disappears
  build(ap, ctxOf("acme-run-2"));
  const second = Object.fromEntries(read(ap.catalogue).map((e) => [e.key, e.id]));
  for (const [k, id] of Object.entries(second)) assert.equal(id, first[k], k);
  const gone = first["PATCH /api/v1/contacts/{}/tags"];
  assert.equal(second["PATCH /api/v1/contacts/{}/tags"], undefined);
  assert.deepEqual(read(ap.coverage).retired, [gone]);
  writeJson(ap.inventory, [...INVENTORY.slice(0, 3), { method: "GET", pathTemplate: "/api/v1/contacts/{id}/notes", statusCodes: [200], requestKeys: [], responseKeys: [], pages: [] }]);
  build(ap, ctxOf("acme-run-3"));
  const notes = read(ap.catalogue).find((e) => e.key === "GET /api/v1/contacts/{}/notes");
  assert.notEqual(notes.id, gone);
  assert.equal(Number(notes.id.split("-").at(-1)), Object.keys(first).length + 1);
});

test("overlay: scope, exclusions, docs endpoints and annotations are applied; mutates is never lowered; unknown targets fail", () => {
  const { root } = startRun();
  const overlay = {
    scope: { exclude: [{ match: "POST /api/v1/contacts/search", reason: "deprecated", detail: "replaced by /filters per docs" }] },
    endpoints: [{ method: "POST", path: "/api/v1/contacts/{id}/merge", citation: "https://developers.acme.test/contacts#merge", summary: "Merge two contacts" }],
    annotations: {
      "GET /api/v1/contacts": { citation: "https://developers.acme.test/limits", rateLimit: { limit: 100, window: "1m" } },
      "DELETE /api/v1/contacts/{}": { citation: "https://developers.acme.test/x", notes: "soft delete", mutates: true },
    },
    defaults: { auth: "session" },
  };
  const ap = fixture(root, { inventory: INVENTORY, overlay });
  const r = build(ap, ctxOf());
  assert.deepEqual(r.problems, []);
  const cat = Object.fromEntries(read(ap.catalogue).map((e) => [e.key, e]));
  assert.equal(cat["POST /api/v1/contacts/search"], undefined);
  assert.equal(read(ap.coverage).excluded.find((x) => x.input === "spec:spec-1:POST /contacts/search").reason, "deprecated");
  const merge = cat["POST /api/v1/contacts/{}/merge"];
  assert.equal(merge.source, "docs");
  assert.deepEqual(merge.sources, [{ source: "docs", ref: "https://developers.acme.test/contacts#merge" }]);
  assert.equal(merge.crud, "action");
  assert.equal(cat["GET /api/v1/contacts"].rateLimit.source, "docs");
  assert.equal(cat["PATCH /api/v1/contacts/{}/tags"].auth, "session", "defaults fill unknown auth");
  writeJson(ap.overlay, { annotations: { "EP-contacts-999": { citation: "x", notes: "y" } } });
  assert.match(build(ap, ctxOf()).problems.join("\n"), /EP-contacts-999/);
});

test("blocked vs empty: no inventory and no spec is blocked, and the API flow says so instead of 'no API surface'", () => {
  const { root } = startRun();
  const ap = fixture(root, { spec: null });
  assert.equal(build(ap, ctxOf()).summary.status, "blocked");
  const skip = FLOWS["playwright-api"].build.find((b) => b.step === "plan").skipRest;
  assert.match(skip({ productDir: paths("acme", root).productDir, module: "contacts" }), /^API discovery blocked: no network inventory/);
  writeJson(ap.inventory, [{ method: "GET", pathTemplate: "/static/a.css", statusCodes: [200], requestKeys: [], responseKeys: [], pages: [] }]);
  assert.equal(build(ap, ctxOf()).summary.status, "empty");
  assert.equal(skip({ productDir: paths("acme", root).productDir, module: "contacts" }), "no API surface found");
  writeJson(ap.overlay, { blocked: "the API needs a token; no api.auth_header configured" });
  build(ap, ctxOf());
  assert.equal(skip({ productDir: paths("acme", root).productDir, module: "contacts" }), "API discovery blocked: the API needs a token; no api.auth_header configured");
});

// ---------- GraphQL ----------

const INTROSPECTION = {
  data: {
    __schema: {
      queryType: { name: "Query" },
      mutationType: { name: "Mutation" },
      subscriptionType: { name: "Subscription" },
      types: [
        { kind: "OBJECT", name: "Query", fields: [{ name: "contacts", args: [{ name: "first", type: { kind: "SCALAR", name: "Int" } }], type: { kind: "LIST", ofType: { kind: "OBJECT", name: "Contact" } } }, { name: "deals", args: [], type: { kind: "LIST", ofType: { kind: "OBJECT", name: "Deal" } } }] },
        { kind: "OBJECT", name: "Mutation", fields: [{ name: "createContact", args: [{ name: "input", type: { kind: "NON_NULL", ofType: { kind: "INPUT_OBJECT", name: "ContactInput" } } }], type: { kind: "OBJECT", name: "Contact" } }] },
        { kind: "OBJECT", name: "Subscription", fields: [{ name: "contactChanged", args: [], type: { kind: "OBJECT", name: "Contact" } }] },
      ],
    },
  },
};

test("GraphQL: root fields become operations; queries are read-only, mutations mutate, subscriptions are excluded", () => {
  const ops = operationsFromIntrospection(INTROSPECTION);
  assert.deepEqual(ops.find((o) => o.field === "createContact").args, [{ name: "input", type: "ContactInput!", required: true }]);
  const { root } = startRun();
  const ap = fixture(root, { spec: null, inventory: [{ method: "POST", pathTemplate: "/graphql", statusCodes: [200], requestKeys: ["query", "variables"], responseKeys: ["data"], pages: ["list"], graphql: [{ operationType: "query", operationName: "ContactList", fields: ["contacts"] }] }] });
  saveSource(ap, { kind: "graphql", location: "https://app.acme.test/graphql", content: INTROSPECTION, getSupported: true, status: "ok" });
  assert.deepEqual(build(ap, ctxOf()).problems, []);
  const cat = Object.fromEntries(read(ap.catalogue).map((e) => [e.key, e]));
  assert.deepEqual(Object.keys(cat).sort(), ["GQL mutation createContact", "GQL query contacts"]);
  assert.equal(cat["GQL query contacts"].observed.ui, true);
  assert.equal(cat["GQL query contacts"].mutates, false);
  assert.equal(cat["GQL query contacts"].safeMethod, true, "introspection over GET worked");
  assert.equal(cat["GQL mutation createContact"].mutates, true);
  const reasons = Object.fromEntries(read(ap.coverage).excluded.map((x) => [x.input, x.reason]));
  assert.equal(reasons["graphql:graphql-1:query.deals"], "out_of_module");
  assert.equal(reasons["graphql:graphql-1:subscription.contactChanged"], "not_api");
});

// ---------- probe safety ----------

test("probe gate: GET to first-party hosts only, no side-effect tokens, no action parameters, no credentials in URLs", () => {
  const allowHosts = ["app.acme.test", "api.acme.test"];
  const deny = (u, o = {}) => denyReason(u, { allowHosts, ...o });
  assert.equal(deny("https://api.acme.test/v2/contacts"), null);
  assert.match(deny("https://evil.test/contacts"), /not a first-party host/);
  assert.equal(deny("https://docs.vendor.test/openapi.json", { anyHost: true }), null, "a configured spec on another host, fetched anonymously");
  assert.match(deny("https://app.acme.test/api/logout"), /logout/);
  assert.match(deny("https://app.acme.test/api/contacts/export"), /export/);
  assert.match(deny("https://app.acme.test/api/sendInvite"), /send/);
  assert.match(deny("https://app.acme.test/api/contacts?action=purge"), /action/);
  assert.match(deny("https://app.acme.test/api/contacts?_method=DELETE"), /_method/);
  assert.match(deny("https://u:p@app.acme.test/api"), /credentials/);
  assert.equal(deny(`https://app.acme.test/graphql?query=${encodeURIComponent(INTROSPECTION_QUERY)}`), null);
});

const SECRET = "s3cr3t-cookie-value";
const fakeFetch = (routes, log = []) => async (url, init) => {
  log.push({ url, method: init.method, headers: init.headers });
  const r = routes[new URL(url).pathname] ?? { status: 404, body: "" };
  return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status, headers: { "content-type": r.type ?? "application/json", ...(r.headers ?? {}) } });
};

test("probe client: budget, Retry-After, credentials only to first-party hosts, three 5xx stop", async () => {
  const { root } = startRun();
  put(root, "state.json", JSON.stringify({ cookies: [{ name: "sid", value: SECRET, domain: ".acme.test", path: "/" }] }));
  const cfg = { ...CFG, authorizations: { session_state_file: "state.json" } };
  const log = [];
  let calls = 0;
  const fetchImpl = async (url, init) => {
    log.push({ url, headers: init.headers });
    calls += 1;
    if (url.endsWith("/limited") && calls === 1) return new Response("", { status: 429, headers: { "retry-after": "2" } });
    if (url.includes("/boom/")) return new Response("", { status: 500 });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const slept = [];
  const c = createClient({ cfg, auth: loadAuth(cfg, root), fetchImpl, sleep: async (ms) => void slept.push(ms), budget: 10, delayMs: 100 });
  assert.equal((await c.get("https://app.acme.test/limited")).status, 200);
  assert.ok(slept.includes(2000), "waited Retry-After");
  assert.equal(log[0].headers.cookie, `sid=${SECRET}`);
  await c.get("https://docs.vendor.test/spec.json", { anyHost: true });
  assert.equal(log.at(-1).headers.cookie, undefined, "never sends the session to another host");
  for (let i = 0; i < 3; i++) await c.get(`https://app.acme.test/boom/${i}`);
  assert.match((await c.get("https://app.acme.test/ok")).skipped, /three server errors/);
  const small = createClient({ cfg, auth: loadAuth(cfg, root), fetchImpl, sleep: async () => {}, budget: 1, delayMs: 0 });
  await small.get("https://app.acme.test/a");
  assert.match((await small.get("https://app.acme.test/b")).skipped, /budget/);
  assert.match(loadAuth(cfg, root).describe.session, /1 cookie/);
  assert.doesNotMatch(JSON.stringify(loadAuth(cfg, root).describe), new RegExp(SECRET));
});

test("probeEndpoints: ids only from list responses already received, never guessed; only shapes are recorded", async () => {
  const id = "contact-42-private-id";
  const routes = {
    "/api/v1/contacts": { status: 200, body: { contacts: [{ id, name: "Jane Private", email: "jane@private.test" }], meta: { total: 1 } } },
    [`/api/v1/contacts/${id}`]: { status: 200, body: { contact: { id, name: "Jane Private" } } },
  };
  const log = [];
  const client = createClient({ cfg: CFG, auth: { headersFor: () => ({}) }, fetchImpl: fakeFetch(routes, log), sleep: async () => {}, budget: 10, delayMs: 0 });
  const ep = (key, p, extra = {}) => ({ id: `EP-contacts-${key.length}`, key, kind: "rest", method: "GET", path: p, server: "https://app.acme.test", params: [], ...extra });
  const { results } = await probeEndpoints(
    [
      ep("GET /api/v1/contacts/{}", "/api/v1/contacts/{contactId}"),
      ep("GET /api/v1/contacts", "/api/v1/contacts"),
      ep("GET /api/v1/deals/{}", "/api/v1/deals/{dealId}"),
      ep("GET /api/v1/contacts/{}/notes/{}", "/api/v1/contacts/{a}/notes/{b}"),
      ep("GET /api/v1/reports", "/api/v1/reports", { params: [{ in: "query", name: "from", required: true }] }),
      ep("POST /api/v1/contacts", "/api/v1/contacts", { method: "POST" }),
    ],
    client
  );
  assert.deepEqual(results["GET /api/v1/contacts"], { status: 200, contentType: "application/json", isArray: false, keys: ["contacts", "meta"], arrayKey: "contacts", itemKeys: ["email", "id", "name"] });
  assert.equal(results["GET /api/v1/contacts/{}"].status, 200, "the item was probed with the listed id");
  assert.match(results["GET /api/v1/deals/{}"].skipped, /never guessed/);
  assert.match(results["GET /api/v1/contacts/{}/notes/{}"].skipped, /more than one/);
  assert.match(results["GET /api/v1/reports"].skipped, /required query/);
  assert.equal(results["POST /api/v1/contacts"], undefined, "only GETs are probed");
  assert.ok(log.every((l) => l.method === "GET"));
  const recorded = JSON.stringify(results);
  for (const v of [id, "Jane Private", "jane@private.test"]) assert.doesNotMatch(recorded, new RegExp(v), "values are never recorded");
  assert.deepEqual(shapeOf([{ a: 1 }, { b: 2 }]), { isArray: true, keys: [], itemKeys: ["a", "b"] });
  assert.equal(firstItemId([{ name: "x" }]), null);
});

// ---------- the CLI, end to end with a fake network ----------

test("CLI: find-spec follows a Swagger UI page, build + probe + build pass the schemas, check is clean", async () => {
  const { root } = startRun({ extra: ["api: {probe_delay_ms: 0}"] });
  const ap = apiPaths(paths("acme", root).productDir, "contacts");
  writeJson(ap.inventory, INVENTORY);
  writeJson(ap.sitemap, [{ url: "https://app.acme.test/contacts", slug: "list", title: "Contacts", links: [] }]);
  const routes = {
    "/docs": { status: 200, type: "text/html", body: `<html><script>SwaggerUIBundle({ url: "/internal/spec.json", dom_id: "#swagger-ui" })</script></html>` },
    "/internal/spec.json": { status: 200, body: OAS3 },
    "/api/v1/contacts": { status: 200, body: [{ id: 7, name: "n" }], headers: { "x-ratelimit-limit": "100", link: '<https://app.acme.test/api/v1/contacts?page=2>; rel="next"' } },
    "/api/v1/contacts/7": { status: 200, body: { id: 7, name: "n", owner: {} } },
    "/api/v1/owners": { status: 401, body: { error: "auth" } },
  };
  const log = [];
  const run = (...args) => main(args, { root, fetchImpl: fakeFetch(routes, log), sleep: async () => {} });
  const found = await run("find-spec", "acme", "contacts");
  assert.equal(found.code, 0);
  assert.deepEqual(found.out.found.map((f) => f.location), ["https://app.acme.test/internal/spec.json"]);
  const b1 = await run("build", "acme", "contacts");
  assert.deepEqual(b1.out.problems, []);
  assert.equal(b1.code, 0);
  const p = await run("probe", "acme", "contacts");
  assert.equal(p.out.probed, 3, JSON.stringify(read(ap.probes).results));
  assert.ok(log.every((l) => l.method === "GET"));
  const b2 = await run("build", "acme", "contacts");
  assert.equal(b2.code, 0, JSON.stringify(b2.out.problems));
  const cat = Object.fromEntries(read(ap.catalogue).map((e) => [e.key, e]));
  assert.deepEqual(cat["GET /api/v1/contacts"].observed, { ui: true, probe: true });
  assert.equal(cat["GET /api/v1/contacts"].rateLimit.source, "probe");
  assert.ok(read(ap.drift).some((d) => d.type === "auth_mismatch" && d.endpoint === cat["GET /api/v1/owners"].id), "documented as public, answered 401");
  assert.deepEqual((await run("check", "acme", "contacts")).out, { valid: true, problems: [] });
  writeJson(ap.overlay, { scope: { exclude: [{ match: "x", reason: "because" }] } });
  const bad = await run("build", "acme", "contacts");
  assert.equal(bad.code, 1);
  assert.match(bad.out.problems.join("\n"), /overlay\.json/);
  assert.deepEqual(specLinksInHtml(`<redoc spec-url="openapi.yaml"></redoc>`, "https://app.acme.test/docs/"), ["https://app.acme.test/docs/openapi.yaml"]);
});
