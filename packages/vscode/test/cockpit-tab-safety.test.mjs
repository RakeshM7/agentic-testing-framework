// the Cockpit's Safety & ledger tab (src/cockpit-tabs/safety.js, W7d) against the fake DOM, with a C1-shaped fixture.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { cockpitKit } from "../src/cockpit-style.js";
import { renderSafety } from "../src/cockpit-tabs/safety.js";
import { install, uninstall } from "./fake-dom.mjs";

let K;
before(() => {
  install();
  K = cockpitKit();
});
after(() => uninstall());

const entry = (over) => ({ ts: "2026-10-01T09:00:00.000Z", event: "create", type: "project", ref: "proj-1", label: null, module: "deals", stage: "k6", agent: "k6-script-writer", live: true, ...over });

function fixture(over = {}) {
  const base = {
    schemaVersion: 1,
    product: "acme",
    environment: "default",
    generatedAt: "2026-10-01T09:30:00.000Z",
    run: { runId: "acme-run-1", mode: "full-run", active: false, createdAt: "2026-10-01T09:00:00.000Z", target: "https://acme.test", modules: ["deals"], steps: ["k6"] },
    overview: { stages: [], next: [], needsYou: [], intents: {} },
    timeline: { stages: [], totals: { durationMs: 0, spawns: 0 }, history: [] },
    trace: { modules: [] },
    failures: { byClass: {}, clusters: [], healable: [], unverified: [] },
    safety: {
      mode: "full-run",
      explanation: "Mutating tests ran; deletes were limited to entities this run created.",
      ledger: {
        file: "artifacts/acme/state/ledger.jsonl",
        entries: [
          entry({ ref: "proj-1", label: "Smoke project", live: true }),
          entry({ ts: "2026-10-01T09:05:00.000Z", event: "create", type: "deal", ref: "deal-7", live: false, agent: "k6-runner-triager" }),
          entry({ ts: "2026-10-01T09:06:00.000Z", event: "cleanup", type: "deal", ref: "deal-8", live: false, agent: "k6-runner-triager" }),
        ],
        live: 1,
        cleaned: 2,
      },
      customConfig: {
        permissions: { source: "overlay", files: ["permissions.yaml", "atf/permissions.yaml"] },
        other: [{ name: "models.yaml", source: "ejected", files: ["atf/config/models.yaml"] }],
      },
      frameworkIssues: 3,
    },
    missing: [],
  };
  return { ...base, ...over, safety: { ...base.safety, ...(over.safety || {}) } };
}

// a tbody's data rows (the fake DOM has no `tbody > tr` selector)
const rowsOf = (root) => root.find("tbody").children.filter((c) => c.localName === "tr");
const textOf = (root) => root.textContent;
// the flagged permissions notice (the sweep card is also .needs, so match on its words)
const flagged = (root) => root.findAll(".needs").filter((n) => n.textContent.includes("Custom safety config"));

test("renders the mode badge, the explanation, the ledger and the framework config", () => {
  const data = fixture();
  const root = renderSafety(data, {}, K, () => {});
  assert.equal(root.localName, "div");
  assert.ok(root.find(".mode-full-run"), "the mode badge");
  assert.ok(textOf(root).includes(data.safety.explanation));
  const table = root.find("table");
  assert.ok(table, "the ledger table");
  const headers = table.find("thead").descendants().filter((c) => c.localName === "th").map((c) => c.textContent);
  assert.deepEqual(headers, ["time", "event", "type", "ref / label", "module", "stage", "agent", "live / cleaned"]);
  assert.equal(rowsOf(root).length, 3);
  const first = rowsOf(root)[0].textContent;
  assert.ok(first.includes("proj-1") && first.includes("Smoke project") && first.includes("k6-script-writer") && first.includes("live"));
  assert.ok(textOf(root).includes("cleaned"));
  assert.ok(textOf(root).includes("3 framework issues"));
  assert.ok(textOf(root).includes("models.yaml"));
});

test("the permissions config comes first and is flagged", () => {
  const root = renderSafety(fixture(), {}, K, () => {});
  const text = textOf(root);
  const perms = text.indexOf("permissions.yaml");
  const models = text.indexOf("models.yaml");
  assert.ok(perms >= 0 && models > perms, "permissions before the other files");
  assert.equal(flagged(root).length, 1, "the permissions notice is flagged");
  assert.ok(text.includes("the framework's permissions.yaml overlaid by atf/permissions.yaml"));
});

test("a framework's own permissions copy is not flagged", () => {
  const data = fixture({ safety: { customConfig: { permissions: null, other: [] } } });
  const root = renderSafety(data, {}, K, () => {});
  assert.equal(flagged(root).length, 0);
  assert.ok(textOf(root).includes("the framework's own copy"));
});

test("the live-only filter re-renders the table with live entries only", () => {
  const root = renderSafety(fixture(), {}, K, () => {});
  const box = root.find("input");
  assert.equal(box.type, "checkbox");
  assert.equal(box.checked, false);
  assert.equal(rowsOf(root).length, 3);
  box.checked = true;
  box.dispatch("change");
  const rows = rowsOf(root);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes("proj-1"));
  // and back: all entries again
  box.checked = false;
  box.dispatch("change");
  assert.equal(rowsOf(root).length, 3);
});

test("the live-only filter shows an empty note when nothing is live", () => {
  const data = fixture({ safety: { ledger: { file: null, entries: [entry({ live: false })], live: 0, cleaned: 1 } } });
  const root = renderSafety(data, {}, K, () => {});
  const box = root.find("input");
  box.checked = true;
  box.dispatch("change");
  assert.equal(root.find("tbody"), null, "no rows, so no table body");
  assert.equal(root.find(".empty").textContent, "No live entities");
});

test("the sweep button shows only when live > 0 and the run is not active, and posts sweep", () => {
  const posted = [];
  const root = renderSafety(fixture(), {}, K, (m) => posted.push(m));
  assert.ok(textOf(root).includes("1 entities this run created are still live"));
  const button = root.findAll("button").find((b) => b.textContent === "Sweep leftovers…");
  assert.ok(button, "the sweep button");
  button.dispatch("click");
  assert.deepEqual(posted, [{ type: "sweep" }]);
});

test("no sweep button while the run is active", () => {
  const data = fixture({ run: { ...fixture().run, active: true } });
  const root = renderSafety(data, {}, K, () => {});
  assert.equal(root.findAll("button").find((b) => b.textContent === "Sweep leftovers…"), undefined);
  assert.ok(!textOf(root).includes("still live"));
});

test("no sweep button when nothing is live", () => {
  const data = fixture({ safety: { ledger: { file: null, entries: [], live: 0, cleaned: 4 } } });
  const root = renderSafety(data, {}, K, () => {});
  assert.equal(root.findAll("button").find((b) => b.textContent === "Sweep leftovers…"), undefined);
  assert.ok(!textOf(root).includes("still live"));
});

test("missing items for the safety section show as muted notes; others do not", () => {
  const data = fixture({ missing: [{ section: "safety", module: null, reason: "no provenance recorded" }, { section: "trace", module: "deals", reason: "x" }] });
  const root = renderSafety(data, {}, K, () => {});
  const notes = root.findAll(".muted").map((n) => n.textContent);
  assert.ok(notes.includes("not available: no provenance recorded"));
  assert.ok(!textOf(root).includes("not available: x"));
});

test("no run yet: the empty state, nothing else", () => {
  const root = renderSafety({ ...fixture(), run: null, missing: [{ section: "run", module: null, reason: "no run yet" }] }, {}, K, () => {});
  assert.equal(root.find(".empty").textContent, "No run yet");
  assert.equal(root.find("table"), null);
  assert.equal(root.findAll("button").length, 0);
});

test("no run yet, with a run-config: the planned mode, its file and the framework config, marked as before the first run", () => {
  const safety = { mode: "full-run", planned: true, configFile: "config/acme.yaml", explanation: "Before the first run: config/acme.yaml sets this mode.", ledger: { entries: [] }, customConfig: { permissions: { source: "overlay", files: ["config/permissions.yaml", "atf/permissions.yaml"] }, other: [] }, frameworkIssues: 0 };
  const root = renderSafety({ ...fixture(), run: null, safety, missing: [{ section: "run", module: null, reason: "no run yet" }] }, {}, K, () => {});
  const text = textOf(root);
  assert.equal(root.find(".empty").textContent, "No run yet");
  assert.ok(text.includes("Safety mode (before the first run)"));
  assert.ok(text.includes("full-run"));
  assert.ok(text.includes("from config/acme.yaml"));
  assert.equal(flagged(root).length, 1);
  assert.equal(root.find("table"), null);
  assert.equal(root.findAll("button").length, 0);
});

test("a missing customConfig is said, not guessed", () => {
  const root = renderSafety(fixture({ safety: { customConfig: null } }), {}, K, () => {});
  assert.ok(textOf(root).includes("not recorded for this run"));
  assert.equal(flagged(root).length, 0);
});

test("embedded by source: the function has no references outside its body", () => {
  const factory = new Function("return (" + renderSafety.toString() + ")")();
  assert.equal(typeof factory, "function");
  const posted = [];
  const root = factory(fixture(), {}, K, (m) => posted.push(m));
  assert.ok(root.find("table"));
  assert.equal(typeof root.textContent, "string");
});
