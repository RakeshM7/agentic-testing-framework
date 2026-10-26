// scripts/explore.mjs: exploration as a script-owned state machine (D-052). Fixtures in scripts/fixtures/explore/ are
// modelled on the browser tool's accessibility snapshots (YAML-like aria lines with [ref=eN]) and network listings.
import test from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "./explore.mjs";
import { endRun, initRun, setStage } from "./run.mjs";
import { paths } from "./lib/contract.mjs";
import { append as appendCsv, csvPath, record as recordRow, setSteps } from "./lib/clarifications.mjs";
import { append as ledgerAdd } from "./lib/ledger.mjs";
import { recordCanary } from "./lib/guard-check.mjs";
import { normalizePath, restKey } from "./lib/endpoints.mjs";
import { extractControls, fingerprint, graphqlOps, modulePrefixes, mutatesControl, normalizeRequest, pageOf, parseGraphqlDocument, parseNetworkCapture, parseSnapshot, templatePath } from "./lib/explore.mjs";
import { exploreFixture, exploreSession, finishExploration, startRun, writeModuleKnowledge, writeProductKnowledge } from "./test-helpers.mjs";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "explore");
const fixture = (name) => readFileSync(path.join(FIX, name), "utf8");
const fp = (name) => fingerprint(parseSnapshot(fixture(name)).root).fingerprint;
const read = (f) => JSON.parse(readFileSync(f, "utf8"));

function setup({ mode = "readonly", extra = [] } = {}) {
  const { root } = startRun({ mode, extra });
  writeProductKnowledge(root);
  writeModuleKnowledge(root, "contacts");
  return exploreSession(root);
}

const explore = exploreFixture;
const finish = finishExploration;

// ---------- the fingerprint ----------

test("fingerprint: ignores values, row counts, numbers and refs; changes when a dialog opens, a tab is selected or the list is empty", () => {
  assert.equal(fp("contacts-list.md"), fp("contacts-list-other-data.md"), "other rows, emails, dates, counts and refs");
  const all = new Set(["contacts-list.md", "contacts-list-dialog.md", "contacts-list-tab-mine.md", "contacts-list-empty.md", "contacts-detail.md", "contacts-list-sorted.md", "contacts-list-filtered.md"].map(fp));
  assert.equal(all.size, 7, "dialog open, tab selected, empty, sorted, filtered and another page are each their own state");
  const lines = fingerprint(parseSnapshot(fixture("contacts-list.md")).root).lines.join("\n");
  for (const v of ["Jane Doe", "jane@private.test", "2026-10-01", "245", "e29"]) assert.ok(!lines.includes(v), `${v} is data, not structure`);
  assert.match(lines, /tab "All" \[selected\]/);
  assert.match(lines, /rows:some/);
});

test("the snapshot parser reads the browser tool's output: header, fence, attributes, properties, YAML-quoted keys", () => {
  const p = parseSnapshot(fixture("contacts-detail.md"));
  assert.equal(p.url, "https://app.acme.test/contacts/101");
  assert.equal(p.title, "Jane Doe - Acme CRM");
  const flat = [];
  const walk = (n) => (flat.push(n), n.children.forEach(walk));
  walk(p.root);
  const h = flat.find((n) => n.role === "heading" && n.attrs.level === "2");
  assert.equal(h.name, "Owner: Me");
  assert.equal(flat.find((n) => n.name === "Back to contacts").props.url, "/contacts");
  const bare = parseSnapshot('- button "Say \\"hi\\"" [disabled] [ref=e1]\n- textbox "Email" [ref=e2]: x@y.z');
  assert.equal(bare.root.children[0].name, 'Say "hi"');
  assert.equal(bare.root.children[0].attrs.disabled, true);
  assert.equal(bare.root.children[1].value, "x@y.z");
});

test("pages: ids, emails and tokens in the path are erased; hash routes count; another host is prefixed", () => {
  const o = "https://app.acme.test";
  assert.equal(pageOf("https://app.acme.test/contacts/101?tab=x", o).template, "/contacts/{id}");
  assert.equal(pageOf("https://app.acme.test/contacts/101?tab=x", o).url, "https://app.acme.test/contacts/101");
  assert.equal(pageOf("https://app.acme.test/app#/contacts/3f2b8c1e-1d2a-4b3c-9d8e-0a1b2c3d4e5f", o).template, "/contacts/{id}");
  assert.equal(pageOf("https://other.acme.test/x", o).template, "//other.acme.test/x");
  assert.equal(templatePath("/users/jane@private.test/reset/eyJhbGciOi.J9eyJzdWIiOjF9.c2ln"), "/users/{id}/reset/{id}");
});

// ---------- states, ids, the frontier ----------

test("state: a known state is not duplicated, its transition is; ids are stable across rebuilds and runs", async () => {
  const s = setup();
  const ids = await explore(s);
  const m = await s.model();
  assert.deepEqual(m.states.map((x) => x.id), ["ST-contacts-1", "ST-contacts-2", "ST-contacts-3", "ST-contacts-4", "ST-contacts-5"]);
  assert.deepEqual(m.pages.map((p) => [p.id, p.slug, p.template]), [["PG-contacts-1", "contacts", "/contacts"], ["PG-contacts-2", "contacts-id", "/contacts/{id}"]]);
  assert.ok(existsSync(path.join(s.xp.dir, "pages/contacts/states/ST-contacts-2.md")));
  assert.equal(readFileSync(path.join(s.xp.dir, "pages/contacts/dom-snapshot.md"), "utf8"), fixture("contacts-list.md"), "the first state, verbatim");
  const same = await s.state("contacts-list-other-data.md");
  assert.equal(same.state, ids.list);
  assert.equal(same.new, false);
  const back = m.transitions.find((t) => t.from === ids.dialog && t.to === ids.list);
  assert.deepEqual(back.actions, ['button "Cancel"']);
  assert.equal(m.states.find((x) => x.id === ids.detail).reach.steps.join(" | "), 'link "Jane Doe"');
  const before = JSON.stringify([m.states.map((x) => x.id), m.frontier.map((i) => i.id)]);
  const again = await s.model();
  assert.equal(JSON.stringify([again.states.map((x) => x.id), again.frontier.map((i) => i.id)]), before, "rebuild");

  // a new run: the same states and controls keep their ids
  await endRun("acme", { root: s.root, abandon: true });
  const r2 = initRun(path.join(s.root, "config", "acme.yaml"), { root: s.root, framework: s.root, runId: "acme-run-2", env: { CLAUDECODE: "1" } });
  assert.deepEqual(r2.errors, undefined);
  recordCanary("acme", s.root, { host: "claude-code", agent: "orchestrator-agent" });
  const d = await s.state("contacts-detail.md");
  assert.equal(d.state, ids.detail, "same fingerprint, same id in another run");
  const l = await s.state("contacts-list.md", d.state, 'link "Back to contacts"');
  assert.equal(l.state, ids.list);
  assert.equal((await s.item(ids.list, "tab", "Mine")).id, m.frontier.find((i) => i.state === ids.list && i.name === "Mine").id);
});

test("readonly behind the browser's network guard (D-076): inputs are explored, commits still never are", async () => {
  const s = setup();
  writeFileSync(path.join(s.root, "config", "mcp.yaml"), `servers:\n  playwright:\n    args:\n      - "--isolated"\n      - "--init-page"\n      - "scripts/browser/init-page.cjs"\n`);
  const list = await s.state("contacts-list.md");
  const added = Object.fromEntries(list.frontierAdded.map((i) => [`${i.role} ${i.name}`, i]));
  assert.equal(added["searchbox Search contacts"].status, "pending", "typing is explorable: the network guard aborts any write it could cause");
  assert.equal(added["combobox Sort by"].status, "pending");
  const dialog = await s.state("contacts-list-dialog.md", list.state, 'button "New contact"');
  const d = Object.fromEntries(dialog.frontierAdded.map((i) => [`${i.role} ${i.name}`, i]));
  assert.equal(d["textbox Name *"].status, "pending");
  assert.equal(d["button Save"].reason, "not-allowed-in-mode", "readonly: still never submit");
});

test("frontier: every candidate control; row links collapse; script-derived exclusions; navigation comes first", async () => {
  const s = setup();
  const list = await s.state("contacts-list.md");
  const added = Object.fromEntries(list.frontierAdded.map((i) => [`${i.role} ${i.name}`, i]));
  assert.equal(added["link Help"].reason, "external");
  assert.equal(added["button Sign out"].reason, "logout");
  assert.equal(added["link Deals"].reason, "out-of-module");
  assert.equal(added["link Privacy"].reason, "out-of-module");
  assert.equal(added["searchbox Search contacts"].reason, "not-allowed-in-mode", "readonly: no typing");
  assert.equal(added["combobox Sort by"].reason, "not-allowed-in-mode");
  assert.equal(added["button Delete selected"].reason, "disabled");
  assert.equal(added["link Jane Doe"].status, "pending");
  assert.equal(list.frontierAdded.filter((i) => i.role === "link" && /Doe|Patel|Wei/.test(i.name)).length, 1, "the rows' links are one item");
  const f = (await s.ex("frontier", "acme", "contacts")).out;
  assert.equal(f.items[0].role, "link", "navigation first");
  assert.ok(f.items.findIndex((i) => i.role === "tab") < f.items.findIndex((i) => i.role === "button"));

  const dialog = await s.state("contacts-list-dialog.md", list.state, 'button "New contact"');
  const d = Object.fromEntries(dialog.frontierAdded.map((i) => [`${i.role} ${i.name}`, i]));
  assert.equal(d["button New contact"].reason, "duplicate-of", "the same control on the same page is explored once");
  assert.equal(d["link Deals"].reason, "out-of-module");
  assert.equal(d["button Save"].reason, "not-allowed-in-mode", "readonly: never submit");
  assert.equal(d["button Cancel"].status, "pending");
  assert.equal(d["textbox Name *"].reason, "not-allowed-in-mode");
  await s.ex("build", "acme", "contacts");
  const inter = read(s.xp.interactions);
  const name = inter.find((i) => i.name === "Name *");
  assert.equal(name.required, true);
  assert.equal(name.kind, "input");
  assert.deepEqual(inter.find((i) => i.name === "Owner").options, ["Me", "Unassigned"]);
  assert.equal(inter.find((i) => i.name === "Email").placeholder, "name@example.com");
  assert.equal(inter.find((i) => i.name === "Save").mutates, true);
  assert.equal(inter.find((i) => i.name === "New contact" && i.state === list.state).tried, true);
});

test("full-run: inputs and submit buttons are frontier work, not derived away", async () => {
  const s = setup({ mode: "full-run" });
  const list = await s.state("contacts-list.md");
  const added = Object.fromEntries(list.frontierAdded.map((i) => [`${i.role} ${i.name}`, i]));
  assert.equal(added["searchbox Search contacts"].status, "pending");
  assert.equal(added["combobox Sort by"].status, "pending");
});

test("a transition must name what was done; --via must be a state of this run; captures only from explore/captures/", async () => {
  const s = setup();
  const list = await s.state("contacts-list.md");
  await assert.rejects(s.ex("state", "acme", "contacts", "--snapshot", s.cap("contacts-list-dialog.md"), "--via", list.state), /--via needs --action/);
  await assert.rejects(s.ex("state", "acme", "contacts", "--snapshot", s.cap("contacts-list-dialog.md"), "--via", "ST-contacts-99", "--action", 'button "x"'), /not a state recorded/);
  await assert.rejects(s.ex("state", "acme", "contacts", "--snapshot", "../../../../state/config.resolved.json"), /captures must be saved under/);
  const fr = (await s.item(list.state, "button", "New contact")).id;
  const r = await s.state("contacts-list-dialog.md", list.state, fr);
  assert.deepEqual(r.transition.items, [fr], "an item id works as the action too");
  const odd = await s.state("contacts-list.md", r.state, 'button "Close"');
  assert.match(odd.warnings.join("\n"), /matches no control/);
});

// ---------- budgets ----------

test("budgets: a new state or page over the budget is a deferred frontier item; transitions into known states still count", async () => {
  const s = setup({ extra: ["explore: {max_states: 2, max_pages: 1}"] });
  const list = await s.state("contacts-list.md");
  const detail = await s.ex("state", "acme", "contacts", "--snapshot", s.cap("contacts-detail.md"), "--via", list.state, "--action", 'link "Jane Doe"');
  assert.equal(detail.out.deferred, true, "a second page is over max_pages 1");
  assert.match(detail.out.detail, /explore\.max_pages \(1\)/);
  const dialog = await s.state("contacts-list-dialog.md", list.state, 'button "New contact"');
  assert.equal(dialog.new, true);
  assert.equal(dialog.budget.reached.states, true);
  const mine = await s.ex("state", "acme", "contacts", "--snapshot", s.cap("contacts-list-tab-mine.md"), "--via", list.state, "--action", 'tab "Mine"');
  assert.equal(mine.out.deferred, true);
  const known = await s.state("contacts-list.md", dialog.state, 'button "Cancel"');
  assert.equal(known.new, false, "a known state over the budget is still recorded");
  assert.ok(known.transition);
  const m = await s.model();
  assert.equal(m.states.length, 2);
  const byName = (n) => m.frontier.find((i) => i.state === list.state && i.name === n);
  assert.equal(byName("Jane Doe").status, "deferred");
  assert.equal(byName("Mine").status, "deferred");
  assert.equal(byName("Mine").reason, "budget");
  assert.ok(m.frontier.filter((i) => i.status === "pending").length === 0, "with the state budget full, the rest of the frontier is deferred, never dropped");
  assert.match(m.frontier.find((i) => i.name === "All").detail, /explore\.max_states \(2\) reached/);
  const cov = read(s.xp.coverage);
  assert.equal(cov.frontier.summary.total, m.frontier.length);
  assert.ok(cov.frontier.summary.deferred >= 3);
});

// ---------- the network ----------

test("ingest-network: method, host and path template with key names only; values, cookies, tokens and secrets never kept", async () => {
  const s = setup();
  const list = await s.state("contacts-list.md");
  const txt = s.cap("network-requests.txt");
  const r1 = (await s.ex("ingest-network", "acme", "contacts", "--file", txt)).out;
  assert.equal(r1.format, "network-requests");
  assert.equal(r1.dropped.static, 3, "scripts, styles and the vendor SDK");
  assert.equal(r1.rawCapture, "deleted");
  assert.ok(!existsSync(path.join(s.xp.dir, txt)), "the raw capture held values; it is gone");
  const har = s.cap("network.har");
  const r2 = (await s.ex("ingest-network", "acme", "contacts", "--file", har, "--state", list.state, "--keep")).out;
  assert.equal(r2.format, "har");
  assert.ok(existsSync(path.join(s.xp.dir, har)), "--keep keeps it");
  const inv = read(s.xp.inventory);
  const text = JSON.stringify(inv);
  for (const secret of ["SECRET", "jane@private", "jane%40", "Jane Private", "hunter2", "tok-", "555", "4242", "4243", "eyJ", "vip", "Bearer", "sid="]) assert.ok(!text.includes(secret), `${secret} must not be kept`);
  const by = (m, p) => inv.find((e) => e.method === m && e.pathTemplate === p);
  assert.deepEqual(by("GET", "/api/v1/contacts").queryKeys, ["access_token", "page", "search"]);
  assert.deepEqual(by("POST", "/api/v1/contacts").requestKeys, ["email", "name", "password", "tags"]);
  assert.deepEqual(by("POST", "/api/v1/contacts").responseKeys, ["email", "id", "name"]);
  assert.deepEqual(by("POST", "/api/v1/contacts").statusCodes, [201]);
  assert.deepEqual(by("GET", "/api/v1/contacts/{id}").responseKeys, ["id", "name", "owner"], "a base64 body is decoded for its keys");
  assert.deepEqual(by("GET", "/api/v1/contacts/{id}").statusCodes, [200]);
  assert.ok(by("GET", "/api/v1/contacts/{id}/notes"), "a UUID is an id");
  assert.ok(by("GET", "/api/v1/users/{id}/avatar"), "an email in the path is erased");
  assert.deepEqual(by("GET", "/api/v1/contacts/owner-index").responseKeys, ["total", "{key}"], "keys that are ids or emails are values");
  assert.deepEqual(by("POST", "/login").requestKeys, ["password", "username"]);
  assert.deepEqual(by("POST", "/graphql").graphql, [{ operationType: "mutation", operationName: "CreateContact", fields: ["createContact"] }]);
  assert.deepEqual(by("GET", "/graphql").graphql, [{ operationType: "query", operationName: "ContactList", fields: ["contacts"] }]);
  assert.equal(inv.find((e) => e.host === "www.google-analytics.com").pathTemplate, "/collect");
  assert.deepEqual(by("POST", "/api/v1/contacts").pages, ["contacts"]);
  assert.ok(inv.every((e) => /^NI-contacts-\d+$/.test(e.id)));
  // ids are stable: ingesting again (another capture of the same calls) changes none
  const ids = inv.map((e) => `${e.id} ${e.method} ${e.pathTemplate}`);
  await s.ex("ingest-network", "acme", "contacts", "--file", s.cap("network-requests.txt"));
  assert.deepEqual(read(s.xp.inventory).map((e) => `${e.id} ${e.method} ${e.pathTemplate}`), ids);
});

test("network parsing is robust: numbered listings, JSON lists, empty captures, GraphQL documents", () => {
  assert.deepEqual(parseNetworkCapture("1. [get] https://a.test/x => [200] OK\n2. [POST] https://a.test/y").requests.map((r) => [r.method, r.status]), [["GET", 200], ["POST", null]]);
  assert.equal(parseNetworkCapture("").requests.length, 0);
  assert.throws(() => parseNetworkCapture("nothing here"), /no requests found/);
  assert.throws(() => parseNetworkCapture("{ not json"), /does not parse/);
  const j = parseNetworkCapture(JSON.stringify([{ method: "PUT", url: "https://app.acme.test/api/x/9", status: 200, requestBody: { a: 1, b: { secret: "v" } } }]));
  assert.equal(j.format, "json");
  const n = normalizeRequest(j.requests[0], "https://app.acme.test");
  assert.deepEqual([n.method, n.pathTemplate, n.requestKeys], ["PUT", "/api/x/{id}", ["a", "b"]]);
  assert.deepEqual(normalizeRequest({ url: "data:image/png;base64,xx" }, "https://app.acme.test"), { drop: "not-http" });
  assert.deepEqual(parseGraphqlDocument("{ me { id } contacts(first: 2) { id } }"), [{ operationType: "query", fields: ["contacts", "me"] }]);
  assert.deepEqual(parseGraphqlDocument('query A($x: Int = 3) @cached { a: alpha(s: "}") { ...F } ... on Query { beta } } fragment F on Alpha { id }'), [{ operationType: "query", operationName: "A", fields: ["alpha"] }]);
  assert.deepEqual(graphqlOps({ operationName: "Persisted", extensions: { persistedQuery: { sha256Hash: "x" } } }), [{ operationType: "unknown", operationName: "Persisted", fields: [] }]);
  assert.deepEqual(graphqlOps([{ query: "mutation { a }" }, { query: "subscription S { b }" }]).map((o) => o.operationType), ["mutation", "subscription"]);
});

// ---------- the audit and check ----------

test("check passes once every frontier item, KQ and untried input is accounted for; the explore stage needs its stamp", async () => {
  const s = setup();
  const ids = await explore(s);
  const refused = await setStage("acme", "explore", "contacts", "done", undefined, { root: s.root });
  assert.match((refused.errors ?? []).join("\n"), /no verified stamp/, "no stamp, no done");
  finish(s, ids);
  await s.ex("ingest-network", "acme", "contacts", "--file", s.cap("network-requests.txt"));
  const r = await s.ex("check", "acme", "contacts");
  assert.deepEqual(r.out.problems, []);
  assert.equal(r.code, 0);
  assert.equal(r.out.summary.states, 5);
  assert.deepEqual([r.out.summary.kq.pending, r.out.summary.kq.total], [0, 4]);
  const cov = read(s.xp.coverage);
  assert.ok(cov.verified?.model);
  const kq = Object.fromEntries(cov.kq.items.map((k) => [k.id, k]));
  assert.deepEqual([kq["KQ-contacts-1"].outcome, kq["KQ-contacts-1"].refs], ["asked", ["contacts-1"]], "linked through the question's kq");
  assert.equal(kq["KQ-contacts-3"].status, "excluded");
  assert.deepEqual(cov.inputs.items.find((i) => i.id === ids.name).refs, ["contacts-1"]);
  assert.equal(cov.inputs.items.find((i) => i.id === ids.owner).reason, "explained");
  assert.deepEqual(cov.questions.map((q) => q.csv), ["contacts-1", "contacts-2"]);
  assert.match(readFileSync(s.xp.render, "utf8"), /## Frontier: deferred/);
  const sitemap = read(s.xp.sitemap);
  assert.deepEqual(sitemap.map((p) => p.id), ["PG-contacts-1", "PG-contacts-2"]);
  assert.ok(sitemap[0].links.includes("/deals"), "links to other modules are listed, not followed");

  const done = await setStage("acme", "explore", "contacts", "done", undefined, { root: s.root });
  assert.equal(done.status, "done", JSON.stringify(done.errors));
  s.write("flows/create-contact.md", `# Create a contact\n1. Open "Contacts" (${ids.list}).\n`);
  const stale = await setStage("acme", "explore", "contacts", "done", undefined, { root: s.root });
  assert.match(stale.errors.join("\n"), /changed after `explore\.mjs check`/);
});

test("check fails per rule: open frontier, unaccounted KQ, untried input, missing snapshot, unappended question, unknown state in a flow, schema", async () => {
  const s = setup();
  const ids = await explore(s);
  finish(s, ids);
  assert.equal((await s.ex("check", "acme", "contacts")).code, 0);
  const expectFail = async (re, mutate, restore) => {
    mutate();
    const r = await s.ex("check", "acme", "contacts");
    assert.equal(r.code, 1, `expected a failure matching ${re}`);
    assert.match(r.out.problems.join("\n"), re);
    restore();
    assert.equal((await s.ex("check", "acme", "contacts")).code, 0, `restored after ${re}`);
  };
  const overlay = read(s.xp.overlay);
  const questions = read(s.xp.questions);
  const set = (o) => s.write("overlay.json", o);
  const without = (section, id) => ({ ...overlay, [section]: Object.fromEntries(Object.entries(overlay[section]).filter(([k]) => k !== id)) });
  await expectFail(new RegExp(`frontier ${ids.edit} .*is open`), () => set(without("items", ids.edit)), () => set(overlay));
  await expectFail(/KQ-contacts-3: not observed, asked or dismissed/, () => set(without("kq", "KQ-contacts-3")), () => set(overlay));
  await expectFail(/KQ-product-1: .*observation:explore\/captures\/gone\.md/, () => set({ ...overlay, kq: { ...overlay.kq, "KQ-product-1": { status: "observed", evidence: "observation:explore/captures/gone.md" } } }), () => set(overlay));
  await expectFail(new RegExp(`input ${ids.sort} .*was not tried`), () => set(without("inputs", ids.sort)), () => set(overlay));
  await expectFail(/is not in clarifications\.csv/, () => s.write("new-questions.json", [...questions, { question: "Can two contacts share an email?", steps: "1. Sign in." }]), () => s.write("new-questions.json", questions));
  await expectFail(/ST-contacts-9 is not a state of this run/, () => s.write("flows/bad.md", "# Bad\n1. Open ST-contacts-9.\n"), () => rmSync(path.join(s.xp.flows, "bad.md")));
  await expectFail(/flows\/none\.md: names no state id/, () => s.write("flows/none.md", "# None\n1. Open Contacts.\n"), () => rmSync(path.join(s.xp.flows, "none.md")));
  await expectFail(/dom-snapshot\.md is missing/, () => rmSync(path.join(s.xp.pages, "contacts-id", "dom-snapshot.md")), () => copyFileSync(path.join(FIX, "contacts-detail.md"), path.join(s.xp.pages, "contacts-id", "dom-snapshot.md")));
  await expectFail(/overlay\.json: .*must be equal to one of the allowed values/, () => set({ ...overlay, items: { ...overlay.items, [ids.edit]: { reason: "boring", detail: "x", citation: "observation:explore/captures/edit-popup.md" } } }), () => set(overlay));
  await expectFail(/duplicate-of needs the other item's id/, () => set({ ...overlay, items: { ...overlay.items, [ids.edit]: { reason: "duplicate-of", detail: "the other one" } } }), () => set(overlay));
  await expectFail(/module-summary\.md: missing/, () => rmSync(s.xp.summary), () => s.write("module-summary.md", "# Contacts\n"));
});

test("live entities left by explore are reported, not a failure (D-005 limits deletes, it does not require them)", async () => {
  const s = setup({ mode: "full-run" });
  await s.state("contacts-list.md");
  ledgerAdd(paths("acme", s.root).ledgerFile, { runId: "acme-run-1", event: "created", type: "contact", ref: "ATF contacts 1", module: "contacts", stage: "explore", agent: "module-explorer" });
  const m = await s.model();
  const cov = read(s.xp.coverage);
  assert.deepEqual(cov.liveEntities, [{ type: "contact", ref: "ATF contacts 1" }]);
  assert.ok(m.frontier.length);
  const r = await s.ex("check", "acme", "contacts");
  assert.match(r.out.warnings.join("\n"), /live entity left by explore: contact ATF contacts 1/);
  assert.ok(!r.out.problems.some((p) => /live entity/.test(p)));
});

test("a missing knowledge open-points file is a problem, not silently zero KQs", async () => {
  const { root } = startRun();
  const ex = (...a) => main(a, { root, env: {} });
  const r = await ex("check", "acme", "contacts");
  assert.equal(r.code, 1);
  assert.match(r.out.problems.join("\n"), /knowledge\/modules\/contacts\/open-points\.json: missing/);
  assert.match(r.out.problems.join("\n"), /no state recorded/);
});

test("CLI: usage, unknown module, paths", async () => {
  const { root } = startRun();
  assert.equal((await main(["state"], { root })).code, 2);
  await assert.rejects(main(["build", "acme", "nope"], { root }), /module must be one of/);
  const p = (await main(["paths", "acme", "contacts"], { root })).out;
  assert.equal(p.overlay, "artifacts/acme/modules/contacts/explore/overlay.json");
  assert.equal(p.registry.states, "artifacts/acme/modules/contacts/explore/registry/states.json");
  assert.equal((await main(["state", "acme", "contacts"], { root })).code, 2);
});

// ---------- validator follow-ups (D-052) ----------

test("stamp: a state recorded after check, or a reworded question row, makes the stage refuse done; a later answer does not", async () => {
  const s = setup();
  const ids = await explore(s);
  finish(s, ids);
  assert.equal((await s.ex("check", "acme", "contacts")).code, 0);
  const csv = csvPath(paths("acme", s.root).productDir, "contacts");
  recordRow(csv, "contacts-2", { answer: "Any address with an @", runId: "acme-run-1" });
  assert.equal((await setStage("acme", "explore", "contacts", "done", undefined, { root: s.root })).status, "done", "answers from the clarification domain never make it stale");
  setSteps(csv, "contacts-1", { question: "Must a new contact have a \"Name\"?" });
  assert.match((await setStage("acme", "explore", "contacts", "done", undefined, { root: s.root })).errors.join("\n"), /clarifications\.csv rows .* changed/);
  setSteps(csv, "contacts-1", { question: "Is \"Name\" required when creating a contact?" });
  assert.equal((await setStage("acme", "explore", "contacts", "done", undefined, { root: s.root })).status, "done");
  await s.state("contacts-list-empty.md"); // a new state after the passing check
  assert.match((await setStage("acme", "explore", "contacts", "done", undefined, { root: s.root })).errors.join("\n"), /the exploration changed after its check: .*log/);
});

test("overlay: the agent's reasons only, each cited or a real duplicate; script-only reasons and uncited dismissals are refused", async () => {
  const s = setup({ mode: "full-run" });
  const list = await s.state("contacts-list.md");
  const id = async (role, name) => (await s.item(list.state, role, name)).id;
  const search = await id("searchbox", "Search contacts");
  const mine = await id("tab", "Mine");
  const all = await id("tab", "All");
  s.write("captures/why.md", "The \"Search contacts\" box is hidden behind a feature flag here.");
  const problems = async (overlay) => {
    s.write("overlay.json", overlay);
    return (await s.ex("check", "acme", "contacts")).out.problems.join("\n");
  };
  for (const reason of ["external", "out-of-module", "logout", "not-allowed-in-mode"])
    assert.match(await problems({ items: { [search]: { reason, detail: "x" } } }), new RegExp(`items\\.${search}: reason '${reason}' is not the agent's`), reason);
  assert.match(await problems({ items: { [search]: { reason: "unreachable", detail: "x" } } }), /unreachable needs a citation: a state id/);
  assert.match(await problems({ items: { [search]: { reason: "guard-denied", detail: "x", citation: "observation:explore/captures/none.md" } } }), /no such file under the module/);
  assert.match(await problems({ items: { [mine]: { reason: "duplicate-of", detail: search } } }), /that item is searchbox "Search contacts", not tab "Mine"/);
  assert.match(await problems({ items: { [mine]: { reason: "duplicate-of", detail: all } } }), /not tab "Mine"/, "same role, another name");
  // a cited exclusion closes the frontier item, but an input still needs a question or a reason
  const p = await problems({ items: { [search]: { reason: "unreachable", detail: "hidden", citation: "observation:explore/captures/why.md" } } });
  assert.doesNotMatch(p, new RegExp(`frontier ${search} `));
  assert.match(p, new RegExp(`input ${search} .*was not tried`));
  assert.match(await problems({ kq: { "KQ-contacts-1": { status: "dismissed", reason: "not relevant" } } }), /KQ-contacts-1: dismissed, but dismissed needs a citation/);
});

test("overlay citations must show what they are cited for: a blanket capture or an unrelated state proves nothing", async () => {
  const s = setup({ mode: "full-run" });
  const list = await s.state("contacts-list.md");
  const detail = await s.state("contacts-detail.md");
  const id = async (st, role, name) => (await s.item(st, role, name)).id;
  const search = await id(list.state, "searchbox", "Search contacts");
  const mine = await id(list.state, "tab", "Mine");
  const edit = await id(detail.state, "button", "Edit");
  s.write("captures/why.md", "x");
  s.write("captures/mine.md", "The \"Mine\" tab needs a second user to show anything.");
  const problems = async (overlay) => {
    s.write("overlay.json", overlay);
    return (await s.ex("check", "acme", "contacts")).out.problems.join("\n");
  };
  // the validator's attempt: one capture for every item and every KQ
  const blanket = { reason: "unreachable", detail: "x", citation: "observation:explore/captures/why.md" };
  const kqBlanket = { status: "dismissed", reason: "x", citation: "observation:explore/captures/why.md" };
  const all = await problems({ items: { [search]: blanket, [mine]: blanket, [edit]: blanket }, kq: { "KQ-contacts-1": kqBlanket, "KQ-product-1": kqBlanket } });
  for (const i of [search, mine, edit]) assert.match(all, new RegExp(`items\\.${i}: citation observation:explore/captures/why\\.md does not name`), i);
  assert.match(all, /KQ-contacts-1: .*does not quote the open point/);
  assert.match(all, /KQ-product-1: .*does not quote the open point/);
  // a capture covers only the items it names
  const one = await problems({ items: { [mine]: { reason: "unreachable", detail: "x", citation: "observation:explore/captures/mine.md" }, [search]: { reason: "unreachable", detail: "x", citation: "observation:explore/captures/mine.md" } } });
  assert.doesNotMatch(one, new RegExp(`items\\.${mine}:`));
  assert.match(one, new RegExp(`items\\.${search}: citation .* does not name searchbox "Search contacts"`));
  // a state must be a different state that acting on the item reached, never the state it was found in
  assert.match(await problems({ items: { [search]: { reason: "unreachable", detail: "x", citation: list.state } } }), new RegExp(`citation ${list.state} is the state the item was found in`));
  assert.match(await problems({ items: { [search]: { reason: "unreachable", detail: "x", citation: detail.state } } }), new RegExp(`citation ${detail.state}: no recorded transition from ${list.state} by ${search} reaches it`));
  assert.match(await problems({ items: { [search]: { reason: "unreachable", detail: "x", citation: "ST-contacts-99" } } }), /ST-contacts-99 is not a state of this run/);
  const filtered = await s.state("contacts-list-filtered.md", list.state, 'searchbox "Search contacts"');
  assert.doesNotMatch(await problems({ items: { [search]: { reason: "unreachable", detail: "x", citation: filtered.state } } }), new RegExp(`items\\.${search}:`), "a state the item reached");
  // a KQ: never its own knowledge file; a file must quote it; a state is enough
  assert.match(await problems({ kq: { "KQ-contacts-1": { status: "dismissed", reason: "x", citation: "knowledge:modules/contacts/overview.md" } } }), /is where the open point itself is written/);
  s.write("captures/import.md", "Settings > Import: the import flow is documented in the admin guide.");
  assert.doesNotMatch(await problems({ kq: { "KQ-contacts-1": { status: "dismissed", reason: "x", citation: "observation:explore/captures/import.md" } } }), /KQ-contacts-1/);
  assert.match(await problems({ kq: { "KQ-contacts-1": { status: "dismissed", reason: "x", citation: list.state } } }), /a bare state \(ST-contacts-\d+\) can't dismiss an open point/);
  // an answered clarification row counts only when a question linked it to the KQ
  const csv = csvPath(paths("acme", s.root).productDir, "contacts");
  const qs = [{ question: "Where is the import flow?", steps: "1. Sign in.\n2. Observe the menu.", kq: ["KQ-contacts-1"] }, { question: "Is there an export?", steps: "1. Sign in.\n2. Observe the menu." }];
  s.write("new-questions.json", qs);
  appendCsv(csv, "contacts", "acme-run-1", qs);
  recordRow(csv, "contacts-1", { answer: "Under Settings", runId: "acme-run-1" });
  recordRow(csv, "contacts-2", { answer: "No", runId: "acme-run-1" });
  assert.doesNotMatch(await problems({ kq: { "KQ-contacts-1": { status: "dismissed", reason: "x", citation: "clarification:contacts-1" } } }), /KQ-contacts-1/);
  assert.match(await problems({ kq: { "KQ-contacts-1": { status: "dismissed", reason: "x", citation: "clarification:contacts-2" } } }), /no question in new-questions\.json links it to KQ-contacts-1/);
  assert.match(await problems({ kq: { "KQ-contacts-1": { status: "observed", evidence: "observation:explore/captures/why.md" } } }), /KQ-contacts-1: .*does not quote/);
});

test("fingerprint: the page-template variance rule; sorted, filtered and empty are states of their own", async () => {
  const shape = (t) => fingerprint(parseSnapshot(t).root).shape;
  const full = (t) => fingerprint(parseSnapshot(t).root).fingerprint;
  const sh = (name) => fingerprint(parseSnapshot(fixture(name)).root).shape;
  assert.notEqual(sh("contacts-list.md"), sh("contacts-list-sorted.md"), "sorted differs from unsorted");
  assert.notEqual(sh("contacts-list.md"), sh("contacts-list-filtered.md"), "filtered differs from unfiltered");
  assert.notEqual(sh("contacts-list-filtered.md"), sh("contacts-list-empty.md"), "empty differs from non-empty");
  const sel = (i) => `- combobox "Sort by":\n  - option "Name"${i === 0 ? " [selected]" : ""}\n  - option "Created"${i === 1 ? " [selected]" : ""}`;
  assert.notEqual(shape(sel(0)), shape(sel(1)), "the selected option's index");
  assert.equal(shape('- textbox "Email": a@b.c'), shape('- textbox "Email": x@y.z'), "typed form values are data");
  // names stay significant in the fingerprint; only the page-template rule treats same-position names as data
  assert.notEqual(full('- button "Edit Contact"'), full('- button "Edit Deal"'));
  const dialog = (h) => `- main:\n  - button "New"\n- dialog [ref=e1]:\n  - heading "${h}" [level=2]\n  - textbox "Name"\n  - button "Save"`;
  assert.notEqual(shape(dialog("Create contact")), shape(dialog("Edit contact")), "a dialog's heading names the dialog");
  // record-varying names are data slots: breadcrumb items, level-1/2 headings, record links, collection items, the title
  const page = (person, owner, view) => `- main:\n  - navigation "Breadcrumb":\n    - link "Contacts":\n      - /url: /contacts\n    - link "${person}":\n      - /url: /contacts/1\n  - heading "${person}" [level=1]\n  - heading "Details" [level=3]\n  - link "${owner}":\n    - /url: /users/9\n  - button "Assign to ${person}"\n  - navigation "Saved views":\n    - list:\n      - listitem:\n        - link "${view}":\n          - /url: /contacts?view=1`;
  const shapeT = (t, title) => fingerprint(parseSnapshot(t).root, { title }).shape;
  assert.equal(shapeT(page("Jane Doe", "jdoe", "Hot leads"), "Jane Doe - Acme CRM"), shapeT(page("Raj Patel", "rpatel", "Q3 targets"), "Raj Patel - Acme CRM"), "two records' pages");
  // names that tell states apart stay: each pair is two states
  const apart = {
    "activate vs deactivate": ['- button "Activate"', '- button "Deactivate"'],
    "follow vs unfollow": ['- button "Follow"', '- button "Unfollow"'],
    "approve/reject vs reopen/archive": ['- button "Approve"\n- button "Reject"', '- button "Reopen"\n- button "Archive"'],
    "success vs error alert": ['- alert: Saved\n- alert "Contact saved"', '- alert "Could not save the contact"'],
    "validation messages": ['- textbox "Email"\n- text: Email is required', '- textbox "Email"\n- text: Email is invalid'],
    "chosen columns": ['- table:\n  - row:\n    - columnheader "Name"\n    - columnheader "Email"\n  - row:\n    - cell "a"', '- table:\n  - row:\n    - columnheader "Name"\n    - columnheader "Phone"\n  - row:\n    - cell "a"'],
    "filter chips": ['- button "Status: Open"', '- button "Status: Closed"'],
    "view vs edit mode": ['- status "Viewing"\n- button "Edit"', '- status "Editing"\n- button "Done"'],
    "active vs archived contacts": ['- heading "Active contacts" [level=3]', '- heading "Archived contacts" [level=3]'],
    "edit contact vs edit deal": ['- button "Edit Contact"', '- button "Edit Deal"'],
  };
  for (const [label, [x, y]] of Object.entries(apart)) assert.notEqual(shapeT(x, "Contacts - Acme CRM"), shapeT(y, "Contacts - Acme CRM"), label);

  // the state command
  const s = setup();
  const a = await s.state("contacts-detail.md");
  const b = await s.state("contacts-detail-other-record.md");
  assert.equal(b.state, a.state, "two records are one state");
  assert.equal(b.new, false);
  const m = await s.model();
  assert.ok(m.states.find((x) => x.id === a.state).dataSlots.length >= 1, "the varying name positions are recorded as data slots");
  await assert.rejects(s.ex("state", "acme", "contacts", "--snapshot", s.cap("contacts-detail.md"), "--url", "https://app.acme.test/contacts"), /snapshot's Page URL is \/contacts\/\{id\}/);
  // another page template never merges: Edit Contact on /contacts/{id} and Edit Deal on /deals/{id}
  const deal = fixture("contacts-detail.md").replaceAll("/contacts/101", "/deals/101").replace('"Edit"', '"Edit Deal"');
  s.write("captures/deal.md", deal);
  const other = (await s.ex("state", "acme", "contacts", "--snapshot", "captures/deal.md")).out;
  assert.notEqual(other.state, a.state);
});

test("states: the same snapshots give the same states whatever order they are recorded in", async () => {
  const order1 = ["contacts-detail.md", "contacts-detail-other-record.md", "contacts-list.md", "contacts-list-other-data.md", "contacts-list-sorted.md"];
  const run = async (names) => {
    const s = setup();
    const out = {};
    for (const n of names) out[n] = (await s.state(n)).state;
    const groups = {};
    for (const [n, st] of Object.entries(out)) (groups[st] ??= []).push(n);
    return Object.values(groups).map((g) => g.sort().join("+")).sort();
  };
  assert.deepEqual(await run(order1), await run([...order1].reverse()));
  assert.deepEqual(await run(order1), ["contacts-detail-other-record.md+contacts-detail.md", "contacts-list-other-data.md+contacts-list.md", "contacts-list-sorted.md"]);
});

test("--item: a budget deferral resolves the real frontier item, never a new one", async () => {
  const s = setup({ extra: ["explore: {max_states: 150, max_pages: 1}"] });
  const list = await s.state("contacts-list.md");
  const fr = (await s.item(list.state, "link", "Jane Doe")).id;
  const d = (await s.ex("state", "acme", "contacts", "--snapshot", s.cap("contacts-detail.md"), "--via", list.state, "--item", fr)).out;
  assert.equal(d.deferred, true);
  assert.equal(d.item, fr);
  const m = await s.model();
  assert.equal(m.frontier.find((i) => i.id === fr).status, "deferred");
  assert.deepEqual(m.frontier.filter((i) => i.role === "action" || i.role === "goto"), []);
});

test("readonly commit detection: dialog buttons other than a dismissal, and the commit verbs", () => {
  const b = (name, extra = {}) => mutatesControl({ role: "button", name, ...extra });
  for (const n of ["Mark as read", "Cancel order", "Close ticket", "Resolve", "Proceed", "Confirm", "Yes", "Approve", "Reject", "Archive", "Assign", "Send", "Submit", "Disable", "Follow", "Pin", "Run now", "Accept"]) assert.equal(b(n), true, n);
  for (const n of ["Cancel", "Close", "Open", "View details", "Next page", "Filters"]) assert.equal(b(n), false, n);
  assert.equal(b("Continue", { inDialog: true }), true, "inside a dialog every button but a dismissal commits");
  assert.equal(b("Cancel", { inDialog: true }), false);
  assert.equal(b("Create", { inForm: true }), true);
  assert.equal(b("Create"), false, "outside a form it opens one");
  assert.equal(mutatesControl({ role: "menuitem", name: "Delete" }), true);
});

test("module prefix: a leaf entry segment uses its parent; out-of-module derivations are listed by check", async () => {
  const cfg = (entry) => ({ modules: [{ slug: "contacts", name: "Contacts", entry_url: entry }] });
  assert.deepEqual(modulePrefixes(cfg("https://a.test/people/list"), "contacts", {}, null), ["/people"]);
  assert.deepEqual(modulePrefixes(cfg("https://a.test/crm/contacts/all"), "contacts", {}, null), ["/crm/contacts"]);
  assert.deepEqual(modulePrefixes(cfg("https://a.test/app#/contacts/list"), "contacts", {}, null), ["/contacts"]);
  assert.deepEqual(modulePrefixes(cfg("https://a.test/people/list"), "contacts", { scope: { prefixes: ["/directory"] } }, null), ["/directory", "/people"]);
  const s = setup();
  await s.state("contacts-list.md");
  const r = (await s.ex("check", "acme", "contacts")).out;
  assert.deepEqual(r.prefixes, ["/contacts"]);
  assert.deepEqual(r.outOfModule.map((i) => `${i.name} ${i.target}`).sort(), ["Deals /deals", "Privacy /privacy"]);
});

test("controls: nodes marked [cursor=pointer] are candidates too (a clickable generic, image, column header or row)", () => {
  const snap = `- main:\n  - generic [ref=e1] [cursor=pointer]: Open settings\n  - img "Avatar" [ref=e2] [cursor=pointer]\n  - table:\n    - row "h":\n      - columnheader "Name" [ref=e3] [cursor=pointer]\n    - row "Jane" [ref=e4] [cursor=pointer]:\n      - cell "Jane" [cursor=pointer]\n    - row "Raj" [ref=e5] [cursor=pointer]:\n      - cell "Raj"\n  - button "Go" [cursor=pointer]:\n    - generic [cursor=pointer]: Go`;
  const c = extractControls(parseSnapshot(snap).root, "https://a.test/");
  assert.deepEqual(c.map((x) => `${x.role}|${x.keyName}`), ["generic|Open settings", "img|Avatar", "columnheader|Name", "row|[row]", "button|Go"], "a pointer inside a control is part of it; body rows count once");
  assert.equal(c.find((x) => x.role === "row").occurrences, 2);
  assert.ok(c.find((x) => x.role === "generic").pointer);
});

test("network paths keep lib/endpoints.mjs's keys, plus the email and token rules; the people rule is for page paths only", () => {
  const o = "https://app.acme.test";
  const n = (url, extra = {}) => normalizeRequest({ method: "GET", url, ...extra }, o);
  // no over-erasure: each network template is exactly endpoints' key
  const paths = ["/api/v1/custom_fields", "/api/v1/email_templates", "/api/v1/contacts/upcoming", "/api/v1/users/login", "/api/v1/account/billing", "/api/conversations.list", "/api/v1/users/jdoe", "/api/v1/contacts/search", "/api/users/me", "/api/openapi.json", "/api/v1/notificationpreferencesettings"];
  for (const p of paths) {
    const t = n(o + p).pathTemplate;
    assert.equal(restKey("GET", o, t, o), restKey("GET", o, normalizePath(p).path, o), p);
  }
  assert.notEqual(n(o + "/api/v1/custom_fields").pathTemplate, n(o + "/api/v1/email_templates").pathTemplate);
  for (const keep of ["/api/v1/contacts/upcoming", "/api/v1/users/login", "/api/v1/account/billing", "/api/conversations.list"]) assert.equal(n(o + keep).pathTemplate, keep, keep);
  // emails and tokens are still values
  assert.equal(n(o + "/api/users/jane%40x.test").pathTemplate, "/api/users/{id}");
  assert.equal(n(o + "/api/sessions/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.c2ln").pathTemplate, "/api/sessions/{id}");
  assert.equal(n("https://u:p@app.acme.test/api/x;jsessionid=ABCDEF0123?x=1").pathTemplate, "/api/x", "matrix parameters dropped");
  // pages: a person after a people collection is data; common literals stay
  assert.equal(templatePath("/users/jdoe/activity", { people: true }), "/users/{id}/activity");
  for (const keep of ["/contacts/upcoming", "/users/login", "/account/billing", "/conversations.list", "/users/me"]) assert.equal(templatePath(keep, { people: true }), keep, keep);
  // keys: property-like names stay; a key that is a value does not
  const r = n(o + "/api/x?filter.status=1&page.size=2&sort-by-2=1&Jane%20Doe=1", { responseBody: JSON.stringify({ "Jane Doe": 1, "a@b.c": 1, "1001": 1, total: 2, "filter.status": 1 }) });
  assert.deepEqual(r.queryKeys, ["filter.status", "page.size", "sort-by-2", "{key}"]);
  assert.deepEqual(r.responseKeys, ["filter.status", "total", "{key}"]);
});

test("fingerprint: the snapshot's own title applies without --title; an alert's inline text is its name", () => {
  const sh = (name) => fingerprint(parseSnapshot(fixture(name)).root).shape;
  assert.equal(sh("contacts-detail.md"), sh("contacts-detail-other-record.md"), "'Assign to <record>' repeats the page title");
  const shape = (t) => fingerprint(parseSnapshot(t).root).shape;
  assert.notEqual(shape("- main:\n  - alert: Contact saved"), shape("- main:\n  - alert: Could not save contact"));
  assert.notEqual(shape("- main:\n  - status: Viewing"), shape("- main:\n  - status: Editing"));
});

test("citations: never the item's own state as a capture; an observed KQ must quote the open point", async () => {
  const s = setup({ mode: "full-run" });
  const raw = s.cap("contacts-list.md");
  const list = (await s.ex("state", "acme", "contacts", "--snapshot", raw)).out;
  const mine = (await s.item(list.state, "tab", "Mine")).id;
  const problems = async (overlay) => {
    s.write("overlay.json", overlay);
    return (await s.ex("check", "acme", "contacts")).out.problems.join("\n");
  };
  const cite = (c) => ({ items: { [mine]: { reason: "unreachable", detail: "x", citation: `observation:explore/${c}` } } });
  // the raw capture the state was recorded from, and the same screen with other data: both are the item's own state
  assert.match(await problems(cite(raw)), new RegExp(`is a snapshot of ${list.state}, the state the item was found in`));
  const again = s.cap("contacts-list-other-data.md");
  assert.match(await problems(cite(again)), new RegExp(`is a snapshot of ${list.state}`));
  // a snapshot of what acting showed (another shape) that names the item is fine
  const after = s.cap("contacts-list-tab-mine.md");
  assert.doesNotMatch(await problems(cite(after)), new RegExp(`items\.${mine}:`));
  // observed: a bare state that doesn't quote the KQ is refused; a state whose snapshot quotes it is enough
  assert.match(await problems({ kq: { "KQ-contacts-1": { status: "observed", state: list.state } } }), /state ST-contacts-\d+'s snapshot does not quote the open point/);
  s.write("captures/import.md", "### Page state\n- Page URL: https://app.acme.test/contacts/import\n- Page Snapshot:\n```yaml\n- main [ref=e1]:\n  - heading \"Import\" [level=3] [ref=e2]\n  - paragraph [ref=e3]: The import flow runs every night.\n```\n");
  const imp = (await s.ex("state", "acme", "contacts", "--snapshot", "captures/import.md")).out;
  assert.doesNotMatch(await problems({ kq: { "KQ-contacts-1": { status: "observed", state: imp.state } } }), /KQ-contacts-1/);
});

// ---------- scenario mode (selectable steps, decision 15) ----------

import { writeScenarios } from "./lib/explore.mjs";

test("scenario mode: only the scenarios' flows are explored; every scenario needs a flow or an audited reason", async () => {
  const s = setup();
  const productDir = paths("acme", s.root).productDir;
  const w = writeScenarios({ productDir, modules: ["contacts", "deals"], runId: "acme-run-1", answers: { modules: { contacts: [{ title: "Dialog for a new contact", goal: "the dialog opens", start: "the contact list", steps: ["New contact"] }, { title: "Export contacts", goal: "a CSV downloads", start: "the contact list", steps: ["Export"] }] } } });
  assert.deepEqual(w.written.contacts, ["SC-contacts-1", "SC-contacts-2"]);
  const list = await s.state("contacts-list.md");
  const m = await s.model();
  assert.ok(m.frontier.length > 0);
  assert.ok(!m.frontier.some((i) => i.status === "pending"), "nothing open");
  assert.ok(m.frontier.some((i) => i.status === "deferred" && i.reason === "scenario-scope"), "outside the scenarios: deferred, never dropped");
  let r = await s.ex("check", "acme", "contacts");
  let p = r.out.problems.join("\n");
  assert.ok(!/is open -- explore it/.test(p), "no open frontier in scenario mode");
  assert.match(p, /SC-contacts-1 \(Dialog for a new contact\): no flow names it/);
  assert.match(p, /SC-contacts-2 \(Export contacts\): no flow names it/);
  s.write("flows/new-contact.md", `# Dialog for a new contact\nScenario: SC-contacts-1\n1. Open "Contacts" (${list.state}).\n`);
  s.write("flows/stray.md", `# Stray\nSC-contacts-9 ${list.state}\n`);
  s.write("captures/export.md", "There is no Export control on the contact list.");
  s.write("overlay.json", { scenarios: { "SC-contacts-2": { reason: "not-in-product", detail: "the list has no export control", citation: "captures/export.md" } } });
  r = await s.ex("check", "acme", "contacts");
  p = r.out.problems.join("\n");
  assert.ok(!/SC-contacts-[12] \(/.test(p), p);
  assert.match(p, /flows\/stray\.md: names SC-contacts-9, which is not a scenario of scenarios\.json/);
  const cov = read(s.xp.coverage);
  assert.deepEqual(cov.scope.scenarios.map((x) => [x.id, x.status]), [["SC-contacts-1", "flow"], ["SC-contacts-2", "explained"]]);
  s.write("overlay.json", { scenarios: { "SC-contacts-2": { reason: "not-in-product", detail: "x", citation: "captures/nothing.md" } } });
  rmSync(path.join(s.xp.flows, "stray.md"));
  r = await s.ex("check", "acme", "contacts");
  assert.match(r.out.problems.join("\n"), /overlay\.json scenarios\.SC-contacts-2: cite the capture that shows it/);
});

test("scenario mode: a complete exploration passes check with its scenarios' flows, and the stamp covers scenarios.json", async () => {
  const s = setup();
  const ids = await explore(s);
  finish(s, ids);
  const productDir = paths("acme", s.root).productDir;
  writeScenarios({ productDir, modules: ["contacts"], runId: "acme-run-1", answers: { modules: { contacts: [{ title: "Create a contact", goal: "the dialog opens", start: "the contact list", steps: ["New contact"] }] } } });
  s.write("flows/create-contact.md", `# Create a contact\nScenario: SC-contacts-1\n1. Open "Contacts" (${ids.list}).\n2. Click "New contact" (${ids.dialog}).\n`);
  const r = await s.ex("check", "acme", "contacts");
  assert.equal(r.code, 0, JSON.stringify(r.out.problems));
  assert.equal(read(s.xp.coverage).verified.scenarios.length, 64);
});
