// The Cockpit end to end (D-110, D-111; docs/cockpit-plan.md): the framework's real cockpit data (lib/cockpit.mjs over the
// shared test workspace) rendered by the real sidebar page, the editor tab's page and each of its four tabs. Every button
// is clicked, and every message it posts must pass the host's validator: the parts were written in parallel against the
// plan's contracts, so this is where a drift between them shows.
import test from "node:test";
import assert from "node:assert/strict";
import { cockpitData } from "../../core/scripts/lib/cockpit.mjs";
import { withResults, workspace } from "../../core/scripts/fixtures/cockpit-workspace.mjs";
import { cockpitKit } from "../src/cockpit-style.js";
import { RENDERERS, renderCockpitPanelHtml, validateTabMessage } from "../src/cockpit-panel-page.js";
import { cockpitClient, stageStateCopy, validatePanelMessage } from "../src/cockpit-sidebar-page.js";
import { install, uninstall } from "./fake-dom.mjs";

async function c1() {
  const root = workspace();
  withResults(root);
  return { root, data: await cockpitData("acme", { root }) };
}

// clicks every button (and toggles every checkbox) under node; the posted messages
function clickAll(node, posted) {
  const before = posted.length;
  for (const b of node.findAll("button")) if (!b.disabled) b.dispatch("click");
  for (const i of node.findAll("input")) if (i.type === "checkbox") i.dispatch("change");
  return posted.slice(before);
}

test("each tab renders the real C1 and posts only messages the host accepts", async () => {
  const { data } = await c1();
  const expect = { timeline: /explore/, trace: /TC-contacts-1/, failures: /BUG-contacts-1/, safety: /readonly/ };
  for (const [tab, render] of Object.entries(RENDERERS)) {
    install();
    try {
      const posted = [];
      const ctx = { product: "acme", environment: "default", run: data.run, focus: null };
      const node = render(data, ctx, cockpitKit(), (m) => posted.push(m));
      assert.match(node.textContent, expect[tab], `${tab} shows its data`);
      for (const m of clickAll(node, posted)) assert.ok(validateTabMessage(m).ok, `${tab} posted ${JSON.stringify(m)}: ${validateTabMessage(m).error}`);
      // the same with no run: an empty state, no throw
      const empty = render({ ...data, run: null, overview: { stages: [], next: [], needsYou: [], intents: {} }, timeline: { stages: [], totals: null, history: [] }, trace: { modules: [] }, failures: { byClass: {}, clusters: [], healable: [], unverified: [] }, safety: { mode: null, explanation: "", ledger: { file: null, entries: [], live: 0, cleaned: 0 }, customConfig: null, frameworkIssues: 0 }, missing: [{ section: "run", module: null, reason: "no run yet" }] }, { ...ctx, run: null }, cockpitKit(), () => {});
      assert.ok(empty.textContent.length > 0, `${tab} says something with no run`);
    } finally {
      uninstall();
    }
  }
});

test("the editor tab's page shows every tab of the real C1 without an error", async () => {
  const { data } = await c1();
  const doc = install();
  const posted = [];
  const listeners = {};
  try {
    const app = doc.createElement("div");
    doc.getElementById = () => app;
    globalThis.acquireVsCodeApi = () => ({ postMessage: (m) => posted.push(m), getState: () => null, setState() {} });
    globalThis.window = { addEventListener: (t, fn) => (listeners[t] = fn) };
    const script = renderCockpitPanelHtml({ nonce: "abcdEFGH1234abcdEFGH1234" }).match(/<script nonce="[^"]+">([\s\S]*)<\/script>/)[1];
    new Function(script)();
    const expect = { timeline: /explore/, trace: /TC-contacts-1/, failures: /BUG-contacts-1/, safety: /ledger/i };
    for (const tab of Object.keys(RENDERERS)) {
      listeners.message({ data: { type: "data", product: "acme", environment: "default", tab, data } });
      assert.match(app.textContent, expect[tab], `${tab} drawn in the page`);
      assert.doesNotMatch(app.textContent, /could not|TypeError|undefined/i, `${tab}: ${app.textContent.slice(0, 300)}`);
    }
    for (const m of posted) assert.ok(validateTabMessage(m).ok, JSON.stringify(m));
  } finally {
    delete globalThis.acquireVsCodeApi;
    delete globalThis.window;
    uninstall();
  }
});

test("the sidebar shows the real C1 and posts only messages the host accepts", async () => {
  const { data } = await c1();
  const doc = install();
  const posted = [];
  let listener;
  try {
    const app = doc.createElement("div");
    doc.getElementById = () => app;
    globalThis.acquireVsCodeApi = () => ({ getState: () => null, setState() {}, postMessage: (m) => posted.push(m) });
    globalThis.window = { addEventListener: (_t, fn) => (listener = fn) };
    cockpitClient({ STEPS: ["explore"], STEP_LABELS: { explore: "Explore" }, CASE_TYPES: ["ui"], AUTOMATION: { ui: "playwright-ui" } }, cockpitKit(), stageStateCopy);
    listener({
      data: {
        type: "state",
        state: {
          workspace: { state: "ok" },
          env: { status: "done", rows: [{ id: "node", status: "ok", detail: "Node 24" }] },
          products: [{ product: "acme", environment: "default", status: "last run ended", active: false, config: true }],
          form: {},
          cockpit: { selected: { product: "acme", environment: "default" }, loading: false, error: null, data: { run: data.run, overview: data.overview, missing: data.missing } },
        },
      },
    });
    assert.match(app.textContent, /contacts/);
    // the cockpit's own buttons (the New product form's Create posts a draft the host checks itself)
    const before = posted.length;
    for (const b of app.findAll("button")) if (!b.disabled) b.dispatch("click");
    const sent = posted.slice(before);
    for (const t of ["openTab", "intent", "openSheet"]) assert.ok(sent.some((m) => m.type === t), `the sidebar posts ${t}: ${JSON.stringify(sent.map((m) => m.type))}`);
    for (const m of sent) assert.ok(validatePanelMessage(m).ok, `${JSON.stringify(m)}: ${validatePanelMessage(m).error}`);
  } finally {
    delete globalThis.acquireVsCodeApi;
    delete globalThis.window;
    uninstall();
  }
});
