// The Antigravity hook registration (.agents/hooks.json): the framework's named set `atf-guard`, merged with the
// workspace's own sets (lib/hook-registrations.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import {
  ANTIGRAVITY_HOOKS,
  ANTIGRAVITY_SET,
  CLAUDE_SETTINGS,
  POST_MODES,
  formatJson,
  mergeAntigravityHooks,
  renderHookRegistrations,
} from "./lib/hook-registrations.mjs";

const FW = "node_modules/@atf/core";
const group = (entry, fw = FW) => [
  { matcher: ".*", hooks: [{ type: "command", command: `node ${fw}/scripts/hooks/${entry}.mjs --host antigravity`, timeout: 30 }] },
];
const guardSet = (mode, fw = FW) => ({
  enabled: true,
  PreToolUse: group("pretooluse", fw),
  ...(mode !== "off" ? { PostToolUse: group("posttooluse", fw) } : {}),
});
const render = (mode, text, fw = FW) => renderHookRegistrations(mode, undefined, fw, { antigravityHooks: text }).get(ANTIGRAVITY_HOOKS);
const parse = (text) => JSON.parse(text);
const clientSet = { enabled: true, PreToolUse: [{ matcher: "run_command", hooks: [{ type: "command", command: "./lint.sh", timeout: 5 }] }] };
const thrown = (fn) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  assert.fail("expected an error");
};

test("a fresh render is exactly the atf-guard set, for every mode and every empty input", () => {
  for (const mode of POST_MODES)
    for (const text of [undefined, "", "  \n", "{}"]) {
      const out = render(mode, text);
      assert.deepEqual(parse(out), { [ANTIGRAVITY_SET]: guardSet(mode) }, `${mode} ${JSON.stringify(text)}`);
      assert.equal(out, formatJson({ [ANTIGRAVITY_SET]: guardSet(mode) }) + "\n");
    }
});

test("the commands expand {fw} and name the antigravity host; matcher .*, timeout 30 s, enabled", () => {
  const set = parse(render("sync", undefined))[ANTIGRAVITY_SET];
  assert.equal(set.enabled, true);
  for (const [event, entry] of [["PreToolUse", "pretooluse"], ["PostToolUse", "posttooluse"]]) {
    assert.equal(set[event].length, 1);
    assert.equal(set[event][0].matcher, ".*");
    assert.deepEqual(set[event][0].hooks, [
      { type: "command", command: `node ${FW}/scripts/hooks/${entry}.mjs --host antigravity`, timeout: 30 },
    ]);
  }
  // the framework's own repository: no {fw} prefix
  const own = parse(render("sync", undefined, ""))[ANTIGRAVITY_SET];
  assert.equal(own.PreToolUse[0].hooks[0].command, "node scripts/hooks/pretooluse.mjs --host antigravity");
  assert.ok(!JSON.stringify(own).includes("{fw}"));
});

test("async renders as sync (no background hooks); off has no PostToolUse", () => {
  assert.equal(render("async", undefined), render("sync", undefined));
  const off = parse(render("off", undefined))[ANTIGRAVITY_SET];
  assert.ok(!("PostToolUse" in off));
  assert.deepEqual(off.PreToolUse, group("pretooluse"));
});

test("the client's sets are kept as they are, in their order, after atf-guard", () => {
  const current = { "lint-first": clientSet, audit: { enabled: false, PostToolUse: [] } };
  const merged = parse(render("async", JSON.stringify(current)));
  assert.deepEqual(Object.keys(merged), [ANTIGRAVITY_SET, "lint-first", "audit"]);
  assert.deepEqual(merged["lint-first"], clientSet);
  assert.deepEqual(merged.audit, { enabled: false, PostToolUse: [] });
});

test("a client set named __proto__ is kept as an own key, never as the prototype", () => {
  const text = `{ "__proto__": { "enabled": true, "PreToolUse": [] }, "other": { "enabled": true } }`;
  const merged = mergeAntigravityHooks(JSON.parse(text), "sync", FW);
  assert.deepEqual(Object.keys(merged), [ANTIGRAVITY_SET, "__proto__", "other"]);
  assert.ok(Object.prototype.hasOwnProperty.call(merged, "__proto__"));
  assert.equal(Object.getPrototypeOf(merged), Object.prototype);
  const out = render("sync", text);
  assert.ok(out.includes('"__proto__"'));
  assert.deepEqual(Object.keys(JSON.parse(out)), [ANTIGRAVITY_SET, "__proto__", "other"]);
});

test("a stale atf-guard is replaced whole and moved first", () => {
  const stale = [
    { enabled: true, PreToolUse: group("pretooluse", "old/fw/path"), PostToolUse: group("posttooluse", "old/fw/path") },
    { ...guardSet("sync"), extra: "kept? no", enabled: false },
    "not even an object",
    null,
    [],
  ];
  for (const value of stale) {
    const current = { mine: clientSet, [ANTIGRAVITY_SET]: value };
    const merged = parse(render("sync", JSON.stringify(current)));
    assert.deepEqual(Object.keys(merged), [ANTIGRAVITY_SET, "mine"], JSON.stringify(value));
    assert.deepEqual(merged[ANTIGRAVITY_SET], guardSet("sync"));
    assert.deepEqual(merged.mine, clientSet);
  }
  // a mode change replaces it too
  const fromSync = render("sync", undefined);
  assert.deepEqual(parse(render("off", fromSync)), { [ANTIGRAVITY_SET]: guardSet("off") });
});

test("a file or set the merge can't handle is an error naming the file; nothing is rendered", () => {
  const cases = [
    ["{ not json", /not valid JSON/],
    ["[]", /must be a JSON object .* not a list/],
    ['"x"', /must be a JSON object .* not a string/],
    ["null", /must be a JSON object .* not null/],
    ["3", /must be a JSON object .* not a number/],
    [JSON.stringify({ mine: "on" }), /set 'mine' must be an object, not a string/],
    [JSON.stringify({ mine: [clientSet] }), /set 'mine' must be an object, not a list/],
    [JSON.stringify({ mine: null }), /set 'mine' must be an object, not null/],
  ];
  for (const [text, message] of cases) {
    const e = thrown(() => render("async", text));
    assert.match(e.message, message, text);
    assert.match(e.message, /nothing was written/, text);
    assert.equal(e.file, ANTIGRAVITY_HOOKS, text);
  }
});

test("an unchanged file comes back byte for byte, whatever its formatting", () => {
  for (const mode of POST_MODES) {
    const sets = { [ANTIGRAVITY_SET]: guardSet(mode), mine: clientSet };
    for (const text of [JSON.stringify(sets), JSON.stringify(sets, null, 4) + "\n\n", formatJson(sets) + "\n"])
      assert.equal(render(mode, text), text, `${mode} ${JSON.stringify(text.slice(0, 20))}`);
  }
  // the build's own output is stable
  const once = render("async", JSON.stringify({ mine: clientSet }));
  assert.equal(render("async", once), once);
});

test("a guard moved down is drift, even when the sets are equal as JSON", () => {
  const moved = JSON.stringify({ mine: clientSet, [ANTIGRAVITY_SET]: guardSet("sync") });
  const out = render("sync", moved);
  assert.notEqual(out, moved);
  assert.deepEqual(Object.keys(parse(out)), [ANTIGRAVITY_SET, "mine"]);
});

test("the guard is always present: first set, enabled, PreToolUse as rendered, for every mode", () => {
  const inputs = [undefined, JSON.stringify({ mine: clientSet }), JSON.stringify({ mine: clientSet, [ANTIGRAVITY_SET]: { enabled: false } })];
  for (const mode of POST_MODES)
    for (const text of inputs) {
      const sets = parse(render(mode, text));
      assert.equal(Object.keys(sets)[0], ANTIGRAVITY_SET);
      assert.equal(sets[ANTIGRAVITY_SET].enabled, true);
      assert.deepEqual(sets[ANTIGRAVITY_SET].PreToolUse[0], group("pretooluse")[0]);
    }
});

test("mergeAntigravityHooks takes the parsed file (or undefined)", () => {
  assert.deepEqual(mergeAntigravityHooks(undefined, "off", FW), { [ANTIGRAVITY_SET]: guardSet("off") });
  assert.throws(() => mergeAntigravityHooks([], "off", FW), /must be a JSON object/);
});

test("the three-argument call still renders every host file, Antigravity's fresh", () => {
  const files = renderHookRegistrations("async", undefined, FW);
  assert.deepEqual(
    [...files.keys()],
    [CLAUDE_SETTINGS, ".github/hooks/framework-guard.json", ".vscode/hooks/framework-guard.json", ANTIGRAVITY_HOOKS],
  );
  assert.equal(files.get(ANTIGRAVITY_HOOKS), render("async", undefined));
});

test("a .claude/settings.json error names that file, its message unchanged", () => {
  const e = thrown(() => renderHookRegistrations("async", "[]", FW, { antigravityHooks: "[]" }));
  assert.equal(e.file, CLAUDE_SETTINGS);
  assert.equal(e.message, "must be a JSON object, not a list; fix it, nothing was written");
  const bad = thrown(() => renderHookRegistrations("async", "{ nope", FW));
  assert.equal(bad.file, CLAUDE_SETTINGS);
});
