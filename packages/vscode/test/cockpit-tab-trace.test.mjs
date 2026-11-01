import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { install, uninstall } from "./fake-dom.mjs";
import { cockpitKit } from "../src/cockpit-style.js";
import { renderTrace } from "../src/cockpit-tabs/trace.js";

beforeEach(() => install());
afterEach(() => uninstall());

const fixture = () => ({
  schemaVersion: 1,
  run: { runId: "r1", mode: "readonly", active: false },
  missing: [],
  trace: { modules: [
    { module: "login", cases: [
      { id: "TC-login-1", title: "Valid login", types: ["ui", "api"], approval: "approved",
        automation: { ui: { status: "mapped", files: ["playwright-tests/acme/tests/ui/login/cases.spec.ts"], reason: null }, api: { status: "mapped", scenarios: ["API-login-3"], files: ["playwright-tests/acme/tests/api/login/auth.spec.ts"], reason: null } },
        results: [{ framework: "playwright-ui", title: "t", status: "passed", attempts: 2, passedOnRetry: true, triageClass: null }, { framework: "playwright-api", title: "t", status: "passed", attempts: 1, passedOnRetry: false, triageClass: null }] },
      { id: "TC-login-2", title: "Bad password", types: ["ui"], approval: "pending", automation: { ui: { status: "pending", files: [], reason: null } }, results: [] },
    ] },
    { module: "cart", cases: [
      { id: "TC-cart-1", title: "Add item", types: ["performance"], approval: "approved", automation: { k6: { status: "mapped", ids: ["K6-cart-1"], reason: null } },
        results: [{ framework: "k6", title: "t", status: "failed", attempts: 1, passedOnRetry: false, triageClass: "product-bug" }] },
      { id: "TC-cart-2", title: "Remove item", types: ["ui"], approval: "approved", automation: { ui: { status: "excluded", files: [], reason: "manual" } }, results: [] },
    ] },
  ] },
});

const mount = (data = fixture()) => {
  const posts = [];
  const node = renderTrace(data, { product: "acme" }, cockpitKit(), (m) => posts.push(m));
  return { node, posts };
};
const ids = (node) => node.findAll("code").map((c) => c.textContent).filter((t) => t.startsWith("TC-"));
const setFilter = (node, name, v) => {
  const s = node.findAll("select").find((x) => x.attributes["aria-label"] && x.name === name);
  s.value = v;
  s.dispatch("change");
};

test("renders counts and all cases", () => {
  const { node } = mount();
  assert.match(node.textContent, /4 cases · 3 approved · 2 automated · 1 passing/);
  assert.deepEqual(ids(node), ["TC-login-1", "TC-login-2", "TC-cart-1", "TC-cart-2"]);
  assert.match(node.textContent, /passed on retry/);
  assert.match(node.textContent, /product-bug/);
  assert.match(node.textContent, /×2/);
});

test("module and type filters", () => {
  const { node } = mount();
  setFilter(node, "module", "cart");
  assert.deepEqual(ids(node), ["TC-cart-1", "TC-cart-2"]);
  setFilter(node, "module", "");
  setFilter(node, "type", "api");
  assert.deepEqual(ids(node), ["TC-login-1"]);
  setFilter(node, "type", "performance");
  assert.deepEqual(ids(node), ["TC-cart-1"]);
});

test("gaps only: unapproved, unautomated or failing; excluded is not a gap", () => {
  const { node } = mount();
  const box = node.findAll("input")[0];
  box.checked = true;
  box.dispatch("change");
  assert.deepEqual(ids(node), ["TC-login-2", "TC-cart-1"]);
  box.checked = false;
  box.dispatch("change");
  assert.equal(ids(node).length, 4);
});

test("file link posts openFile; approval link posts openSheet", () => {
  const { node, posts } = mount();
  const f = node.findAll("button").find((b) => b.title === "playwright-tests/acme/tests/api/login/auth.spec.ts");
  assert.equal(f.textContent, "auth.spec.ts");
  f.dispatch("click");
  node.findAll("button").find((b) => b.textContent === "pending approval").dispatch("click");
  assert.deepEqual(posts, [{ type: "openFile", path: "playwright-tests/acme/tests/api/login/auth.spec.ts" }, { type: "openSheet", module: "login", sheet: "approval" }]);
});

test("empty state, filtered-empty state and missing note", () => {
  const d = { run: null, trace: { modules: [] }, missing: [{ section: "trace", module: null, reason: "no run yet" }, { section: "safety", module: null, reason: "x" }] };
  const { node } = mount(d);
  assert.match(node.textContent, /No test cases yet/);
  assert.match(node.textContent, /not available: no run yet/);
  assert.doesNotMatch(node.textContent, /not available: x/);
  const m = mount({});
  assert.match(m.node.textContent, /No test cases yet/);
  const f = mount();
  setFilter(f.node, "module", "login");
  setFilter(f.node, "type", "performance");
  assert.match(f.node.textContent, /No cases match the filters/);
});

test("is self-contained", () => {
  const fn = new Function("return (" + renderTrace.toString() + ")")();
  const node = fn(fixture(), {}, cockpitKit(), () => {});
  assert.equal(ids(node).length, 4);
});
