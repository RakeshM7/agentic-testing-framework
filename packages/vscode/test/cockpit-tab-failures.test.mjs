// the Cockpit's Failures tab (src/cockpit-tabs/failures.js), against the fake DOM.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cockpitKit } from "../src/cockpit-style.js";
import { renderFailures } from "../src/cockpit-tabs/failures.js";
import { install, uninstall } from "./fake-dom.mjs";

let K;
before(() => {
  install();
  K = cockpitKit();
});
after(() => uninstall());

const row = (o) => ({ key: "k", title: "t", error: "boom", evidence: [], ...o });
const fixture = (over = {}) => ({
  run: { runId: "r1", mode: "readonly", active: false },
  trace: { modules: [{ module: "login", cases: [{ id: "TC-login-1", results: [{ framework: "playwright-ui", status: "failed" }] }] }] },
  failures: {
    byClass: { "product-bug": 3, "test-bug": 1, flaky: 1 },
    clusters: [
      { module: "login", framework: "playwright-ui", id: "BUG-login-2", class: "test-bug", severity: "minor", signature: "sig-minor-1", count: 1, rows: [row({ title: "minor row", tcId: "TC-login-2", error: "bad\nsecond line", fixHint: "use getByRole" })], bugDraft: null },
      { module: "login", framework: "playwright-api", id: "BUG-login-3", class: "flaky", severity: null, signature: "sig-null", count: 5, rows: [row({ title: "null row" })], bugDraft: null },
      { module: "login", framework: "playwright-ui", id: "BUG-login-1", class: "product-bug", severity: "critical", signature: "sig-crit", count: 2, rows: [row({ title: "crit row", tcId: "TC-login-1", evidence: ["artifacts/acme/shot.png"] })], bugDraft: { file: "artifacts/acme/bug.md", title: "Bug draft one" } },
      { module: "login", framework: "playwright-ui", id: "BUG-login-4", class: "product-bug", severity: "critical", signature: "sig-crit-big", count: 9, rows: [row({ title: "big row" })], bugDraft: null },
    ],
    healable: [{ module: "login", framework: "playwright-ui", stage: "playwright-ui", count: 2 }],
    unverified: [{ module: "login", framework: "playwright-api" }],
  },
  missing: [{ section: "failures", module: "cart", reason: "no triage.json" }, { section: "safety", module: null, reason: "other" }],
  ...over,
});
const render = (data, posts = []) => renderFailures(data, {}, K, (m) => posts.push(m));
const sigs = (n) => n.findAll("div.cluster").map((c) => c.descendants().find((d) => d.localName === "div" && d.className === "" && d.textContent.includes("sig"))?.textContent);
const clusterTitles = (n) => n.findAll("div.cluster").map((c) => c.textContent);

test("clusters sort by severity then count, null severity last", () => {
  const n = render(fixture());
  const order = n.findAll("div.cluster").map((c) => c.find("code.id").textContent);
  assert.deepEqual(order, ["BUG-login-4", "BUG-login-1", "BUG-login-2", "BUG-login-3"]);
  assert.ok(sigs(n).length === 4);
});

test("rows show id chip, title, first line of error, fixHint", () => {
  const n = render(fixture());
  const t = clusterTitles(n).join("|");
  assert.match(t, /minor row/);
  assert.match(t, /bad/);
  assert.doesNotMatch(t, /second line/);
  assert.match(t, /use getByRole/);
  assert.ok(n.findAll("code").some((c) => c.textContent === "TC-login-2"));
});

test("class chips filter clusters and toggle off", () => {
  const n = render(fixture());
  const chips = () => n.findAll("button.chip");
  assert.equal(chips().length, 3);
  assert.ok(chips().some((c) => c.textContent === "product-bug 3"));
  chips().find((c) => c.textContent.startsWith("flaky")).dispatch("click");
  assert.equal(n.findAll("div.cluster").length, 1);
  chips().find((c) => c.textContent.startsWith("flaky")).dispatch("click");
  assert.equal(n.findAll("div.cluster").length, 4);
  chips().find((c) => c.textContent.startsWith("product-bug")).dispatch("click");
  assert.equal(n.findAll("div.cluster").length, 2);
});

test("evidence and bug draft post openFile", () => {
  const posts = [];
  const n = render(fixture(), posts);
  const links = n.findAll("button.link");
  links.find((b) => b.textContent === "artifacts/acme/shot.png").dispatch("click");
  links.find((b) => b.textContent === "Bug draft one").dispatch("click");
  assert.deepEqual(posts, [{ type: "openFile", path: "artifacts/acme/shot.png" }, { type: "openFile", path: "artifacts/acme/bug.md" }]);
});

test("Heal posts module and stage", () => {
  const posts = [];
  const n = render(fixture(), posts);
  n.findAll("button").find((b) => b.textContent === "Heal").dispatch("click");
  assert.deepEqual(posts, [{ type: "heal", module: "login", stage: "playwright-ui" }]);
});

test("unverified banner and missing notes", () => {
  const n = render(fixture());
  assert.match(n.textContent, /Unverified triage: login \(playwright-api\)/);
  assert.match(n.textContent, /Not available \(cart\): no triage\.json/);
  assert.doesNotMatch(n.textContent, /other/);
  const clean = render(fixture({ failures: { byClass: {}, clusters: [], healable: [], unverified: [] }, missing: [] }));
  assert.doesNotMatch(clean.textContent, /Unverified/);
});

test("empty states", () => {
  const none = { byClass: {}, clusters: [], healable: [], unverified: [] };
  assert.equal(render(fixture({ failures: none })).find("div.empty").textContent, "No failures");
  const noResults = render(fixture({ failures: none, trace: { modules: [] } })).find("div.empty").textContent;
  assert.match(noResults, /No results yet/);
  assert.equal(render({ run: null, failures: {}, missing: [] }).find("div.empty").textContent, "No run yet");
  assert.ok(render({}).find("div.empty"));
});

test("is self-contained (embeddable by source)", () => {
  const fn = new Function("return (" + renderFailures.toString() + ")")();
  const n = fn(fixture(), {}, K, () => {});
  assert.equal(n.findAll("div.cluster").length, 4);
});
