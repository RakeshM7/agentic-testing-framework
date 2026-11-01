import test from "node:test";
import assert from "node:assert/strict";
import { install, uninstall } from "./fake-dom.mjs";
import { cockpitKit } from "../src/cockpit-style.js";
import { renderTimeline } from "../src/cockpit-tabs/timeline.js";

const fixture = () => ({
  schemaVersion: 1, product: "acme", environment: "default", generatedAt: "2026-01-01T00:00:00Z",
  run: { runId: "r2", mode: "readonly", active: true, createdAt: "2026-01-01", target: "https://x", modules: ["login"], steps: [] },
  overview: { stages: [], next: [], needsYou: [], intents: {} },
  timeline: {
    stages: [
      { key: "knowledge", stage: "knowledge", module: null, status: "done", attempts: 1, startedAt: null, finishedAt: null, durationMs: 192000, error: null, reviewFailed: false, findings: [], steps: [{ name: "pass", status: "done", at: "t", durationMs: 5 }] },
      { key: "login:playwright-ui", stage: "playwright-ui", module: "login", status: "failed", attempts: 2, startedAt: null, finishedAt: null, durationMs: 850, error: "boom <b>x</b>", reviewFailed: true, findings: ["weak assertion"], steps: [] },
      { key: "login:k6", stage: "k6", module: "login", status: "pending", attempts: 0, startedAt: null, finishedAt: null, durationMs: null, error: null, reviewFailed: false, findings: [], steps: [] },
    ],
    totals: { durationMs: 200000, spawns: 7 },
    history: [{ runId: "r1", outcome: "done", createdAt: "a", endedAt: "b", report: "artifacts/acme/report/index.html" }, { runId: "r0", outcome: "aborted", createdAt: "a", endedAt: "b", report: null }],
  },
  missing: [{ section: "timeline", module: null, reason: "telemetry absent" }, { section: "trace", module: null, reason: "other" }],
});

const setup = () => { install(); return cockpitKit(); };
const buttons = (n, label) => n.findAll("button").filter((b) => b.textContent === label);

test("renders totals, lanes, stages, notes and only relevant missing", () => {
  const kit = setup();
  try {
    const posts = [];
    const root = renderTimeline(fixture(), {}, kit, (m) => posts.push(m));
    const t = root.textContent;
    assert.match(t, /total 3m 20s/);
    assert.match(t, /7 spawns/);
    assert.match(t, /Product/);
    assert.match(t, /Module login/);
    assert.match(t, /×2/);
    assert.match(t, /not available: telemetry absent/);
    assert.doesNotMatch(t, /other/);
    assert.match(t, /boom <b>x<\/b>/);
    assert.equal(root.findAll("b").length, 0);
    assert.equal(posts.length, 0);
  } finally { uninstall(); }
});

test("Resume posts the stage and module (null for product level)", () => {
  const kit = setup();
  try {
    const posts = [];
    const root = renderTimeline(fixture(), {}, kit, (m) => posts.push(m));
    const resumes = buttons(root, "Resume");
    assert.equal(resumes.length, 2); // failed + pending, not the done one
    resumes[0].dispatch("click");
    resumes[1].dispatch("click");
    assert.deepEqual(posts, [{ type: "resume", stage: "playwright-ui", module: "login" }, { type: "resume", stage: "k6", module: "login" }]);
  } finally { uninstall(); }
});

test("focus highlights the stage", () => {
  const kit = setup();
  try {
    const root = renderTimeline(fixture(), { focus: { stage: "k6", module: "login" } }, kit, () => {});
    const hot = root.findAll("div").filter((n) => n.dataset.focus === "true");
    assert.equal(hot.length, 1);
    assert.equal(hot[0].dataset.stage, "k6");
    assert.ok(hot[0].className.includes("needs"));
  } finally { uninstall(); }
});

test("attention filter hides healthy stages", () => {
  const kit = setup();
  try {
    const root = renderTimeline(fixture(), {}, kit, () => {});
    assert.equal(root.findAll("div").filter((n) => n.dataset.stage === "knowledge").length, 1);
    buttons(root, "Needs attention only")[0].dispatch("click");
    assert.equal(root.findAll("div").filter((n) => n.dataset.stage === "knowledge").length, 0);
    assert.equal(root.findAll("div").filter((n) => n.dataset.stage === "playwright-ui").length, 1);
  } finally { uninstall(); }
});

test("history Open report posts openReport; none without a report", () => {
  const kit = setup();
  try {
    const posts = [];
    const root = renderTimeline(fixture(), {}, kit, (m) => posts.push(m));
    const open = buttons(root, "Open report");
    assert.equal(open.length, 1);
    open[0].dispatch("click");
    assert.deepEqual(posts, [{ type: "openReport", runId: "r1" }]);
  } finally { uninstall(); }
});

test("no run: empty state with the run note", () => {
  const kit = setup();
  try {
    const root = renderTimeline({ run: null, timeline: { stages: [], totals: null, history: [] }, missing: [{ section: "run", module: null, reason: "no run yet" }] }, {}, kit, () => {});
    assert.ok(root.find("div.empty"));
    assert.match(root.textContent, /not available: no run yet/);
    assert.equal(renderTimeline(undefined, undefined, kit, () => {}).find("div.empty") !== null, true);
  } finally { uninstall(); }
});

test("is self-contained", () => {
  const kit = setup();
  try {
    const fn = new Function("return (" + renderTimeline.toString() + ")")();
    const root = fn(fixture(), {}, kit, () => {});
    assert.match(root.textContent, /Run history/);
  } finally { uninstall(); }
});
