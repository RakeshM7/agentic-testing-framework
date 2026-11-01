// the Cockpit's style and DOM kit (src/cockpit-style.js), against the fake DOM (test/fake-dom.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { COCKPIT_CSS, cockpitKit } from "../src/cockpit-style.js";
import { install, uninstall } from "./fake-dom.mjs";

let K;
before(() => {
  install();
  K = cockpitKit();
});
after(() => uninstall());

const GLYPHS = { done: ["●", "done"], running: ["◐", "running"], pending: ["○", "pending"], "awaiting-approval": ["◆", "awaiting approval"], blocked: ["⊘", "blocked"], failed: ["✗", "failed"], "not-chosen": ["·", "not chosen"], unverified: ["?", "unverified"] };

test("el: props, text as text, events, dataset, aria; null kids skipped", () => {
  let clicked = 0;
  const n = K.el("div", { class: "a b", text: "x", title: "t", dataset: { k: "v" }, aria: { label: "L" }, on: { click: () => clicked++ } }, null, false, "kid", [K.el("i")]);
  assert.equal(n.className, "a b");
  assert.equal(n.title, "t");
  assert.equal(n.dataset.k, "v");
  assert.equal(n.getAttribute("aria-label"), "L");
  assert.equal(n.children.length, 2);
  assert.equal(n.children[0].textContent, "kid");
  n.dispatch("click");
  assert.equal(clicked, 1);
  const i = K.el("input", { type: "checkbox", checked: true, disabled: true, name: "n", placeholder: "p", value: "v" });
  assert.deepEqual([i.type, i.checked, i.disabled, i.name, i.placeholder, i.value], ["checkbox", true, true, "n", "p", "v"]);
});

test("text never becomes HTML", () => {
  const evil = '<b>x</b><img src=x onerror="alert(1)">';
  const n = K.el("div", { text: evil }, evil);
  assert.equal(n.innerHTML, undefined);
  assert.equal(n.children.length, 1);
  assert.equal(n.children[0].textContent, evil);
  const chip = K.idChip(evil);
  assert.equal(chip.textContent, evil);
  assert.equal(chip.descendants().length, 0);
  const t = K.table([{ key: "a", label: evil }], [{ a: evil }]);
  assert.equal(t.find("th").textContent, evil);
  assert.equal(t.find("td").textContent, evil);
  assert.equal(K.empty(evil).textContent, evil);
});

test("btn: a button with text, class, click and extras", () => {
  let n = 0;
  const b = K.btn("Go", () => n++, "secondary", { disabled: true, title: "tip" });
  assert.equal(b.localName, "button");
  assert.equal(b.textContent, "Go");
  assert.equal(b.className, "secondary");
  assert.equal(b.disabled, true);
  assert.equal(b.title, "tip");
  b.dispatch("click");
  assert.equal(n, 1);
  assert.equal(K.btn("x").className, "");
});

test("glyph: symbol, class, title and aria-label for every state", () => {
  for (const [state, [sym, text]] of Object.entries(GLYPHS)) {
    const g = K.glyph(state);
    assert.equal(g.localName, "span");
    assert.equal(g.className, `glyph g-${state}`);
    assert.equal(g.textContent, sym);
    assert.equal(g.title, text);
    assert.equal(g.getAttribute("aria-label"), text);
  }
  const u = K.glyph("nonsense");
  assert.equal(u.className, "glyph g-unverified");
  assert.equal(u.getAttribute("aria-label"), "unverified");
});

test("idChip and modeBadge", () => {
  const c = K.idChip("TC-001");
  assert.equal(c.localName, "code");
  assert.equal(c.className, "id");
  assert.equal(c.textContent, "TC-001");
  const r = K.modeBadge("readonly");
  assert.equal(r.className, "mode mode-readonly");
  assert.equal(r.textContent, "readonly");
  const f = K.modeBadge("full-run");
  assert.equal(f.className, "mode mode-full-run");
  assert.equal(f.textContent, "full-run");
  assert.equal(K.modeBadge(undefined).className, "mode mode-readonly");
});

test("rail: nodes, solid through the last done node, dashed after, clicks", () => {
  const clicks = [];
  const r = K.rail([
    { label: "Explore", state: "done" },
    { label: "Clarify", state: "pending" },
    { label: "Cases", state: "done", onClick: () => clicks.push("cases") },
    { label: "Automate", state: "running" },
    { label: "Report", state: "not-chosen" },
  ]);
  assert.equal(r.className, "rail");
  const nodes = r.children;
  assert.equal(nodes.length, 5);
  assert.deepEqual(nodes.map((n) => n.className.includes("solid")), [true, true, true, false, false]);
  assert.ok(nodes.every((n) => n.className.startsWith("rail-node state-")));
  assert.equal(nodes[2].localName, "button");
  assert.equal(nodes[0].localName, "div");
  assert.equal(nodes[0].find("span.label").textContent, "Explore");
  assert.equal(nodes[0].find("span.glyph").getAttribute("aria-label"), "done");
  nodes[2].dispatch("click");
  assert.deepEqual(clicks, ["cases"]);
  assert.equal(K.rail([{ label: "a", state: "pending" }]).children[0].className.includes("solid"), false);
  assert.equal(K.rail([]).children.length, 0);
});

test("table: header, rows, default and custom cells", () => {
  const cols = [{ key: "id", label: "ID" }, { key: "n", label: "Count" }];
  const t = K.table(cols, [{ id: "TC-1", n: 3 }, { id: "TC-2" }]);
  assert.equal(t.className, "grid");
  assert.deepEqual(t.findAll("th").map((x) => x.textContent), ["ID", "Count"]);
  assert.deepEqual(t.findAll("td").map((x) => x.textContent), ["TC-1", "3", "TC-2", ""]);
  const t2 = K.table(cols, [{ id: "TC-1", n: 3 }], (row, key) => (key === "id" ? K.idChip(row.id) : `n=${row.n}`));
  assert.equal(t2.find("td").find("code.id").textContent, "TC-1");
  assert.equal(t2.findAll("td")[1].textContent, "n=3");
  assert.equal(K.table(cols, []).findAll("td").length, 0);
});

test("empty", () => {
  const e = K.empty("Nothing here");
  assert.equal(e.className, "empty");
  assert.equal(e.textContent, "Nothing here");
});

test("dur formats durations", () => {
  assert.equal(K.dur(850), "850 ms");
  assert.equal(K.dur(0), "0 ms");
  assert.equal(K.dur(12000), "12s");
  assert.equal(K.dur(192000), "3m 12s");
  assert.equal(K.dur(3900000), "1h 5m");
  for (const bad of [undefined, null, NaN, -1, "5", Infinity]) assert.equal(K.dur(bad), "—");
});

test("cockpitKit is self-contained: evals alone with only the fake document", () => {
  const f = new Function(`return (${cockpitKit.toString()})()`);
  const kit = f();
  assert.deepEqual(Object.keys(kit).sort(), ["btn", "dur", "el", "empty", "glyph", "idChip", "modeBadge", "rail", "table"]);
  assert.equal(kit.glyph("failed").getAttribute("aria-label"), "failed");
  assert.equal(kit.dur(192000), "3m 12s");
  // and the embedded form works too
  assert.equal(new Function(`return (${"(" + cockpitKit + ")()"})`)().idChip("X").textContent, "X");
});

test("COCKPIT_CSS has the C4 classes, glyph states, accent and the high-contrast rule", () => {
  for (const c of ["rail", "rail-node", "card", "needs", "mode", "glyph", "id", "tabs", "tab", "grid", "empty", "muted", "toolbar", "chip", "section-title"]) assert.match(COCKPIT_CSS, new RegExp(`\\.${c}\\b`), `.${c}`);
  assert.match(COCKPIT_CSS, /\.tab\.active/);
  for (const s of Object.keys(GLYPHS)) assert.ok(COCKPIT_CSS.includes(`.g-${s}`), `.g-${s}`);
  assert.ok(COCKPIT_CSS.includes("--atf-accent:color-mix(in srgb,#2fd1a8 70%,var(--vscode-foreground))"));
  assert.ok(COCKPIT_CSS.includes("body.vscode-high-contrast"));
  assert.ok(COCKPIT_CSS.includes(".mode-readonly") && COCKPIT_CSS.includes(".mode-full-run"));
  assert.ok(COCKPIT_CSS.includes("var(--vscode-editor-font-family"));
  assert.match(COCKPIT_CSS, /position:sticky/);
  assert.ok(!/[`$]\{/.test(COCKPIT_CSS), "no template leftovers");
});
