// The one config loader (scripts/lib/config.mjs, docs/packaging.md §3.4): a workspace ejects a framework config file
// (atf/config/<name>) or overlays it (atf/<name>), and every reader gets the same effective result. Each test builds a
// scratch framework (a copy of the real config/ and agents/) and a scratch workspace beside it.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import yaml from "js-yaml";
import { build } from "./build-agents.mjs";
import { networkGuarded } from "./lib/browser-tools.mjs";
import { CONFIG_FILES, HOOKS_KEYS, checkHooks, configPath, configSource, configSources, configText, loadConfig, mergeConfig } from "./lib/config.mjs";
import { POST_MODES } from "./lib/hook-registrations.mjs";
import { paths } from "./lib/contract.mjs";
import { frameworkRoot } from "./lib/roots.mjs";
import { initRun } from "./run.mjs";
import { writeConfig } from "./test-helpers.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const real = (p) => realpathSync.native(p);
function framework() {
  const fw = real(mkdtempSync(path.join(tmpdir(), "atf-fw-")));
  for (const d of ["config", "agents"]) cpSync(path.join(frameworkRoot, d), path.join(fw, d), { recursive: true });
  return fw;
}
function workspace() {
  const ws = real(mkdtempSync(path.join(tmpdir(), "atf-ws-")));
  mkdirSync(path.join(ws, "atf", "config"), { recursive: true });
  writeFileSync(path.join(ws, "atf", "atf.json"), "{}\n");
  mkdirSync(path.join(ws, "config"));
  return ws;
}
const put = (root, rel, text) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};
// a recorded source path: `/` on every OS (Windows included)
const slashed = (p) => p.replaceAll("\\", "/");
const fwText = (fw, name) => readFileSync(path.join(fw, "config", name), "utf8");

test("the overlay rule: a map merges key by key, a list replaces, null deletes; nothing is changed in place", () => {
  const base = { a: { x: 1, y: [1, 2], z: { deep: true, keep: 1 } }, b: [1, 2, 3], c: "c", d: 4 };
  const before = structuredClone(base);
  const over = { a: { y: [9], z: { deep: null }, w: { n: null, m: 1 } }, b: [], c: null, e: { f: 1 } };
  assert.deepEqual(mergeConfig(base, over), { a: { x: 1, y: [9], z: { keep: 1 }, w: { m: 1 } }, b: [], d: 4, e: { f: 1 } });
  assert.deepEqual(base, before, "the base is not mutated");
  assert.deepEqual(mergeConfig({ a: [1] }, { a: { b: 1 } }), { a: { b: 1 } }, "a map over a list replaces it");
  assert.deepEqual(mergeConfig({ a: { b: 1 } }, { a: "x" }), { a: "x" }, "a scalar over a map replaces it");
  const polluted = mergeConfig({}, yaml.load("__proto__: {admin: true}\n"));
  assert.equal({}.admin, undefined, "a __proto__ key is data, never a prototype");
  assert.deepEqual(Object.keys(polluted), ["__proto__"]);
});

test("no atf/ override: the framework's own copy, byte for byte, for every file and every reader", () => {
  const fw = framework();
  const ws = workspace();
  for (const name of CONFIG_FILES) {
    const opts = { framework: fw, workspace: ws };
    assert.equal(configText(name, opts), fwText(fw, name), name);
    assert.deepEqual(loadConfig(name, opts), yaml.load(fwText(fw, name)), name);
    assert.equal(configPath(name, opts), path.join(fw, "config", name));
    assert.deepEqual(configSource(name, opts), { name, source: "framework", files: [slashed(path.join(fw, "config", name))], digest: sha(fwText(fw, name)) }, "the framework, outside the workspace: absolute");
  }
  // this process's own roots (the monorepo, or one directory): today's text
  assert.equal(configText("models.yaml"), readFileSync(path.join(frameworkRoot, "config", "models.yaml"), "utf8"));
  // one directory that is both: an atf/ inside it is never an override
  put(fw, "atf/models.yaml", "default: {claude: haiku}\n");
  put(fw, "atf/config/mcp.yaml", "browser_server: none\n");
  assert.equal(configText("models.yaml", { framework: fw, workspace: fw }), fwText(fw, "models.yaml"));
  assert.equal(configSource("mcp.yaml", { framework: fw, workspace: fw }).source, "framework");
  assert.deepEqual(configSource("mcp.yaml", { framework: fw, workspace: fw }).files, ["config/mcp.yaml"], "inside the workspace: relative");
  assert.throws(() => configText("acme.yaml", { framework: fw, workspace: ws }), /not a framework config file/);
});

test("an overlay is merged over the framework's copy; its text is a dump under a header naming both files", () => {
  const fw = framework();
  const ws = workspace();
  const opts = { framework: fw, workspace: ws };
  put(ws, "atf/models.yaml", "default:\n  claude: claude-sonnet-5\nagents:\n  report-generator: {claude: haiku}\n");
  const models = loadConfig("models.yaml", opts);
  assert.equal(models.default.claude, "claude-sonnet-5");
  assert.equal(models.default.copilot, yaml.load(fwText(fw, "models.yaml")).default.copilot, "the keys it doesn't name stay the framework's");
  assert.deepEqual(models.agents, { "report-generator": { claude: "haiku" } });
  const text = configText("models.yaml", opts);
  assert.match(text.split("\n")[0], /^# Effective models\.yaml: .*config\/models\.yaml, overlaid by atf\/models\.yaml/);
  assert.deepEqual(yaml.load(text), models, "the text is the object");
  const src = configSource("models.yaml", opts);
  assert.deepEqual(src, { name: "models.yaml", source: "overlay", files: [slashed(path.join(fw, "config", "models.yaml")), "atf/models.yaml"], digest: sha(text) });
  assert.equal(configPath("models.yaml", opts), path.join(fw, "config", "models.yaml"), "configPath stays the framework's own copy");

  // a list replaces the base list, null deletes a key
  put(ws, "atf/mcp.yaml", "servers:\n  playwright:\n    args: ['-y', '@playwright/mcp@0.0.83']\n    command: null\n");
  const mcp = loadConfig("mcp.yaml", opts);
  assert.deepEqual(mcp.servers.playwright, { args: ["-y", "@playwright/mcp@0.0.83"] });
  assert.equal(mcp.browser_server, "playwright");
});

test("an ejected file is the whole file: the framework's copy and any overlay are ignored", () => {
  const fw = framework();
  const ws = workspace();
  const opts = { framework: fw, workspace: ws };
  put(ws, "atf/models.yaml", "default: {claude: overlay}\n");
  put(ws, "atf/config/models.yaml", "# ours\ndefault: {claude: ejected, copilot: x}\n");
  assert.deepEqual(loadConfig("models.yaml", opts), { default: { claude: "ejected", copilot: "x" } });
  assert.equal(configText("models.yaml", opts), "# ours\ndefault: {claude: ejected, copilot: x}\n");
  assert.deepEqual(configSource("models.yaml", opts), { name: "models.yaml", source: "ejected", files: ["atf/config/models.yaml"], digest: sha("# ours\ndefault: {claude: ejected, copilot: x}\n") });
});

test("an overlay that is not a YAML mapping is an error naming the file", () => {
  const fw = framework();
  const ws = workspace();
  const opts = { framework: fw, workspace: ws };
  for (const [text, what] of [["- a\n- b\n", /not a list/], ["just text\n", /not string/], ["", /not empty/], ["# only a comment\n", /not empty/], ["a: [\n", /unexpected end|end of the stream|flow collection/]]) {
    put(ws, "atf/platforms.yaml", text);
    assert.throws(() => loadConfig("platforms.yaml", opts), what, JSON.stringify(text));
    assert.throws(() => configSource("platforms.yaml", opts), /atf\/platforms\.yaml/, JSON.stringify(text));
  }
});

test("hooks.yaml holds only post_tool_use: async|sync|off, from any source; the PreToolUse guard is not configurable", () => {
  assert.deepEqual(HOOKS_KEYS.post_tool_use, POST_MODES, "the loader's modes are the registrations' modes");
  const fw = framework();
  const ws = workspace();
  const opts = { framework: fw, workspace: ws };
  assert.deepEqual(loadConfig("hooks.yaml", opts), { post_tool_use: "async" });
  put(ws, "atf/hooks.yaml", "post_tool_use: sync\n");
  assert.deepEqual(loadConfig("hooks.yaml", opts), { post_tool_use: "sync" }, "an overlay may change the PostToolUse mode");
  for (const [rel, text, why] of [
    ["atf/hooks.yaml", "pre_tool_use: off\n", /'pre_tool_use' not configurable.*PreToolUse guard is always registered/],
    ["atf/hooks.yaml", "post_tool_use: null\n", /post_tool_use 'undefined' not in \[async,sync,off\]/],
    ["atf/hooks.yaml", "post_tool_use: never\n", /atf\/hooks\.yaml: post_tool_use 'never' not in/],
    ["atf/hooks.yaml", "PreToolUse: []\npost_tool_use: off\n", /'PreToolUse' not configurable/],
    ["atf/config/hooks.yaml", "post_tool_use: off\nguard: off\n", /atf\/config\/hooks\.yaml: 'guard' not configurable/],
    ["atf/config/hooks.yaml", "- post_tool_use\n", /must be a mapping/],
  ]) {
    put(ws, rel, text);
    for (const read of [loadConfig, configText, configSource]) assert.throws(() => read("hooks.yaml", opts), why, `${rel}: ${text}`);
    writeFileSync(path.join(ws, rel), "post_tool_use: off\n");
  }
  // the framework's own copy is held to the same rule
  writeFileSync(path.join(fw, "config", "hooks.yaml"), "post_tool_use: async\npre_tool_use: off\n");
  assert.throws(() => loadConfig("hooks.yaml", { framework: fw, workspace: fw }), /config\/hooks\.yaml: 'pre_tool_use' not configurable/);
  assert.throws(() => checkHooks(null), /must be a mapping/);
});

test("configSources: every file, in order, with its source and the digest of its effective text", () => {
  const fw = framework();
  const ws = workspace();
  const opts = { framework: fw, workspace: ws };
  put(ws, "atf/permissions.yaml", "agents:\n  report-generator: {web_research: none}\n");
  put(ws, "atf/config/mcp.yaml", fwText(fw, "mcp.yaml"));
  const all = configSources(opts);
  assert.deepEqual(all.map((s) => s.name), CONFIG_FILES);
  assert.deepEqual(all.map((s) => s.source), ["overlay", "framework", "framework", "ejected", "framework"]);
  for (const s of all) assert.equal(s.digest, sha(configText(s.name, opts)), s.name);
  assert.equal(all[3].digest, sha(fwText(fw, "mcp.yaml")), "an ejected copy of the framework's file has its digest");
  assert.notEqual(all[0].digest, sha(fwText(fw, "permissions.yaml")));
  assert.deepEqual(configSources({ framework: fw, workspace: fw }).map((s) => s.source), CONFIG_FILES.map(() => "framework"));
});

test("run.mjs init freezes the overlaid permissions; validation still applies; a run-config's own permissions_file gets no overlay", () => {
  const ws = workspace();
  put(ws, "atf/permissions.yaml", "agents:\n  knowledge-generator:\n    web_research: none\n    shell_allow: ['node {fw}/scripts/knowledge.mjs check *']\n");
  const r = initRun(writeConfig(ws), { root: ws, runId: "acme-run-1", env: { CLAUDECODE: "1" } });
  assert.deepEqual(r.errors, undefined);
  const frozen = JSON.parse(readFileSync(paths("acme", ws).permissionsFile, "utf8"));
  const kg = frozen.agents["knowledge-generator"];
  assert.equal(kg.web_research, "none");
  assert.ok(kg.shell_allow.some((c) => /knowledge\.mjs check \*$/.test(c)) && !kg.shell_allow.some((c) => /add-source/.test(c)), "the list replaced");
  assert.equal(frozen.agents["module-explorer"].live_target.browser, "mutate", "the rest is the framework's");
  assert.equal(path.resolve(ws, r.run.permissionsPath), configPath("permissions.yaml"), "permissionsPath still names the framework's copy");

  // an overlay that breaks the file fails init like a broken file would
  const bad = workspace();
  put(bad, "atf/permissions.yaml", "agents:\n  orchestrator-agent:\n    spawns: [nobody]\n");
  assert.match(initRun(writeConfig(bad), { root: bad }).errors.join("\n"), /nobody/);
  const notMap = workspace();
  put(notMap, "atf/permissions.yaml", "- x\n");
  assert.match(initRun(writeConfig(notMap), { root: notMap }).errors.join("\n"), /atf\/permissions\.yaml: an overlay must be a YAML mapping/);

  // an ejected file is frozen as it is, and is the run's permissionsPath
  const ej = workspace();
  const ejected = readFileSync(configPath("permissions.yaml"), "utf8").replace(/^(  knowledge-generator:\n(?:    .*\n)*?    web_research:) allowed/m, "$1 none");
  assert.notEqual(ejected, readFileSync(configPath("permissions.yaml"), "utf8"));
  put(ej, "atf/config/permissions.yaml", ejected);
  put(ej, "atf/permissions.yaml", "agents:\n  module-explorer: {web_research: allowed}\n");
  const e = initRun(writeConfig(ej), { root: ej, runId: "acme-run-1", env: { CLAUDECODE: "1" } });
  assert.deepEqual(e.errors, undefined);
  const ejFrozen = JSON.parse(readFileSync(paths("acme", ej).permissionsFile, "utf8"));
  assert.equal(ejFrozen.agents["knowledge-generator"].web_research, "none");
  assert.equal(ejFrozen.agents["module-explorer"].web_research, "none", "the overlay is ignored beside an ejected file");
  assert.equal(e.run.permissionsPath, "atf/config/permissions.yaml");

  // permissions_file: the workspace's own file, read as it is
  const own = workspace();
  put(own, "atf/permissions.yaml", "agents:\n  knowledge-generator: {web_research: none}\n");
  put(own, "config/mine.yaml", readFileSync(configPath("permissions.yaml"), "utf8"));
  const o = initRun(writeConfig(own, { extra: ["permissions_file: config/mine.yaml"] }), { root: own, runId: "acme-run-1", env: { CLAUDECODE: "1" } });
  assert.deepEqual(o.errors, undefined);
  assert.equal(JSON.parse(readFileSync(paths("acme", own).permissionsFile, "utf8")).agents["knowledge-generator"].web_research, "allowed");
  assert.equal(o.run.permissionsPath, "config/mine.yaml");
});

test("the build reads every file through the loader: an overlaid model reaches the generated agents; --post-hook refuses an override", () => {
  const fw = framework();
  const ws = workspace();
  put(ws, "atf/models.yaml", "agents:\n  report-generator: {claude: haiku}\n");
  const { errors } = build({ root: ws, framework: fw });
  assert.deepEqual(errors, []);
  const agent = (n) => readFileSync(path.join(ws, ".claude", "agents", `${n}.md`), "utf8");
  assert.match(agent("report-generator"), /^model: haiku$/m);
  assert.match(agent("testcase-writer"), new RegExp(`^model: ${yaml.load(fwText(fw, "models.yaml")).default.claude}$`, "m"));
  assert.deepEqual(build({ check: true, root: ws, framework: fw }).changed, []);
  // a hooks overlay decides the PostToolUse mode; it can't touch the PreToolUse guard
  put(ws, "atf/hooks.yaml", "post_tool_use: off\n");
  assert.deepEqual(build({ root: ws, framework: fw }).errors, []);
  const settings = JSON.parse(readFileSync(path.join(ws, ".claude", "settings.json"), "utf8"));
  assert.equal(settings.hooks.PostToolUse, undefined);
  assert.ok(settings.hooks.PreToolUse.length);
  put(ws, "atf/hooks.yaml", "post_tool_use: off\npre_tool_use: off\n");
  assert.ok(build({ check: true, root: ws, framework: fw }).errors.some((e) => /'pre_tool_use' not configurable/.test(e)));
  const before = fwText(fw, "hooks.yaml");
  writeFileSync(path.join(ws, "atf", "hooks.yaml"), "post_tool_use: sync\n");
  assert.ok(build({ root: ws, framework: fw, postHook: "async" }).errors.some((e) => /atf\/hooks\.yaml decides the PostToolUse mode here/.test(e)));
  assert.equal(fwText(fw, "hooks.yaml"), before, "nothing written");
  // a broken permissions overlay is a build error, like a broken file
  put(ws, "atf/permissions.yaml", "agents:\n  orchestrator-agent: {spawns: [nobody]}\n");
  assert.ok(build({ check: true, root: ws, framework: fw }).errors.some((e) => /nobody/.test(e)));
});

test("the network guard reads the effective mcp.yaml: kept through an overlay, gone when an overlay drops the init page", () => {
  const fw = framework();
  const ws = workspace();
  assert.equal(networkGuarded(fw, ws), true);
  put(ws, "atf/mcp.yaml", "servers:\n  playwright:\n    command: npx\n");
  assert.equal(networkGuarded(fw, ws), true, "the dumped args still name the init page");
  put(ws, "atf/mcp.yaml", "servers:\n  playwright:\n    args: ['-y', '@playwright/mcp@0.0.83']\n");
  assert.equal(networkGuarded(fw, ws), false);
  put(ws, "atf/mcp.yaml", "- broken\n");
  assert.equal(networkGuarded(fw, ws), false, "fails closed");
  put(ws, "atf/config/mcp.yaml", fwText(fw, "mcp.yaml"));
  assert.equal(networkGuarded(fw, ws), true, "an ejected copy that keeps it");
});
