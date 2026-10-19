// k6-code.mjs (G7, criterion 4 and the script half of 5): generated k6 scripts per workload scenario, the slot file,
// parking, drift and every check rule. Never runs k6: inspect is injected (or skipped under node --test).
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { main } from "./k6-code.mjs";
import { main as workload } from "./workload.mjs";
import { planPaths } from "./lib/api-plan.mjs";
import { writeJson } from "./lib/endpoints.mjs";
import { computeModel, k6CodeContext, k6CodeUnverified, parseOptions, scriptRules, slotFindings, urlPathOf } from "./lib/k6-code.mjs";
import { stampVerified } from "./lib/verified.mjs";
import { put, startRun } from "./test-helpers.mjs";

const MOD = "artifacts/acme/modules/contacts";
const CITE = "knowledge:modules/contacts/notes.md";
const ep = (n, method, p, extra = {}) => ({
  id: `EP-contacts-${n}`, key: `${method} ${p}`, kind: "rest", method, path: p, resource: "contacts",
  crud: { GET: p.includes("{") ? "read" : "list", POST: "create", PUT: "update", DELETE: "delete" }[method],
  observed: { ui: true, probe: false }, params: p.includes("{") ? [{ name: "id", in: "path", required: true }] : [],
  rateLimit: null, links: [], mutates: method !== "GET", safeMethod: method === "GET", ...extra,
});
const CATALOGUE = () => [
  ep(1, "GET", "/api/v1/contacts", { params: [{ name: "page", in: "query", required: false }] }),
  ep(2, "POST", "/api/v1/contacts"),
  ep(3, "GET", "/api/v1/contacts/{id}"),
  ep(4, "DELETE", "/api/v1/contacts/{id}"),
  ep(5, "GET", "/api/v1/tags"),
  ep(6, "GET", "/api/v1/reports"),
  ep(7, "GET", "/api/v1/health"),
  { ...ep(8, "POST", "/api/v1/contacts/search", { params: [{ name: "q", in: "query", required: true }] }), crud: "action", queryLike: { evidence: "path segment 'search'", source: "name" } },
  ep(9, "PUT", "/api/v1/contacts/{id}"),
];
const ok = (status) => ({ expect: { status, source: "spec" } });
const sc = (n, endpoint, extra = {}) => ({ id: `API-contacts-${n}`, endpoint: `EP-contacts-${endpoint}`, type: "functional", priority: "p2", title: `scenario ${n}`, ...extra });
const PLAN = () => [
  sc(1, 1, { priority: "p1", ...ok(200) }), sc(2, 2, ok(201)), sc(3, 3, ok(200)), sc(4, 4, { expect: { statusIn: [200, 204], source: "spec" } }), sc(5, 5), sc(6, 6, { blocked: "needs an admin identity" }), sc(7, 8), sc(9, 9, ok(200)),
  sc(8, 2, { type: "lifecycle", steps: [{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-3" }, { endpoint: "EP-contacts-4" }] }),
  sc(10, 7),
];
const RESULTS = () => ({
  framework: "playwright-api", module: "contacts", runId: "acme-run-1", mode: "readonly", recordedAt: "2026-10-19T00:00:00Z", status: "ran",
  totals: { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0 }, durationMs: 0,
  items: [1, 2, 3, 4, 5, 7, 8, 9, 10].map((n) => ({ title: `contacts.spec.ts > API-contacts-${n} scenario ${n} @p2 @functional`, scenarioId: `API-contacts-${n}`, status: n === 5 ? "failed" : "passed" })),
});
const FLOW = { name: "contact-lifecycle", steps: [{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-3", bind: { param: "id", from: 0, pointer: "/id" } }, { endpoint: "EP-contacts-9", bind: { param: "id", from: 0, pointer: "/id" } }, { endpoint: "EP-contacts-4", bind: { param: "id", from: 0, pointer: "/id" } }], citations: [CITE] };
const OVERLAY = {
  flows: [FLOW],
  mixes: [{ name: "browse", endpoints: [{ endpoint: "EP-contacts-1", weight: 3 }, { endpoint: "EP-contacts-7", weight: 1 }], citation: CITE }],
  thinkTime: { "mix:browse": { ms: 1500, citation: CITE } },
  data: [{ target: "EP-contacts-3", need: "an existing contact id to read", citation: CITE }],
};

// A run with a verified workload; kc runs k6-code.mjs (inspect skipped).
async function setup({ mode = "full-run", k6, overlay = OVERLAY, plan = PLAN(), catalogue = CATALOGUE(), results = RESULTS() } = {}) {
  const { root } = startRun({ mode, extra: k6 ? [`k6: ${JSON.stringify(k6)}`] : [] });
  const pp = planPaths(path.join(root, "artifacts/acme"), "contacts");
  writeJson(pp.catalogue, catalogue);
  writeJson(pp.plan, plan);
  writeJson(pp.coverage, { verified: stampVerified({ plan: pp.plan, catalogue: pp.catalogue }) });
  put(root, "artifacts/acme/results/acme-run-1/contacts/playwright-api/results.json", JSON.stringify(results));
  put(root, "artifacts/acme/knowledge/modules/contacts/notes.md", "# Contacts\nCreating, reading and deleting a contact is the core flow.\n");
  if (overlay) put(root, `${MOD}/k6/workload-overlay.json`, JSON.stringify(overlay));
  for (const cmd of ["build", "check"]) {
    const r = await workload([cmd, "acme", "contacts"], { root });
    assert.equal(r.code, 0, `workload ${cmd}: ${JSON.stringify(r.out)}`);
  }
  const ctx = k6CodeContext({ root, product: "acme", module: "contacts", run: { modules: ["contacts", "deals"], runId: "acme-run-1" }, productDir: path.join(root, "artifacts/acme"), k6Project: path.join(root, "k6-tests/acme") });
  const kc = (cmd, ...rest) => main([cmd, "acme", "contacts", ...rest], { root, inspect: "skipped: test" });
  const k6f = (rel) => path.join(root, "k6-tests/acme", rel);
  const read = (rel) => readFileSync(k6f(rel), "utf8");
  const write = (rel, text) => writeFileSync(k6f(rel), text);
  const wl = () => JSON.parse(readFileSync(path.join(root, MOD, "k6/workload.json"), "utf8"));
  const plan_ = () => JSON.parse(readFileSync(path.join(root, MOD, "k6/code-plan.json"), "utf8"));
  const fileOf = (pred) => `scripts/contacts-${wl().scenarios.find(pred).name}.js`;
  return { root, ctx, kc, read, write, k6f, wl, plan: plan_, fileOf };
}

// A body for every slot kind, realistic and within the rules.
const FILL = {
  data: ["  return { contactId: 'c-1001' };"],
  "path:EP-contacts-3": ["  return { id: data.contactId };"],
  "query:EP-contacts-1": ["  return { page: 1 + Math.floor(Math.random() * 3) };"],
  "query:EP-contacts-8": ["  return { q: 'atf' };"],
  "body:EP-contacts-2": ["  const name = uniqueName('contact');", "  return { name, email: uniqueEmail('contact'), tags: ['atf'] };"],
  "body:EP-contacts-8": ["  return { filter: { createdAfter: new Date(Date.now() - 86400000).toISOString() } };"],
  "body:EP-contacts-9": ["  return { id: ref, name: uniqueName('renamed') };"],
  "checks:EP-contacts-1": ["  checkJsonKeys(res, ['items']);", "  checkLatency(res, 2000);"],
  "checks:EP-contacts-3": ["  checkJsonKeys(res, ['id', 'name']);"],
};
// Writes bodies into the slot file's regions (key -> lines).
function fill(s, bodies = FILL) {
  let text = s.read("scripts/slots/contacts.js");
  for (const [key, lines] of Object.entries(bodies)) {
    const re = new RegExp(`(  // k6-code:begin ${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n)[\\s\\S]*?(  // k6-code:end )`);
    assert.ok(re.test(text), `no slot ${key}`);
    text = text.replace(re, (_, a, b) => `${a}${lines.join("\n")}\n${b}`);
  }
  s.write("scripts/slots/contacts.js", text);
}
const probs = (r) => (r.out.problems ?? []).join("\n");

// Replaces text in a k6 file, asserting it was there.
function edit(s, rel, from, to) {
  const t = s.read(rel);
  assert.ok(t.includes(from), `${rel} has no ${from}`);
  s.write(rel, t.replace(from, to));
}
async function filledBuild(opts) {
  const s = await setup(opts);
  assert.equal((await s.kc("build")).code, 0);
  fill(s);
  const r = await s.kc("check");
  assert.equal(r.code, 0, probs(r));
  return s;
}
const flowFile = (s, type = "smoke") => s.fileOf((x) => x.kind === "flow" && x.type === type);
const mixFile = (s, type = "average-load") => s.fileOf((x) => x.kind === "mix" && x.type === type);

test("generation: one managed script per scenario for every kind and type, options verbatim from workload.json", async () => {
  const s = await setup({ k6: { modules: { contacts: { types: ["stress"] } } } });
  const b = await s.kc("build");
  assert.equal(b.code, 0, probs(b));
  const wl = s.wl();
  assert.deepEqual(new Set(wl.scenarios.map((x) => x.type)), new Set(["smoke", "average-load", "stress"]));
  assert.deepEqual(new Set(wl.scenarios.map((x) => x.kind)), new Set(["endpoint", "mix", "flow"]));
  for (const x of wl.scenarios) {
    const text = s.read(`scripts/contacts-${x.name}.js`);
    assert.ok(text.startsWith("// Generated by scripts/k6-code.mjs — do not edit.\n"), x.id);
    assert.match(text.split("\n")[1], new RegExp(`^// ${x.id} ${x.name}: type ${x.type}, kind ${x.kind}`));
    for (const e of x.endpoints) assert.ok(text.includes(`//   ${e} `), `${x.id} names ${e}`);
    assert.deepEqual(parseOptions(text), x.options, `${x.id} options verbatim`);
    assert.match(text, /^import \{ assertAllowedHost, requireFullRun, url \} from '\.\.\/lib\/config\.js';$/m);
    assert.match(text, /^export \{ handleSummary \} from '\.\.\/lib\/summary\.js';$/m);
    assert.match(text, /^export function teardown\(\) \{\}$/m);
    assert.doesNotMatch(text, /BASE_URL|__ENV|https?:\/\//);
  }
  // the executor follows the type: ramping stages for stress, constant for smoke and average-load
  const stress = wl.scenarios.find((x) => x.type === "stress" && x.kind === "endpoint");
  assert.equal(parseOptions(s.read(`scripts/contacts-${stress.name}.js`)).scenarios[stress.name].executor, "ramping-arrival-rate");
  assert.equal(parseOptions(s.read(flowFile(s))).scenarios[wl.scenarios.find((x) => x.kind === "flow" && x.type === "smoke").name].executor, "constant-arrival-rate");
  // the mix: a generated weighted pick; think time cited; the endpoint: one request with its path slot
  const mix = s.read(mixFile(s));
  assert.match(mix, /const pick = Math\.random\(\) \* 4;\n  if \(pick < 3\) \{/);
  assert.match(mix, /\/\/ think time 1500 ms, from workload\.json, cited: knowledge:modules\/contacts\/notes\.md\n  sleep\(1\.5\);/);
  const one = s.read(s.fileOf((x) => x.kind === "endpoint" && x.endpoints[0] === "EP-contacts-3" && x.type === "smoke"));
  assert.match(one, /const resPath = path_EP_contacts_3\(data, undefined\) \|\| \{\};\n  const res = http\.request\('GET', url\(`\/api\/v1\/contacts\/\$\{encodeURIComponent\(String\(resPath\.id\)\)\}`\), null, params\(\{ tags: \{ endpoint: 'EP-contacts-3' \} \}\)\);/);
  assert.match(one, /checkStatus\(res, 200, 'EP-contacts-3 GET \/api\/v1\/contacts\/\{id\} -> 200'\); \/\/ expected status: plan:API-contacts-3/);
  // the plan records every script and slot
  const plan = s.plan();
  assert.equal(plan.scripts.length, wl.scenarios.length);
  assert.deepEqual(plan.files.scripts, wl.scenarios.map((x) => `scripts/contacts-${x.name}.js`));
  assert.ok(plan.slots.find((x) => x.key === "body:EP-contacts-2").needed);
  assert.equal(plan.slots.find((x) => x.key === "checks:EP-contacts-1").needed, false);
});

test("requireFullRun(true) for write scenarios, (false) for reads; a readonly run generates smoke reads only", async () => {
  const s = await setup();
  assert.equal((await s.kc("build")).code, 0);
  for (const x of s.wl().scenarios) {
    const text = s.read(`scripts/contacts-${x.name}.js`);
    assert.match(text, new RegExp(`export function setup\\(\\) \\{\\n  assertAllowedHost\\(\\);\\n  requireFullRun\\(${x.mutates}\\);\\n  return setupData\\(\\) \\|\\| \\{\\};\\n\\}`), x.id);
    if (x.kind === "flow" || x.queryLike) assert.equal(x.mutates, true);
    if (x.kind === "mix") assert.equal(x.mutates, false);
  }
  const ro = await setup({ mode: "readonly" });
  assert.equal((await ro.kc("build")).code, 0);
  assert.ok(ro.wl().scenarios.every((x) => x.type === "smoke" && !x.mutates));
  for (const x of ro.wl().scenarios) {
    const text = ro.read(`scripts/contacts-${x.name}.js`);
    assert.match(text, /requireFullRun\(false\);/);
    assert.doesNotMatch(text, /trackLeftover|'POST'|'PUT'|'DELETE'/);
  }
});

test("every generated request carries the endpoint tag the thresholds select", async () => {
  const s = await setup({ k6: { modules: { contacts: { types: ["spike"] } } } });
  assert.equal((await s.kc("build")).code, 0);
  for (const x of s.wl().scenarios) {
    const text = s.read(`scripts/contacts-${x.name}.js`);
    const requests = text.split("\n").filter((l) => l.includes("http.request("));
    assert.ok(requests.length >= x.endpoints.length, x.id);
    for (const l of requests) assert.match(l, /params\(\{ (headers: \{ 'Content-Type': 'application\/json' \}, )?tags: \{ endpoint: 'EP-contacts-\d+' \} \}\)\);$/);
    const tagged = new Set(requests.map((l) => /endpoint: '([^']+)'/.exec(l)[1]));
    for (const metric of Object.keys(x.options.thresholds).filter((m) => m !== "dropped_iterations")) assert.ok(tagged.has(/\{endpoint:([^}]+)\}/.exec(metric)[1]), `${x.id} ${metric}`);
  }
});

test("flows: create, then trackLeftover at once, then steps bound to the created entity, then the delete; no delete step still tracks", async () => {
  const s = await setup();
  assert.equal((await s.kc("build")).code, 0);
  const text = s.read(flowFile(s));
  const at = (re) => text.search(re);
  assert.ok(at(/http\.request\('POST'/) < at(/trackLeftover\('contacts', ref\)/));
  assert.ok(at(/trackLeftover\('contacts', ref\)/) < at(/http\.request\('GET'/));
  assert.ok(at(/http\.request\('PUT'/) < at(/http\.request\('DELETE'/));
  assert.match(text, /if \(r0\.status !== 201\) return; \/\/ not the expected create status \(201\)[^\n]*\n  const ref = at\(r0, '\/id'\);[^\n]*\n  if \(ref === undefined \|\| ref === null \|\| ref === ''\) \{\n    untrackedCreate\('contacts', r0\);/);
  assert.match(text, /http\.request\('DELETE', url\(`\/api\/v1\/contacts\/\$\{encodeURIComponent\(String\(ref\)\)\}`\), null/);
  assert.match(text, /body_EP_contacts_9\(data, ref\)/);
  assert.equal(s.plan().scripts.find((x) => x.kind === "flow").cleanup.endpoint, "EP-contacts-4");
  // a flow without a delete step: still recorded for the ledger, and said so
  const nd = await setup({ overlay: { ...OVERLAY, flows: [{ ...FLOW, steps: FLOW.steps.slice(0, 3) }] } });
  assert.equal((await nd.kc("build")).code, 0);
  const t2 = nd.read(flowFile(nd));
  assert.match(t2, /trackLeftover\('contacts', ref\);/);
  assert.doesNotMatch(t2, /'DELETE'/);
  assert.match(t2, /no delete step/);
  assert.equal(nd.plan().scripts.find((x) => x.kind === "flow").cleanup.endpoint, null);
});

test("slots: bodies survive a rebuild; a body whose slot is gone is parked and comes back with its slot", async () => {
  const s = await filledBuild();
  const before = s.read("scripts/slots/contacts.js");
  assert.equal((await s.kc("build")).code, 0);
  assert.equal(s.read("scripts/slots/contacts.js"), before);
  // the flow leaves the workload: its body slots are parked
  put(s.root, `${MOD}/k6/workload-overlay.json`, JSON.stringify({ ...OVERLAY, flows: [] }));
  for (const cmd of ["build", "check"]) assert.equal((await workload([cmd, "acme", "contacts"], { root: s.root })).code, 0);
  let r = await s.kc("build");
  assert.equal(r.code, 0, probs(r));
  assert.deepEqual(r.out.parkedSlots.sort(), ["body:EP-contacts-2", "body:EP-contacts-9"]);
  assert.doesNotMatch(s.read("scripts/slots/contacts.js"), /body:EP-contacts-2/);
  const parked = JSON.parse(readFileSync(path.join(s.root, MOD, "k6/parked.json"), "utf8"));
  assert.deepEqual(parked.regions["body:EP-contacts-9"].lines, FILL["body:EP-contacts-9"]);
  assert.equal((await s.kc("check")).code, 0);
  // and back
  put(s.root, `${MOD}/k6/workload-overlay.json`, JSON.stringify(OVERLAY));
  for (const cmd of ["build", "check"]) assert.equal((await workload([cmd, "acme", "contacts"], { root: s.root })).code, 0);
  r = await s.kc("build");
  assert.deepEqual(r.out.restoredSlots.sort(), ["body:EP-contacts-2", "body:EP-contacts-9"]);
  assert.equal(s.read("scripts/slots/contacts.js"), before);
  assert.deepEqual(JSON.parse(readFileSync(path.join(s.root, MOD, "k6/parked.json"), "utf8")).regions, {});
  assert.equal((await s.kc("check")).code, 0);
});

test("drift: a hand edit of a generated script fails check; build restores it", async () => {
  const s = await filledBuild();
  const f = mixFile(s);
  edit(s, f, "  // weighted pick", "  console.log('x');\n  // weighted pick");
  const r = await s.kc("check");
  assert.equal(r.code, 1);
  assert.match(probs(r), new RegExp(`${f} \\[drift\\] differs from a fresh render`));
  assert.ok(r.out.problems.every((p) => /\[drift\]/.test(p)), probs(r));
  assert.equal((await s.kc("build")).code, 0);
  assert.equal((await s.kc("check")).code, 0);
  // CRLF line endings are not drift
  s.write(f, s.read(f).replace(/\n/g, "\r\n"));
  assert.equal((await s.kc("check")).code, 0);
});

test("check: options differing from workload.json", async () => {
  const s = await filledBuild();
  edit(s, mixFile(s), '"rate": 10,', '"rate": 50,');
  assert.match(probs(await s.kc("check")), /\[options\] options\.scenarios differ from workload\.json K6-contacts-\d+/);
});

test("check: thresholds differing from workload.json", async () => {
  const s = await filledBuild();
  edit(s, mixFile(s), '"p(95)<1000"', '"p(95)<5000"');
  assert.match(probs(await s.kc("check")), /\[thresholds\] options\.thresholds differ from workload\.json/);
});

test("check: a missing dropped_iterations threshold", async () => {
  const s = await filledBuild();
  const f = mixFile(s);
  s.write(f, s.read(f).replace(/,\n    "dropped_iterations": \[\n      "count<\d+"\n    \]/, ""));
  assert.match(probs(await s.kc("check")), /\[dropped-iterations\] no dropped_iterations threshold/);
});

test("check: requireFullRun with the wrong value", async () => {
  const s = await filledBuild();
  edit(s, flowFile(s), "requireFullRun(true);", "requireFullRun(false);");
  assert.match(probs(await s.kc("check")), /\[full-run\] requireFullRun\(false\) but K6-contacts-\d+ has mutates: true/);
  const m = await filledBuild();
  edit(m, mixFile(m), "  requireFullRun(false);\n", "");
  assert.match(probs(await m.kc("check")), /\[full-run\] setup\(\) does not call requireFullRun/);
});

test("check: a write scenario in a readonly workload", async () => {
  const s = await filledBuild();
  const wl = s.wl();
  const flow = wl.scenarios.find((x) => x.kind === "flow");
  const text = s.read(`scripts/contacts-${flow.name}.js`);
  assert.deepEqual(scriptRules("f.js", text, flow, wl), []);
  assert.match(scriptRules("f.js", text, flow, { ...wl, mode: "readonly" }).join("\n"), /\[readonly-write\] K6-contacts-\d+ is a write scenario in a readonly workload/);
  // and through the CLI: a workload that is not the verified one is refused before any script rule
  writeJson(path.join(s.root, MOD, "k6/workload.json"), { ...wl, mode: "readonly" });
  const r = await s.kc("check");
  assert.equal(r.code, 1);
  assert.match(probs(r), /the workload is not verified .*run node scripts\/workload\.mjs build acme contacts, then node scripts\/workload\.mjs check acme contacts/);
});

test("check: a write without trackLeftover or its delete step", async () => {
  const s = await filledBuild();
  const f = flowFile(s);
  edit(s, f, "  trackLeftover('contacts', ref); //", "  //");
  assert.match(probs(await s.kc("check")), /\[cleanup\] a write without trackLeftover/);
  const d = await filledBuild();
  const g = flowFile(d);
  d.write(g, d.read(g).replace(/  \/\/ step 4 of 4[\s\S]*?checks_EP_contacts_4\(r3, data\);\n/, ""));
  assert.match(probs(await d.kc("check")), /\[cleanup\] the flow's delete step EP-contacts-4 is not requested/);
});

test("check: a hard-coded URL or a default BASE_URL", async () => {
  const s = await filledBuild();
  edit(s, mixFile(s), "export function setup() {", "const TARGET = 'https://api.acme.test';\nexport function setup() {");
  assert.match(probs(await s.kc("check")), /\[hard-coded-url\] a hard-coded URL/);
  const b = await filledBuild();
  edit(b, mixFile(b), "export function setup() {", "const BASE_URL = __ENV.BASE_URL || 'localhost';\nexport function setup() {");
  assert.match(probs(await b.kc("check")), /\[base-url\] uses BASE_URL/);
});

test("check: sleep() without a think-time comment", async () => {
  const s = await filledBuild();
  edit(s, mixFile(s), "  // think time 1500 ms, from workload.json, cited: knowledge:modules/contacts/notes.md\n", "");
  assert.match(probs(await s.kc("check")), /\[sleep-comment\] line \d+: sleep\(\) without a think-time comment/);
});

test("check: a script per id missing, duplicated or extra (an orphan of the module)", async () => {
  const s = await filledBuild();
  const f = mixFile(s);
  const id = s.wl().scenarios.find((x) => x.kind === "mix" && x.type === "average-load").id;
  s.write("scripts/contacts-copy.js", s.read(f));
  s.write("scripts/contacts-old.js", "// hand-written\nexport default function () {}\n");
  s.write("scripts/deals-smoke-1.js", "// another module's\n");
  let r = await s.kc("check");
  assert.match(probs(r), new RegExp(`\\[duplicate-script\\] ${id} is implemented by 2 scripts`));
  assert.match(probs(r), /scripts\/contacts-old\.js \[extra-script\] names no scenario/);
  assert.doesNotMatch(probs(r), /deals-smoke-1/);
  // build removes a generated orphan, keeps a hand-written one unless --adopt moves it to k6/legacy/
  edit(s, "scripts/contacts-copy.js", `// ${id} `, "// K6-contacts-99 ");
  r = await s.kc("build", "--adopt");
  assert.deepEqual([r.out.removed, r.out.adopted], [["scripts/contacts-copy.js"], ["scripts/contacts-old.js"]]);
  assert.ok(existsSync(path.join(s.root, MOD, "k6/legacy/contacts-old.js")));
  assert.equal((await s.kc("check")).code, 0);
  // missing
  unlinkSync(s.k6f(f));
  assert.match(probs(await s.kc("check")), new RegExp(`\\[missing-script\\] ${id} has no script`));
});

test("check: malformed slot markers (and build refuses to rewrite)", async () => {
  const s = await filledBuild();
  edit(s, "scripts/slots/contacts.js", "  // k6-code:end body:EP-contacts-2", "  // k6-code:end body:EP-contacts-9");
  let r = await s.kc("check");
  assert.match(probs(r), /\[slot-markers\] line \d+: slot 'body:EP-contacts-2' ends as 'body:EP-contacts-9'/);
  r = await s.kc("build");
  assert.equal(r.code, 1);
  assert.match(probs(r), /fix the markers by hand; nothing was rewritten/);
  const m = await filledBuild();
  edit(m, "scripts/slots/contacts.js", "  // k6-code:begin data", "  // k6-code: begin data");
  assert.match(probs(await m.kc("check")), /\[slot-markers\] line \d+: a malformed slot marker/);
});

test("check: an empty slot that a loaded scenario needs; the skeleton outside the slots is generated", async () => {
  const s = await setup();
  assert.equal((await s.kc("build")).code, 0);
  let r = await s.kc("check");
  assert.equal(r.code, 1);
  assert.match(probs(r), /\[empty-slot\] body:EP-contacts-2 is empty, and K6-contacts-\d+, K6-contacts-\d+ need it/);
  assert.match(probs(r), /\[empty-slot\] data is empty/);
  assert.doesNotMatch(probs(r), /checks:EP-contacts-1/);
  fill(s);
  edit(s, "scripts/slots/contacts.js", "export function setupData() {", "import http from 'k6/http';\nexport function setupData() {");
  r = await s.kc("check");
  assert.match(probs(r), /\[skeleton\] generated code outside the slots was changed/);
});

test("slot scan: the bypass classes are findings", async () => {
  const s = await filledBuild();
  const secret = ["ab", "12"].join("").repeat(6);
  const cases = [
    ["alias of http", "body:EP-contacts-2", ["  const h = http;", "  return { r: h };"], /\[slot-forbidden\] body:EP-contacts-2: uses http/],
    ["globalThis computed", "body:EP-contacts-2", ["  return globalThis['ht' + 'tp'];"], /\[computed-access\][\s\S]*uses globalThis|uses globalThis[\s\S]*\[computed-access\]/],
    ["__ENV", "data", ["  return { token: __ENV.K6_TOKEN };"], /\[slot-forbidden\] data: uses __ENV/],
    ["escape-built name", "body:EP-contacts-2", ["  return \\u0068ttp;"], /\[escape\]/],
    ["URL literal", "query:EP-contacts-1", ["  return { next: 'https://evil.test/x' };"], /\[hard-coded-url\] query:EP-contacts-1: a URL literal/],
    ["URL pieces", "query:EP-contacts-1", ["  return { next: 'ht' + 'tp:' + '//x.test' };"], /\[hard-coded-url\]/],
    ["sleep", "checks:EP-contacts-1", ["  sleep(1);"], /\[slot-forbidden\] checks:EP-contacts-1: uses sleep/],
    ["static import", "data", ["  import http from 'k6/http';", "  return {};"], /\[slot-forbidden\] data: uses import/],
    ["dynamic import", "data", ["  return import('k6/http');"], /\[slot-forbidden\] data: uses import/],
    ["require and open", "data", ["  return { a: require('k6/http'), b: open('/etc/passwd') };"], /uses require[\s\S]*uses open/],
    ["eval and Function", "data", ["  return eval('1') + Function('return 1')();"], /uses eval[\s\S]*uses Function/],
    ["call/bind", "checks:EP-contacts-1", ["  checkStatus.call(null, res, 200);"], /\[call-apply-bind\]/],
    ["constructor walk", "data", ["  return {}.constructor;"], /\[forbidden-property\]/],
    ["secret literal", "data", [`  return { key: '${secret}' };`], /\[secret\] data: a secret-shaped literal/],
    ["raw check", "checks:EP-contacts-1", ["  check(res, { ok: () => true });"], /uses check/],
    ["member assignment", "checks:EP-contacts-1", ["  res.status = 200;"], /\[builtin-patch\]/],
    ["leaving the function", "data", ["  return {};", "}", "const z = uniqueName('x');", "function y() {"], /\[slot-structure\] data: closes a bracket/],
  ];
  for (const [name, key, lines, re] of cases) {
    assert.match(slotFindings("scripts/slots/contacts.js", key, lines, 10).join("\n"), re, name);
    fill(s, { [key]: lines });
    const r = await s.kc("check");
    assert.equal(r.code, 1, name);
    assert.match(probs(r), re, `${name} via check`);
    fill(s, { [key]: FILL[key] ?? [] });
  }
  assert.equal((await s.kc("check")).code, 0);
});

test("a realistic filled slot file passes and stamps verified; any later change unverifies", async () => {
  const s = await filledBuild({ k6: { modules: { contacts: { types: ["stress", "soak"] } } } });
  const r = await s.kc("check");
  assert.equal(r.code, 0, probs(r));
  assert.deepEqual(r.out.slots.emptyNeeded, []);
  assert.equal(k6CodeUnverified(s.ctx), null);
  const v = s.plan().verified;
  assert.ok(["workload", "slots", ...s.plan().files.scripts.map((f) => `script:${f}`)].every((k) => typeof v[k] === "string"));
  assert.ok(s.plan().slots.filter((x) => x.needed).every((x) => x.filled));
  fill(s, { "checks:EP-contacts-3": ["  checkJsonKeys(res, ['id']);"] });
  assert.match(k6CodeUnverified(s.ctx), /changed after k6-code\.mjs check/);
  assert.equal((await s.kc("check")).code, 0);
  assert.equal(k6CodeUnverified(s.ctx), null);
});

test("k6 inspect, when available: a failure or other options are problems; never run under tests", async () => {
  const s = await filledBuild();
  const wl = s.wl();
  const good = (file) => {
    const x = wl.scenarios.find((y) => file.endsWith(`-${y.name}.js`));
    return { out: JSON.stringify({ scenarios: { [x.name]: { ...x.options.scenarios[x.name], gracefulStop: "30s" } }, thresholds: x.options.thresholds }) };
  };
  const run = (inspect) => main(["check", "acme", "contacts"], { root: s.root, inspect });
  let r = await run(good);
  assert.equal(r.code, 0, probs(r));
  assert.equal(r.out.inspect, "ran");
  r = await run((file) => (file.includes("smoke") ? { error: "SyntaxError: Unexpected token" } : good(file)));
  assert.match(probs(r), /\[inspect\] k6 inspect failed: SyntaxError/);
  r = await run((file) => ({ out: good(file).out.replace(/constant-arrival-rate/g, "constant-vus") }));
  assert.match(probs(r), /\[inspect\] k6 inspect reports scenario .* with executor constant-vus/);
  // the default under node --test never runs k6
  r = await main(["check", "acme", "contacts"], { root: s.root });
  assert.equal(r.out.inspect, "skipped: under node --test");
});

test("build and check require a verified workload; paths name the managed and the agent-writable files", async () => {
  const s = await setup();
  const covFile = path.join(s.root, MOD, "k6/workload-coverage.json");
  const { verified, ...cov } = JSON.parse(readFileSync(covFile, "utf8"));
  assert.ok(verified);
  writeFileSync(covFile, JSON.stringify(cov));
  const b = await s.kc("build");
  assert.equal(b.code, 1);
  assert.match(probs(b), /the workload is not verified .*workload\.mjs build acme contacts/);
  assert.ok(!existsSync(s.k6f("scripts/slots/contacts.js")));
  assert.equal((await workload(["check", "acme", "contacts"], { root: s.root })).code, 0);
  assert.equal((await s.kc("build")).code, 0);
  const p = await s.kc("paths");
  assert.equal(p.code, 0);
  assert.deepEqual(p.out.agentWritable, { slots: "k6-tests/acme/scripts/slots/contacts.js" });
  assert.equal(p.out.managed.scriptsGlob, "k6-tests/acme/scripts/contacts-*.js");
  assert.equal(p.out.managed.codePlan, `${MOD}/k6/code-plan.json`);
  assert.equal(p.out.managed.parked, `${MOD}/k6/parked.json`);
  assert.deepEqual(p.out.managed.scripts, s.wl().scenarios.map((x) => `k6-tests/acme/scripts/contacts-${x.name}.js`));
  assert.equal((await main(["bogus", "acme"], { root: s.root })).code, 2);
  assert.equal((await main(["check", "acme", "contacts", "--adopt"], { root: s.root })).code, 2);
});

test("base path: url() prepends the k6 overlay's basePath, so a catalogue path under it is emitted relative to it", async () => {
  // pure: with the base path in the catalogue paths, without it, no overlay base path, and a different base path
  const e = (p, basePath = "") => ({ id: "EP-x-1", path: p, basePath });
  assert.deepEqual(urlPathOf(e("/api/v1/contacts/{id}", "/api/v1"), "/api/v1"), { urlPath: "/contacts/{id}" });
  assert.deepEqual(urlPathOf(e("/api/v1"), "/api/v1"), { urlPath: "/" });
  assert.deepEqual(urlPathOf(e("/contacts/{id}"), "/api/v1"), { urlPath: "/contacts/{id}" });
  assert.deepEqual(urlPathOf(e("/api/v1/contacts", "/api/v1"), ""), { urlPath: "/api/v1/contacts" });
  assert.deepEqual(urlPathOf(e("/api/v10/contacts"), "/api/v1"), { urlPath: "/api/v10/contacts" });
  assert.match(urlPathOf(e("/api/v2/contacts", "/api/v2"), "/api/v1").problem, /EP-x-1 \/api\/v2\/contacts is under the base path \/api\/v2, not the k6 overlay's basePath \/api\/v1/);
  // generated: no overlay base path -> the catalogue path as it is (the other tests); with one -> relative, no doubling
  const s = await filledBuild();
  put(s.root, "artifacts/acme/foundation/k6-overlay.json", JSON.stringify({ basePath: { path: "/api/v1/", module: "contacts", cite: CITE } }));
  assert.equal(k6CodeUnverified(s.ctx) !== null, true, "a changed k6 overlay unverifies the scripts");
  assert.equal((await s.kc("build")).code, 0);
  const text = s.read(flowFile(s));
  assert.match(text, /http\.request\('DELETE', url\(`\/contacts\/\$\{encodeURIComponent\(String\(ref\)\)\}`\), null/);
  assert.match(text, /http\.request\('POST', url\('\/contacts'\)/);
  assert.doesNotMatch(text, /url\([`']\/api\/v1/);
  assert.match(text, /\/\/   EP-contacts-4 DELETE \/api\/v1\/contacts\/\{id\}/, "the header keeps the catalogue path");
  const plan = s.plan();
  assert.equal(plan.basePath, "/api/v1");
  assert.equal(plan.scripts.find((x) => x.kind === "flow").requests[0].urlPath, "/contacts");
  assert.equal((await s.kc("check")).code, 0);
  // a catalogue endpoint under another base path is a build problem, not a doubled or wrong URL
  put(s.root, "artifacts/acme/foundation/k6-overlay.json", JSON.stringify({ basePath: { path: "/api/v2", module: "contacts", cite: CITE } }));
  writeJson(s.ctx.wp.catalogue, JSON.parse(readFileSync(s.ctx.wp.catalogue, "utf8")).map((x) => ({ ...x, basePath: "/api/v1" })));
  const pp = planPaths(path.join(s.root, "artifacts/acme"), "contacts");
  writeJson(pp.coverage, { verified: stampVerified({ plan: pp.plan, catalogue: pp.catalogue }) });
  for (const cmd of ["build", "check"]) assert.equal((await workload([cmd, "acme", "contacts"], { root: s.root })).code, 0);
  const r = await s.kc("build");
  assert.equal(r.code, 1);
  assert.match(probs(r), /K6-contacts-\d+: EP-contacts-\d+ \/api\/v1\/\S+ is under the base path \/api\/v1, not the k6 overlay's basePath \/api\/v2/);
});

test("leftovers: a 2xx delete calls trackDeleted, check requires it, and the summary drops deleted entities", async () => {
  const s = await filledBuild();
  const f = flowFile(s);
  const text = s.read(f);
  assert.match(text, /import \{ trackDeleted, trackLeftover, untrackedCreate \} from '\.\.\/lib\/data\.js';/);
  assert.match(text, /checks_EP_contacts_4\(r3, data\);\n  if \(r3\.status >= 200 && r3\.status < 300\) trackDeleted\('contacts', ref\);/);
  edit(s, f, "  if (r3.status >= 200 && r3.status < 300) trackDeleted('contacts', ref);", "  // gone");
  assert.match(probs(await s.kc("check")), /\[cleanup\] no trackDeleted after the flow's delete step EP-contacts-4/);
  // a flow without a delete step never imports or calls it
  const nd = await setup({ overlay: { ...OVERLAY, flows: [{ ...FLOW, steps: FLOW.steps.slice(0, 3) }] } });
  assert.equal((await nd.kc("build")).code, 0);
  assert.doesNotMatch(nd.read(flowFile(nd)), /trackDeleted/);
  // the lib: trackDeleted exists, and handleSummary's leftovers are the tracked entities less the deleted ones
  const tpl = (f) => readFileSync(new URL(`../templates/k6/lib/${f}.tpl`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.match(tpl("data.js"), /export function trackDeleted\(type, ref\) \{/);
  const src = tpl("summary.js");
  const body = src.slice(src.indexOf("// The {type, ref} entries"), src.indexOf("function metric("));
  const leftovers = new Function("DELETED_PREFIX", "LEFTOVER_PREFIX", `${body}\nreturn leftovers;`)("ATF_DELETED ", "ATF_LEFTOVER ");
  const ck = (prefix, type, ref) => ({ name: `${prefix}${JSON.stringify({ type, ref })}` });
  const root = { checks: [ck("ATF_LEFTOVER ", "contacts", "1"), ck("ATF_LEFTOVER ", "contacts", "2"), { name: "status 201" }], groups: [{ checks: [ck("ATF_DELETED ", "contacts", "1"), ck("ATF_DELETED ", "deals", "2")] }] };
  assert.deepEqual(leftovers(root), [{ type: "contacts", ref: "2" }]);
});

test("gate: a checked module passes; a slot edited after check is a k6-code blocker until check runs again", async () => {
  const { gate } = await import("./gate.mjs");
  const s = await filledBuild();
  put(s.root, "k6-tests/acme/lib/config.js", "export const x = 1;\n");
  const g = () => gate("acme", "contacts", "k6", { root: s.root, compile: false });
  assert.equal(g().verdict, "pass");
  edit(s, "scripts/slots/contacts.js", "  return { contactId: 'c-1001' };", "  return { contactId: 'c-1002' };");
  const r = g();
  assert.equal(r.verdict, "changes-required");
  assert.match(readFileSync(path.join(s.root, r.file), "utf8"), /\| k6-code \| the scripts, the slots or the workload changed after k6-code\.mjs check/);
  assert.equal((await s.kc("check")).code, 0);
  assert.equal(g().verdict, "pass");
});

// S7-F1: a parent -> child flow (D-005), the create-status gate, child tracking, pick().
const NESTED_CATALOGUE = () => [
  ...CATALOGUE(),
  ep(14, "POST", "/api/v1/contacts/{id}/notes", { resource: "notes" }),
  ep(15, "PUT", "/api/v1/contacts/{id}/notes/{noteId}", { resource: "notes" }),
  ep(16, "DELETE", "/api/v1/contacts/{id}/notes/{noteId}", { resource: "notes" }),
];
const NESTED_PLAN = () => [...PLAN(), sc(24, 14), sc(25, 15, ok(200)), sc(26, 16, ok(204))];
const NESTED_RESULTS = () => ({ ...RESULTS(), items: NESTED_PLAN().map((s) => ({ title: `contacts.spec.ts > ${s.id} ${s.title}`, scenarioId: s.id, status: s.id === "API-contacts-5" ? "failed" : "passed" })) });
const NB = (from, param = "id") => ({ param, from, pointer: "/id" });
const NESTED_FLOW = { name: "notes", steps: [{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-14", bind: NB(0) }, { endpoint: "EP-contacts-15", bind: [NB(0), NB(1, "noteId")] }, { endpoint: "EP-contacts-16", bind: [NB(0), NB(1, "noteId")] }, { endpoint: "EP-contacts-4", bind: NB(0) }], citations: [CITE] };
const nestedSetup = () => setup({ catalogue: NESTED_CATALOGUE(), plan: NESTED_PLAN(), results: NESTED_RESULTS(), overlay: { flows: [NESTED_FLOW] } });

test("D-3: every create of a flow is tracked by its id; the child is deleted (and trackDeleted) before its parent", async () => {
  const s = await nestedSetup();
  assert.equal((await s.kc("build")).code, 0);
  const text = s.read(flowFile(s));
  const at = (re) => text.search(re);
  // the child create: gated on its status (no plan status: any 2xx), tracked at once
  assert.match(text, /checks_EP_contacts_14\(r1, data\);\n  if \(r1\.status < 200 \|\| r1\.status >= 300\) return;[^\n]*\n  const ref1 = at\(r1, '\/id'\);[^\n]*\n  if \(ref1 === undefined \|\| ref1 === null \|\| ref1 === ''\) \{\n    untrackedCreate\('notes', r1\);[^\n]*\n    return;\n  \}\n  trackLeftover\('notes', ref1\);/);
  // the nested steps name the parent and the child the flow created
  assert.match(text, /http\.request\('PUT', url\(`\/api\/v1\/contacts\/\$\{encodeURIComponent\(String\(ref\)\)\}\/notes\/\$\{encodeURIComponent\(String\(ref1\)\)\}`\)/);
  assert.match(text, /if \(r3\.status >= 200 && r3\.status < 300\) trackDeleted\('notes', ref1\);/);
  assert.match(text, /if \(r4\.status >= 200 && r4\.status < 300\) trackDeleted\('contacts', ref\);/);
  assert.ok(at(/trackDeleted\('notes', ref1\)/) < at(/http\.request\('DELETE', url\(`\/api\/v1\/contacts\/\$\{encodeURIComponent\(String\(ref\)\)\}`\)/));
  assert.doesNotMatch(text, /Path = path_/);
  const x = s.plan().scripts.find((y) => y.kind === "flow");
  assert.deepEqual(x.creates.map((c) => [c.step, c.type, c.pointer]), [[0, "contacts", "/id"], [1, "notes", "/id"]]);
  assert.deepEqual(x.requests.map((r) => r.deletes ?? null), [null, null, null, 1, 0]);
  assert.deepEqual(s.plan().slots.filter((y) => y.key.startsWith("path:")).map((y) => y.key), ["path:EP-contacts-3"]); // a read outside the flow only
});

test("D-1 defence in depth: k6-code refuses a workload flow bound to a foreign field, and never gives a write a path slot", async () => {
  const s = await setup();
  const file = path.join(s.root, MOD, "k6/workload.json");
  const wl = s.wl();
  for (const x of wl.scenarios.filter((y) => y.kind === "flow")) {
    x.flow.steps[2].bind = { param: "id", from: 0, pointer: "/ownerId" };
    delete x.flow.steps[3].bind;
  }
  writeFileSync(file, JSON.stringify(wl, null, 2) + "\n");
  const m = computeModel(s.ctx);
  const text = m.problems.join("\n");
  assert.match(text, /flow 'contact-lifecycle' step 2: bind 'id' reads \/ownerId of step 0's response, not the created entity's id \/id/);
  assert.match(text, /EP-contacts-4 DELETE \/api\/v1\/contacts\/\{id\} writes, and its path parameter id is bound to no create of a flow: a write never gets a path: slot/);
  assert.ok(!m.slots.some((y) => y.key === "path:EP-contacts-4"));
  // and build refuses: the workload is no longer the verified one
  assert.equal((await s.kc("build")).code, 1);
});

test("D-2: the lib keeps a 2xx create without its id: id-like values tracked, else an untracked marker the summary reports", () => {
  const tpl = (f) => readFileSync(new URL(`../templates/k6/lib/${f}.tpl`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const src = tpl("data.js");
  const body = src.slice(src.indexOf("// The identity-shaped values")).replace(/^export /gm, "");
  const calls = [];
  const logs = [];
  const untrackedCreate = new Function("check", "trackLeftover", "UNTRACKED_PREFIX", "console", `${body}\nreturn untrackedCreate;`)(
    (_, o) => calls.push(["check", Object.keys(o)[0]]), (type, ref) => calls.push(["track", type, ref]), "ATF_UNTRACKED ", { warn: (m) => logs.push(m) });
  const res = (json, headers = {}) => ({ status: 201, headers, body: JSON.stringify(json), json: () => json });
  untrackedCreate("contacts", res({ data: { id: "a1" }, ownerId: "u9", accountId: "x" }));
  assert.deepEqual(calls.splice(0), [["track", "contacts", "a1"]]); // never ownerId or accountId
  untrackedCreate("contacts", res({}, { Location: "/api/v1/contacts/c-5" }));
  assert.deepEqual(calls.splice(0), [["track", "contacts", "c-5"]]);
  untrackedCreate("contacts", res({ ownerId: "u9" }));
  assert.deepEqual(calls.splice(0), [["check", 'ATF_UNTRACKED {"type":"contacts","status":201}']]);
  assert.equal(logs.length, 3);
  assert.match(logs[2], /ATF untracked create of contacts: status 201/);
  // handleSummary reports them, with their count
  const sum = tpl("summary.js");
  const fn = new Function("UNTRACKED_PREFIX", `${sum.slice(sum.indexOf("// The creates whose id"), sum.indexOf("function metric("))}\nreturn untracked;`)("ATF_UNTRACKED ");
  assert.deepEqual(fn({ checks: [{ name: "status 201", passes: 3 }], groups: [{ checks: [{ name: 'ATF_UNTRACKED {"type":"contacts","status":201}', passes: 2 }] }] }, []), [{ type: "contacts", status: 201, count: 2 }]);
  assert.match(sum, /\[`results\/\$\{name\}\.untracked\.json`\]/);
  assert.match(sum, /untracked creates: /);
});

test("pick(array): a random element of the setup data passes; a computed index still fails and suggests pick", async () => {
  assert.match(readFileSync(new URL("../templates/k6/lib/data.js.tpl", import.meta.url), "utf8"), /export function pick\(array\) \{/);
  const s = await filledBuild();
  assert.match(s.read("scripts/slots/contacts.js"), /import \{ pick, uniqueEmail, uniqueName \} from '\.\.\/\.\.\/lib\/data\.js';/);
  fill(s, { data: ["  return { contactIds: ['c-1001', 'c-1002'] };"], "path:EP-contacts-3": ["  return { id: pick(data.contactIds) };"] });
  const r = await s.kc("check");
  assert.equal(r.code, 0, probs(r));
  fill(s, { "path:EP-contacts-3": ["  const ids = data.contactIds;", "  return { id: ids[Math.floor(Math.random() * ids.length)] };"] });
  assert.match(probs(await s.kc("check")), /\[computed-access\] path:EP-contacts-3: [^\n]*for a random element of an array use pick\(array\) from lib\/data\.js/);
});

// S7-F2: N-1 (only a DELETE on the created entity's item path is a cleanup) and N-2 (a query-like item path).
const ACTION_CATALOGUE = () => [
  ...CATALOGUE(),
  ep(17, "DELETE", "/api/v1/contacts/{id}/assign", { crud: "action" }),
  { ...ep(18, "POST", "/api/v1/contacts/{id}/archive", { crud: "action" }), queryLike: { evidence: "overlay: archive is a filter", source: "overlay" } },
];
const ACTION_PLAN = () => [...PLAN(), sc(27, 17, ok(204)), sc(28, 18, ok(200))];
const ACTION_RESULTS = () => ({ ...RESULTS(), items: ACTION_PLAN().map((s) => ({ title: `contacts.spec.ts > ${s.id} ${s.title}`, scenarioId: s.id, status: s.id === "API-contacts-5" ? "failed" : "passed" })) });
const actionSetup = (steps) => setup({ catalogue: ACTION_CATALOGUE(), plan: ACTION_PLAN(), results: ACTION_RESULTS(), overlay: { flows: [{ name: "assign", steps, citations: [CITE] }] } });

test("N-1: a DELETE on an action sub-path is a write, never the cleanup: no trackDeleted, the entity stays a leftover", async () => {
  const unassign = await actionSetup([{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-9", bind: NB(0) }, { endpoint: "EP-contacts-17", bind: NB(0) }]);
  assert.equal(unassign.wl().scenarios.find((x) => x.kind === "flow").cleanup.endpoint, null);
  assert.equal((await unassign.kc("build")).code, 0);
  const text = unassign.read(flowFile(unassign));
  assert.match(text, /http\.request\('DELETE', url\(`\/api\/v1\/contacts\/\$\{encodeURIComponent\(String\(ref\)\)\}\/assign`\)/);
  assert.doesNotMatch(text, /trackDeleted/);
  assert.match(text, /trackLeftover\('contacts', ref\);/);
  assert.deepEqual(unassign.plan().scripts.find((y) => y.kind === "flow").requests.map((r) => r.deletes ?? null), [null, null, null]);
  // the summary logic: tracked and never deleted, so the contact stays in <script>.created.json (the ledger)
  const src = readFileSync(new URL("../templates/k6/lib/summary.js.tpl", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const leftovers = new Function("DELETED_PREFIX", "LEFTOVER_PREFIX", `${src.slice(src.indexOf("// The {type, ref} entries"), src.indexOf("function metric("))}\nreturn leftovers;`)("ATF_DELETED ", "ATF_LEFTOVER ");
  assert.deepEqual(leftovers({ checks: [{ name: `ATF_LEFTOVER ${JSON.stringify({ type: "contacts", ref: "7" })}` }, { name: "status 204" }] }), [{ type: "contacts", ref: "7" }]);
  // with the real item DELETE after it: only that one is the cleanup and gets trackDeleted
  const both = await actionSetup([{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-17", bind: NB(0) }, { endpoint: "EP-contacts-4", bind: NB(0) }]);
  assert.equal(both.wl().scenarios.find((x) => x.kind === "flow").cleanup.endpoint, "EP-contacts-4");
  assert.equal((await both.kc("build")).code, 0);
  const t2 = both.read(flowFile(both));
  assert.equal(t2.match(/trackDeleted\('contacts', ref\)/g).length, 1);
  assert.match(t2, /checks_EP_contacts_4\(r2, data\);\n  if \(r2\.status >= 200 && r2\.status < 300\) trackDeleted\('contacts', ref\);/);
  assert.deepEqual(both.plan().scripts.find((y) => y.kind === "flow").requests.map((r) => r.deletes ?? null), [null, null, 0]);
  // a trackDeleted added after the sub-path DELETE is a [cleanup] finding
  const f = flowFile(both);
  edit(both, f, "  checks_EP_contacts_17(r1, data);\n", "  checks_EP_contacts_17(r1, data);\n  if (r1.status >= 200 && r1.status < 300) trackDeleted('contacts', ref);\n");
  assert.match(probs(await both.kc("check")), /\[cleanup\] 2 trackDeleted calls, but 1 step deletes a created entity on its item path/);
  // defence in depth: a workload naming the sub-path DELETE as the cleanup is refused by k6-code
  const wl = unassign.wl();
  for (const x of wl.scenarios.filter((y) => y.kind === "flow")) x.cleanup.endpoint = "EP-contacts-17";
  writeFileSync(path.join(unassign.root, MOD, "k6/workload.json"), JSON.stringify(wl, null, 2) + "\n");
  assert.match(computeModel(unassign.ctx).problems.join("\n"), /\[cleanup\] workload\.json names EP-contacts-17 cleanup delete, but the flow's delete of its created entity \(a DELETE on its item path\) is none/);
});

test("N-2: a query-like POST on an item path is never loaded standalone and never gets a path slot", async () => {
  const s = await actionSetup([{ endpoint: "EP-contacts-2" }, { endpoint: "EP-contacts-4", bind: NB(0) }]);
  assert.ok(!s.wl().scenarios.some((x) => x.endpoints.includes("EP-contacts-18")));
  assert.ok(s.wl().scenarios.some((x) => x.endpoints.includes("EP-contacts-8") && x.queryLike)); // the collection-level search stays
  assert.equal((await s.kc("build")).code, 0);
  assert.ok(!s.plan().slots.some((y) => y.key === "path:EP-contacts-18"));
  // defence in depth: a workload that loads it standalone is refused, a query-like mutating request gets no path slot
  const wl = s.wl();
  const q = wl.scenarios.find((x) => x.endpoints.includes("EP-contacts-8"));
  q.endpoints = ["EP-contacts-18"];
  writeFileSync(path.join(s.root, MOD, "k6/workload.json"), JSON.stringify(wl, null, 2) + "\n");
  const m = computeModel(s.ctx);
  assert.match(m.problems.join("\n"), /EP-contacts-18 POST \/api\/v1\/contacts\/\{id\}\/archive is query-like but mutates, and its path parameter id is bound to no create of a flow: a write never gets a path: slot/);
  assert.ok(!m.slots.some((y) => y.key === "path:EP-contacts-18"));
});
