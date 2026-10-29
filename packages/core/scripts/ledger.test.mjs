// The ledger beyond the guard's own use of it: ownership by any of several refs (the UI run-time guard, D-074), and the
// human's sweep of what ended runs left in the target (D-075).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { endRun } from "./run.mjs";
import { paths } from "./lib/contract.mjs";
import { writeJson } from "./lib/files.mjs";
import { append, live, ownsAny, read } from "./lib/ledger.mjs";
import { sweep, sweepPlan } from "./lib/sweep.mjs";
import { put, startRun } from "./test-helpers.mjs";

const created = (runId, ref, extra = {}) => ({ runId, event: "created", type: "contact", ref, module: "contacts", stage: "playwright-api", agent: "playwright", ...extra });
const RECIPE = { endpoint: "EP-contacts-2", param: "id" };
const CATALOGUE = [
  { id: "EP-contacts-1", method: "POST", path: "/api/v1/contacts", server: "https://app.acme.test", crud: "create" },
  { id: "EP-contacts-2", method: "DELETE", path: "/api/v1/contacts/{id}", server: "https://app.acme.test", crud: "delete" },
  { id: "EP-contacts-3", method: "GET", path: "/api/v1/contacts/{id}", server: "https://app.acme.test", crud: "read" },
  { id: "EP-contacts-4", method: "DELETE", path: "/api/v1/contacts/{id}", server: "https://evil.example", crud: "delete" },
  { id: "EP-contacts-5", method: "DELETE", path: "/api/v1/groups/{group}/contacts/{id}", server: "https://app.acme.test", crud: "delete" },
];
const human = (answer) => ({ isTTY: true, ask: async () => answer });

test("ownsAny: any of the refs, of any type unless one is given, live and created by that run", () => {
  const { root } = startRun({ mode: "full-run" });
  const file = paths("acme", root).ledgerFile;
  append(file, created("acme-run-1", "41"));
  append(file, created("acme-run-0", "7"));
  append(file, { ...created("acme-run-1", "42"), event: "deleted" });
  assert.equal(ownsAny(file, "acme-run-1", ["api", "v1", "contacts", "41"]), true);
  assert.equal(ownsAny(file, "acme-run-1", ["41"], "deal"), false, "a given type must match");
  assert.equal(ownsAny(file, "acme-run-1", ["7"]), false, "another run's entity is never this run's");
  assert.equal(ownsAny(file, "acme-run-1", ["42"]), false, "a deleted entity is gone");
  assert.equal(ownsAny(file, "acme-run-1", []), false);
});

async function endedRun({ mode = "full-run" } = {}) {
  const { root } = startRun({ mode, apiUrls: ["https://api.acme.test"] });
  const p = paths("acme", root);
  append(p.ledgerFile, created("acme-run-1", "41", { cleanup: RECIPE }));
  append(p.ledgerFile, created("acme-run-1", "42"));
  append(p.ledgerFile, created("acme-run-1", "43", { cleanup: { endpoint: "EP-contacts-3", param: "id" } }));
  append(p.ledgerFile, created("acme-run-1", "44", { cleanup: { endpoint: "EP-contacts-4", param: "id" } }));
  append(p.ledgerFile, created("acme-run-1", "45", { cleanup: { endpoint: "EP-contacts-5", param: "id" } }));
  append(p.ledgerFile, created("acme-run-1", "46", { cleanup: { endpoint: "EP-contacts-9", param: "id" } }));
  append(p.ledgerFile, created("acme-run-1", "a b", { cleanup: RECIPE }));
  writeJson(path.join(p.module("contacts"), "api", "discovered-endpoints.json"), CATALOGUE);
  return { root, p };
}

test("sweep plan: only between runs, only under a full-run config, only recipes that are a first-party catalogue delete", async () => {
  const { root } = await endedRun();
  assert.match(sweepPlan("acme", { root }).errors[0], /a run is active/);
  await endRun("acme", { root });
  const plan = sweepPlan("acme", { root });
  assert.deepEqual(plan.items.map((i) => [i.entry.ref, i.method, i.url]), [
    ["41", "DELETE", "https://app.acme.test/api/v1/contacts/41"],
    ["a b", "DELETE", "https://app.acme.test/api/v1/contacts/a%20b"],
  ]);
  assert.deepEqual(Object.fromEntries(plan.manual.map((m) => [m.entry.ref, m.reason])), {
    42: "no cleanup recipe was recorded with it",
    43: "EP-contacts-3 (GET /api/v1/contacts/{id}) is not a delete",
    44: "evil.example is not a host of the product (target.url, target.api_urls)",
    45: "DELETE /api/v1/groups/{group}/contacts/{id} needs path values other than {id}",
    46: "its cleanup endpoint EP-contacts-9 is not in the contacts catalogue",
  });
  assert.deepEqual(sweepPlan("acme", { root, run: "acme-run-0" }).items, [], "--run limits it to one ended run");

  const ro = await endedRun({ mode: "readonly" });
  await endRun("acme", { root: ro.root });
  assert.match(sweepPlan("acme", { root: ro.root }).errors[0], /is readonly: a sweep deletes in the target/);
});

test("sweep: a dry run sends nothing; the real one needs a terminal and the typed slug, deletes through the recipes and records each", async () => {
  const { root, p } = await endedRun();
  await endRun("acme", { root });
  put(root, "playwright-tests/acme/.auth/state.json", JSON.stringify({ cookies: [{ name: "sid", value: "s3cret", domain: "app.acme.test", path: "/" }] }));
  put(root, "config/acme.yaml", `${readFileSync(path.join(root, "config", "acme.yaml"), "utf8").replace("authorizations: {mode: full-run}", "authorizations: {mode: full-run, session_state_file: playwright-tests/acme/.auth/state.json}")}\n`);
  const sent = [];
  const fetchImpl = async (url, init) => (sent.push({ url, method: init.method, cookie: init.headers.cookie, redirect: init.redirect }), { status: url.endsWith("/41") ? 204 : 500 });
  const opts = { root, fetchImpl, sleep: async () => {} };

  const dry = await sweep("acme", { ...opts, dryRun: true });
  assert.deepEqual([dry.wouldDelete.map((i) => i.ref), dry.manual.length, sent.length], [["41", "a b"], 5, 0]);
  assert.match((await sweep("acme", { ...opts, interactive: { isTTY: false } })).errors[0], /human-only/);
  assert.match((await sweep("acme", { ...opts, interactive: human("other") })).errors[0], /not confirmed/);
  assert.equal(sent.length, 0);

  const r = await sweep("acme", { ...opts, interactive: human("acme") });
  assert.deepEqual(sent, [
    { url: "https://app.acme.test/api/v1/contacts/41", method: "DELETE", cookie: "sid=s3cret", redirect: "manual" },
    { url: "https://app.acme.test/api/v1/contacts/a%20b", method: "DELETE", cookie: "sid=s3cret", redirect: "manual" },
  ]);
  assert.deepEqual([r.deleted.map((d) => [d.ref, d.status]), r.failed.map((d) => [d.ref, d.status])], [[["41", 204]], [["a b", 500]]]);
  assert.ok(!JSON.stringify(r).includes("s3cret"), "credentials never reach the output");
  const left = live(p.ledgerFile).map((e) => e.ref);
  assert.ok(!left.includes("41") && left.includes("a b"), "only what is gone is recorded deleted");
  const rec = read(p.ledgerFile).at(-1);
  assert.deepEqual([rec.event, rec.runId, rec.stage, rec.agent], ["deleted", "acme-run-1", "sweep", "human-sweep"]);
});
