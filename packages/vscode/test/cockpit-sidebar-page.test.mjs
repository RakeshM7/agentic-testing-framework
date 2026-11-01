// the Cockpit sidebar page's cockpit parts (src/cockpit-sidebar-page.js, docs/cockpit-plan.md C2): the new messages'
// validation, the two mirrors (stageState with runs.js, STAGES with the core's contract), and the client rendering a
// C1-shaped fixture on the fake DOM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { STAGES as CORE_STAGES } from "../../core/scripts/lib/contract.mjs";
import { cockpitKit } from "../src/cockpit-style.js";
import { INTENTS, SHEETS, STAGES, TABS, cockpitClient, renderCockpitHtml, stageStateCopy, validatePanelMessage } from "../src/cockpit-sidebar-page.js";
import { HOSTS, HOST_INFO, hostSwitchNotice } from "../src/hosts.js";
import { stageState } from "../src/runs.js";
import { install, uninstall } from "./fake-dom.mjs";

const ok = (m) => assert.equal(validatePanelMessage(m).ok, true, JSON.stringify(m));
const no = (m) => assert.equal(validatePanelMessage(m).ok, false, JSON.stringify(m));
const T = { product: "acme", environment: "default" };

test("STAGES: the page's list is the core's pipeline, in order", () => {
  assert.deepEqual(STAGES, Object.keys(CORE_STAGES));
});

test("stageState: the page's copy and runs.js agree over the same rows", () => {
  const rows = [
    {}, { status: "pending" }, { status: "running" }, { status: "running", complete: true }, { complete: true, status: "done" },
    { status: "done" }, { status: "done", complete: false, blocked: true }, { status: "failed" }, { status: "failed", blocked: true },
    { blocked: true }, { notChosen: true, status: "pending" }, { status: "not-chosen" }, { status: "awaiting-approval" },
    { awaitingApproval: true, status: "pending" }, { awaitingApproval: true, blocked: true, status: "pending" },
    { status: "pending", complete: true, notChosen: true }, { status: "awaiting-approval", complete: true },
  ];
  for (const r of rows) assert.equal(stageStateCopy(r), stageState(r), JSON.stringify(r));
});

test("validation: select and sweep take a product and an environment", () => {
  for (const type of ["select", "sweep"]) {
    ok({ type, ...T });
    no({ type, product: "acme" });
    no({ type, product: "Acme!", environment: "default" });
    no({ type, ...T, extra: 1 });
  }
});

test("validation: intent", () => {
  for (const intent of INTENTS) ok({ type: "intent", ...T, module: "contacts", intent });
  no({ type: "intent", ...T, module: "contacts", intent: "deploy" });
  no({ type: "intent", ...T, intent: "explore" });
  no({ type: "intent", ...T, module: "../x", intent: "explore" });
  no({ type: "intent", ...T, module: "a b", intent: "explore" });
});

test("validation: resume takes a known stage and a module or null", () => {
  for (const stage of STAGES) ok({ type: "resume", ...T, stage, module: null });
  ok({ type: "resume", ...T, stage: "k6", module: "deals" });
  assert.equal(validatePanelMessage({ type: "resume", ...T, stage: "report" }).message.module, null);
  no({ type: "resume", ...T, stage: "nope", module: null });
  no({ type: "resume", ...T, module: null });
  no({ type: "resume", ...T, stage: "k6", module: "Bad Module" });
  no({ type: "resume", ...T, stage: "k6", module: 5 });
});

test("validation: openSheet", () => {
  for (const sheet of SHEETS) ok({ type: "openSheet", product: "acme", module: "contacts", sheet });
  no({ type: "openSheet", product: "acme", module: "contacts", sheet: "timeline" });
  no({ type: "openSheet", product: "acme", sheet: "approval" });
  no({ type: "openSheet", product: "acme", module: "contacts", sheet: "approval", environment: "default" });
});

test("validation: openTab with an optional focus", () => {
  for (const tab of TABS) ok({ type: "openTab", ...T, tab });
  ok({ type: "openTab", ...T, tab: "timeline", focus: { stage: "k6", module: "deals" } });
  ok({ type: "openTab", ...T, tab: "timeline", focus: { stage: "report" } });
  ok({ type: "openTab", ...T, tab: "trace", focus: {} });
  no({ type: "openTab", ...T, tab: "chat" });
  no({ type: "openTab", ...T });
  no({ type: "openTab", ...T, tab: "timeline", focus: { stage: "nope" } });
  no({ type: "openTab", ...T, tab: "timeline", focus: { module: "Bad Module" } });
  no({ type: "openTab", ...T, tab: "timeline", focus: { stage: "k6", x: 1 } });
  no({ type: "openTab", ...T, tab: "timeline", focus: "k6" });
  assert.deepEqual(validatePanelMessage({ type: "openTab", ...T, tab: "timeline", focus: { stage: "k6", module: "deals" } }).message.focus, { stage: "k6", module: "deals" });
});

test("the page embeds the kit, the stage copy and the cockpit CSS", () => {
  const html = renderCockpitHtml({ nonce: "abcdefghijklmnopqrstuv" });
  assert.match(html, /--atf-accent/);
  assert.match(html, /var __name=function\(t\)\{return t\};/);
  assert.match(html, /GLYPHS/);
  assert.match(html, /"HOSTS":\["claude","copilot-chat","copilot-cli","codex","antigravity"\]/);
  assert.match(html, /Switch the AI host to/, "the notice, by source");
  assert.doesNotMatch(html, /innerHTML/);
});

// ---- the AI host picker (D-124) ----
test("setHost: only a known host, and nothing else", () => {
  for (const host of HOSTS) assert.deepEqual(validatePanelMessage({ type: "setHost", host }).message, { type: "setHost", host });
  for (const m of [{ type: "setHost" }, { type: "setHost", host: "cursor" }, { type: "setHost", host: "copilot" }, { type: "setHost", host: "codex", product: "acme" }]) no(m);
  assert.deepEqual(Object.keys(HOST_INFO), HOSTS, "every host has a label and a note");
  for (const h of HOSTS) assert.ok(HOST_INFO[h].label && HOST_INFO[h].note, h);
});

test("hostSwitchNotice: what the next session does; with a run in progress, close the old session and continue from the files", () => {
  const idle = hostSwitchNotice(HOST_INFO, "claude", "codex", []);
  assert.equal(idle.title, "Switch the AI host to OpenAI Codex?");
  assert.deepEqual(idle.lines, ["The next session (Run, Resume, an intent or the interview) opens on OpenAI Codex. A session already open stays where it is.", HOST_INFO.codex.note]);
  const busy = hostSwitchNotice(HOST_INFO, "claude", "antigravity", ["acme", "beta (staging)"]);
  assert.equal(busy.lines.length, 4);
  assert.match(busy.lines[0], /^acme, beta \(staging\) have runs in progress\. Close the Claude Code session first/);
  assert.match(busy.lines[1], /continues on Google Antigravity from the run's files: done stages stay done; a stage cut off mid-way uses one of its 2 attempts/);
  assert.match(busy.lines[2], /old chat carries over only where it was saved/);
  assert.equal(busy.lines[3], HOST_INFO.antigravity.note);
  assert.match(hostSwitchNotice(HOST_INFO, "codex", "claude", ["acme"]).lines[0], /^acme has a run in progress\. Close the OpenAI Codex session first/);
});

test("client: the AI host picker warns before it switches; Cancel sends nothing, Switch sends setHost", () => {
  const h = mount({ ...baseState(fixture), host: "claude" }, { hosts: true });
  try {
    const picker = () => h.app.findAll("select").find((s) => s.attributes["aria-label"] === "AI host");
    const banner = () => h.app.find("div.hostswitch");
    assert.deepEqual(picker().findAll("option").map(text), HOSTS.map((x) => HOST_INFO[x].label));
    assert.equal(picker().value, "claude");
    assert.equal(picker().title, HOST_INFO.claude.note);
    assert.equal(banner(), null, "no warning until another host is chosen");
    h.posted.length = 0;

    picker().value = "codex";
    picker().dispatch("change");
    assert.equal(banner().dataset.host, "codex");
    assert.match(text(banner()), /Switch the AI host to OpenAI Codex\?/);
    assert.match(text(banner()), /acme has a run in progress\. Close the Claude Code session first/, "the products' active run");
    assert.equal(picker().value, "codex");
    byText(banner(), "button", "Cancel").dispatch("click");
    assert.equal(banner(), null);
    assert.equal(picker().value, "claude");
    assert.deepEqual(h.posted, [], "Cancel sends nothing");

    picker().value = "antigravity";
    picker().dispatch("change");
    byText(banner(), "button", "Switch to Google Antigravity").dispatch("click");
    assert.deepEqual(h.posted, [{ type: "setHost", host: "antigravity" }]);
    ok(h.posted[0]);
    h.send({ ...baseState(fixture), host: "antigravity" });
    assert.equal(banner(), null, "the host now set: the warning is gone");
    assert.equal(picker().value, "antigravity");

    picker().value = "antigravity";
    picker().dispatch("change");
    assert.equal(banner(), null, "the current host: nothing to warn about");
  } finally {
    h.done();
  }
});

test("client: no AI host picker without the host's state (an older host) or without a ready project", () => {
  for (const [state, hosts] of [[baseState(fixture), true], [{ ...baseState(fixture), host: "claude" }, false], [{ ...baseState(fixture), host: "claude", workspace: { state: "noFramework", message: "x" } }, true]]) {
    const h = mount(state, { hosts });
    try {
      assert.equal(h.app.findAll("select").find((s) => s.attributes["aria-label"] === "AI host"), undefined);
    } finally {
      h.done();
    }
  }
});

// ---- the client on the fake DOM ----
const fixture = {
  selected: { product: "acme", environment: "default" },
  loading: false,
  error: null,
  data: {
    run: { runId: "run-1", mode: "readonly", active: true, createdAt: "2026-10-31T00:00:00Z", target: "https://acme.test", modules: ["contacts", "deals"], steps: [] },
    missing: [],
    overview: {
      stages: [
        { stage: "knowledge", module: null, status: "done", complete: true },
        { stage: "playwright-repo", module: null, status: "pending" },
        { stage: "explore", module: "contacts", status: "done", complete: true },
        { stage: "testcases", module: "contacts", status: "awaiting-approval", awaitingApproval: true },
        { stage: "playwright-ui", module: "contacts", status: "pending", blocked: true },
        { stage: "explore", module: "deals", status: "failed" },
        { stage: "k6", module: "deals", status: "pending", notChosen: true },
      ],
      next: [],
      needsYou: [
        { kind: "clarifications", module: "contacts", stage: null, count: 2, text: "2 clarifications are open.", ids: ["CL-contacts-1", "CL-contacts-2"] },
        { kind: "approval", module: "contacts", stage: "testcases", count: 4, text: "4 test cases await approval.", ids: ["TC-contacts-1"] },
        { kind: "failed", module: "deals", stage: "explore", count: 1, text: "Explore failed for deals.", ids: [] },
        { kind: "blocked", module: null, stage: "playwright-repo", count: 1, text: "Blocked.", ids: [] },
        { kind: "leftovers", module: null, stage: null, count: 3, text: "3 entities were left behind.", ids: [] },
        { kind: "guard", module: null, stage: null, count: 1, text: "The guard check hasn't passed.", ids: [] },
      ],
      intents: {
        contacts: {
          explore: { enabled: true, why: "" },
          testcases: { enabled: true, why: "" },
          automate: { enabled: false, why: "No approved test cases yet." },
          k6: { enabled: false, why: "k6 wasn't chosen for this run." },
          heal: { enabled: false, why: "Nothing to heal.", stage: null },
        },
        deals: {
          explore: { enabled: true, why: "" },
          testcases: { enabled: false, why: "Explore first." },
          automate: { enabled: false, why: "x" },
          k6: { enabled: false, why: "y" },
          heal: { enabled: true, why: "", stage: "playwright-ui" },
        },
      },
    },
  },
};
const baseState = (cockpit) => ({
  workspace: { state: "ok" },
  env: { status: "done", rows: [{ id: "node", status: "ok", detail: "Node 24" }] },
  products: [{ product: "acme", environment: "default", status: "run active", active: true, config: true }, { product: "beta", environment: "staging", status: "no run" }],
  form: {},
  ...(cockpit === undefined ? {} : { cockpit }),
});

// hosts: the page gets the AI host picker's data and notice, as renderCockpitHtml embeds them
function mount(state, { hosts = false } = {}) {
  const doc = install();
  const app = doc.createElement("div");
  doc.getElementById = () => app;
  const posted = [];
  let listener;
  globalThis.acquireVsCodeApi = () => ({ getState: () => null, setState() {}, postMessage: (m) => posted.push(m) });
  globalThis.window = { addEventListener: (_t, fn) => (listener = fn) };
  cockpitClient({ STEPS: ["explore"], STEP_LABELS: { explore: "Explore" }, CASE_TYPES: ["ui"], AUTOMATION: { ui: "playwright-ui" }, ...(hosts ? { HOSTS, HOST_INFO } : {}) }, cockpitKit(), stageStateCopy, hosts ? hostSwitchNotice : undefined);
  const send = (s) => listener({ data: { type: "state", state: s } });
  send(state);
  return {
    app,
    posted,
    send,
    done: () => {
      uninstall();
      delete globalThis.acquireVsCodeApi;
      delete globalThis.window;
    },
  };
}
const text = (n) => n.textContent;
const byText = (app, sel, t) => app.findAll(sel).find((n) => text(n) === t);
const envSection = (app) => app.findAll("details").find((d) => text(d.find("summary")).startsWith("Environment"));

test("client: the header, Needs you cards and their actions post the right messages", () => {
  const h = mount(baseState(fixture));
  try {
    assert.equal(h.posted[0].type, "ready");
    assert.ok(h.app.find("span.mode-readonly"));
    assert.equal(h.app.find("code.id").textContent, "run-1");
    const cards = h.app.findAll("div.needs");
    assert.deepEqual(cards.map((c) => c.dataset.kind), ["clarifications", "approval", "failed", "blocked", "leftovers", "guard"]);
    assert.deepEqual(cards[0].findAll("code.id").map(text), ["CL-contacts-1", "CL-contacts-2"]);
    for (const card of cards) card.find("button").dispatch("click");
    assert.deepEqual(h.posted.slice(1), [
      { type: "openSheet", product: "acme", module: "contacts", sheet: "clarifications" },
      { type: "openSheet", product: "acme", module: "contacts", sheet: "approval" },
      { type: "resume", product: "acme", environment: "default", stage: "explore", module: "deals" },
      { type: "resume", product: "acme", environment: "default", stage: "playwright-repo", module: null },
      { type: "sweep", product: "acme", environment: "default" },
      { type: "openTab", product: "acme", environment: "default", tab: "safety" },
    ]);
    for (const m of h.posted.slice(1)) ok(m);
  } finally {
    h.done();
  }
});

test("client: the pipeline rail and module rows carry glyphs with words; a click opens the timeline focused", () => {
  const h = mount(baseState(fixture));
  try {
    const nodes = h.app.findAll("button").filter((b) => b.className.includes("rail-node"));
    assert.deepEqual(nodes.map((n) => n.find("span.glyph").title), ["done", "pending"]);
    const rows = h.app.findAll("div.modrow");
    const contacts = rows.find((r) => r.dataset.module === "contacts");
    const deals = rows.find((r) => r.dataset.module === "deals");
    assert.deepEqual(contacts.findAll("span.glyph").map((g) => g.title), ["done", "awaiting approval", "blocked"]);
    assert.deepEqual(deals.findAll("span.glyph").map((g) => g.title), ["failed", "not chosen"]);
    h.posted.length = 0;
    contacts.findAll("button")[1].dispatch("click");
    nodes[1].dispatch("click");
    assert.deepEqual(h.posted, [
      { type: "openTab", product: "acme", environment: "default", tab: "timeline", focus: { stage: "testcases", module: "contacts" } },
      { type: "openTab", product: "acme", environment: "default", tab: "timeline", focus: { stage: "playwright-repo" } },
    ]);
    for (const m of h.posted) ok(m);
  } finally {
    h.done();
  }
});

test("client: intents, disabled ones carry why as their title, a click sends intent; the module select switches", () => {
  const h = mount(baseState(fixture));
  try {
    const intents = () => h.app.findAll("button").filter((b) => b.dataset.intent);
    assert.deepEqual(intents().map(text), ["Explore", "Write test cases", "Automate", "Load test", "Heal"]);
    const [explore, , automate, k6] = intents();
    assert.equal(automate.disabled, true);
    assert.equal(automate.title, "No approved test cases yet.");
    assert.equal(k6.title, "k6 wasn't chosen for this run.");
    assert.equal(explore.disabled, false);
    h.posted.length = 0;
    explore.dispatch("click");
    assert.deepEqual(h.posted, [{ type: "intent", product: "acme", environment: "default", module: "contacts", intent: "explore" }]);
    const select = h.app.findAll("select").find((s) => s.attributes["aria-label"] === "Module");
    select.value = "deals";
    select.dispatch("change");
    assert.equal(intents()[4].disabled, false);
    assert.equal(intents()[1].title, "Explore first.");
    h.posted.length = 0;
    intents()[4].dispatch("click");
    assert.deepEqual(h.posted, [{ type: "intent", product: "acme", environment: "default", module: "deals", intent: "heal" }]);
    ok(h.posted[0]);
  } finally {
    h.done();
  }
});

test("client: the product select sends select; Open the cockpit links send openTab; Environment is collapsed when every row is ok", () => {
  const h = mount(baseState(fixture));
  try {
    const sel = h.app.findAll("select").find((s) => s.attributes["aria-label"] === "Product");
    assert.equal(sel.value, "acme|default");
    h.posted.length = 0;
    sel.value = "beta|staging";
    sel.dispatch("change");
    assert.deepEqual(h.posted, [{ type: "select", product: "beta", environment: "staging" }]);
    h.posted.length = 0;
    const links = h.app.findAll("button").filter((b) => b.dataset.tab);
    assert.deepEqual(links.map(text), ["Timeline", "Traceability", "Failures & bug drafts", "Safety & ledger"]);
    for (const b of links) b.dispatch("click");
    assert.deepEqual(h.posted.map((m) => m.tab), ["timeline", "trace", "failures", "safety"]);
    assert.equal(envSection(h.app).open, false);
  } finally {
    h.done();
  }
});

test("client: Environment stays open when a row isn't ok", () => {
  const s = baseState(fixture);
  s.env.rows.push({ id: "k6", status: "warn", detail: "k6 missing" });
  const h = mount(s);
  try {
    assert.equal(envSection(h.app).open, true);
  } finally {
    h.done();
  }
});

test("client: no run yet shows Start run, and no Needs you, Pipeline or Intents", () => {
  const h = mount(baseState({ selected: fixture.selected, loading: false, error: null, data: { run: null, overview: { stages: [], next: [], needsYou: [], intents: {} }, missing: [{ section: "run", module: null, reason: "no run yet" }] } }));
  try {
    assert.match(text(h.app), /No run yet/);
    assert.equal(h.app.findAll("div.needs").length, 0);
    assert.equal(h.app.findAll("div.modrow").length, 0);
    assert.doesNotMatch(text(h.app), /Pipeline|Intents/);
    h.posted.length = 0;
    byText(h.app, "button", "▷ Start run").dispatch("click");
    assert.deepEqual(h.posted, [{ type: "run", product: "acme", environment: "default" }]);
  } finally {
    h.done();
  }
});

const formSection = (app) => app.findAll("details").find((d) => text(d.find("summary")).startsWith("New product"));

test("client: with a product, Cancel dismisses an opened New product form; Close dismisses its result; with none, neither is offered", () => {
  const h = mount({ ...baseState(fixture), form: { open: true } });
  try {
    assert.equal(formSection(h.app).open, true);
    h.posted.length = 0;
    byText(h.app, "button", "Cancel").dispatch("click");
    assert.deepEqual(h.posted, [{ type: "closeForm" }]);
    ok(h.posted[0]);
    assert.equal(formSection(h.app).open, false);
    h.send({ ...baseState(fixture), form: { result: { file: "config/beta.yaml", product: "beta", warnings: [], loginNeeded: false } } });
    h.posted.length = 0;
    byText(h.app, "button", "Close").dispatch("click");
    assert.deepEqual(h.posted, [{ type: "closeForm" }]);
  } finally {
    h.done();
  }
  const none = mount({ ...baseState(fixture), products: [] });
  try {
    assert.equal(formSection(none.app).open, true);
    assert.equal(byText(none.app, "button", "Cancel"), undefined);
  } finally {
    none.done();
  }
});

test("client: loading and error states; an older host (no cockpit) renders as before", () => {
  let h = mount(baseState({ selected: fixture.selected, loading: true, error: "cockpit.mjs failed", data: null }));
  try {
    assert.match(text(h.app), /Loading the run/);
    assert.match(text(h.app), /cockpit\.mjs failed/);
    assert.equal(h.app.findAll("div.needs").length, 0);
  } finally {
    h.done();
  }
  for (const c of [undefined, null]) {
    h = mount(baseState(c));
    try {
      assert.equal(h.app.find("div.hdr"), null);
      assert.doesNotMatch(text(h.app), /Pipeline|Intents|Needs you/);
      assert.equal(envSection(h.app).open, true);
      assert.ok(h.app.findAll("details").find((d) => text(d.find("summary")).startsWith("Products")));
    } finally {
      h.done();
    }
  }
});
