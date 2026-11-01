// The Node.js check (scripts/lib/node-version.mjs, D-109) that the guard hook, run.mjs, run-config.mjs and the doctor
// run first, and the minimum the package declares to npm.
// findNode, pathNode and reexecPlan (the friction plan's K1 and bin/atf.mjs's switch to a newer Node): every OS's
// layout through injected file-system and probe calls, then bin/atf.mjs itself on an older Node when this machine has one.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { MIN_NODE, NODE_PIN_FILE, RECOMMENDED_NODE, REEXEC_ENV, REEXEC_PARENT_ENV, findNode, gateNode, installHint, nodeMajor, nodeProblem, nvmrcMajor, parseNodeVersion, pathNode, probeNode, readLocalNode, reexecPlan, rerun } from "./lib/node-version.mjs";
import { frameworkRoot } from "./lib/roots.mjs";

// A fake machine: `files` maps each Node.js binary to the version it reports (null: it doesn't answer); `dirs` maps a
// folder to its entries. Every probe is counted.
function machine({ files = {}, dirs = {} } = {}) {
  const probed = [];
  return {
    probed,
    exists: (f) => Object.hasOwn(files, f),
    readdir: (d) => {
      if (!Object.hasOwn(dirs, d)) throw Object.assign(new Error(`ENOENT: ${d}`), { code: "ENOENT" });
      return dirs[d];
    },
    probe: (f) => (probed.push(f), files[f] ?? null),
  };
}
const OLD_EXEC = { execPath: "/opt/homebrew/opt/node@18/bin/node", current: "18.20.8" };

test("an older Node.js is a problem with its fix; the minimum and later are not", () => {
  for (const v of ["18.20.8", "v18.20.8", "19.9.0"]) {
    const p = nodeProblem(v);
    assert.equal(p.detail, `Node.js ${v.replace(/^v/, "")} is older than ${MIN_NODE}, which Playwright, the browser server and the framework's scripts need`);
    assert.match(p.fix, /nvm use/);
    assert.match(p.fix, /start a new agent session/);
  }
  for (const v of [`${MIN_NODE}.0.0`, "22.1.0", "v24.19.0"]) assert.equal(nodeProblem(v), null, v);
  // this process: the suite itself runs on a supported Node
  assert.equal(nodeProblem(), null);
});

test("the package declares the same minimum to npm", () => {
  const pkg = JSON.parse(readFileSync(path.join(frameworkRoot, "package.json"), "utf8"));
  assert.deepEqual(pkg.engines, { node: `>=${MIN_NODE}` });
});

test("the Node.js a missing install is told to get is the one atf init's .nvmrc names", () => {
  assert.equal(readFileSync(path.join(frameworkRoot, "templates", "workspace", "_nvmrc"), "utf8").trim(), String(RECOMMENDED_NODE));
  assert.ok(RECOMMENDED_NODE >= MIN_NODE);
});

test("parseNodeVersion and probeNode read what `node --version` prints, and nothing else", () => {
  assert.equal(parseNodeVersion("v24.19.0\n"), "24.19.0");
  assert.equal(parseNodeVersion("18.20.8"), "18.20.8");
  for (const bad of ["", "v24", "node v24.1.0", null, undefined]) assert.equal(parseNodeVersion(bad), null, String(bad));
  assert.equal(nodeMajor("24.19.0"), 24);
  // this process's own binary answers with its own version; a missing file doesn't answer
  assert.equal(probeNode(process.execPath), process.versions.node);
  assert.equal(probeNode(path.join(frameworkRoot, "no-such-node")), null);
});

test("findNode (macOS/Linux): the newest Node.js of 20 or later from PATH, nvm, fnm, Volta, asdf, Homebrew and the system folders", () => {
  const home = "/Users/ann";
  const m = machine({
    files: {
      "/opt/homebrew/opt/node@18/bin/node": "18.20.8",
      "/Users/ann/.nvm/versions/node/v22.11.0/bin/node": "22.11.0",
      "/Users/ann/.nvm/versions/node/v24.19.0/bin/node": "24.19.0",
      "/Users/ann/.nvm/versions/node/v16.0.0/bin/node": "16.0.0",
      "/Users/ann/.local/share/fnm/node-versions/v23.0.0/installation/bin/node": "23.0.0",
      "/Users/ann/.volta/tools/image/node/21.0.0/bin/node": "21.0.0",
      "/Users/ann/.asdf/installs/nodejs/20.1.0/bin/node": "20.1.0",
      "/opt/homebrew/opt/node@22/bin/node": "22.3.0",
      "/opt/homebrew/bin/node": null, // there, but it doesn't answer
      "/usr/local/bin/node": "19.0.0",
    },
    dirs: {
      "/Users/ann/.nvm/versions/node": ["v16.0.0", "v22.11.0", "v24.19.0"],
      "/Users/ann/.local/share/fnm/node-versions": ["v23.0.0"],
      "/Users/ann/.volta/tools/image/node": ["21.0.0"],
      "/Users/ann/.asdf/installs/nodejs": ["20.1.0"],
      "/opt/homebrew/opt": ["node@18", "node@22", "openjdk@21", "nodejs-lts"],
    },
  });
  const env = { PATH: "/opt/homebrew/opt/node@18/bin:/usr/bin:/bin" };
  assert.deepEqual(findNode({ env, platform: "darwin", home, ...m, ...OLD_EXEC }), { path: "/Users/ann/.nvm/versions/node/v24.19.0/bin/node", version: "24.19.0", source: "nvm" });
  // the old process itself is never a candidate, and a folder that is not a node keg is never looked into
  assert.ok(!m.probed.includes(OLD_EXEC.execPath));
  assert.ok(!m.probed.some((f) => f.includes("openjdk") || f.includes("nodejs-lts")));
  // each file probed once
  assert.equal(new Set(m.probed).size, m.probed.length);
  // nothing new enough: null; a higher minimum is honoured
  assert.equal(findNode({ env, platform: "linux", home, ...machine({ files: { "/opt/homebrew/opt/node@18/bin/node": "18.20.8" } }), ...OLD_EXEC }), null);
  assert.equal(findNode({ env, platform: "darwin", home, ...m, ...OLD_EXEC, min: 25 }), null);
  // NVM_DIR, VOLTA_HOME, ASDF_DATA_DIR and FNM_DIR move the version managers' folders
  const moved = machine({ files: { "/nvm/versions/node/v20.0.0/bin/node": "20.0.0", "/fnm/node-versions/v25.0.0/installation/bin/node": "25.0.0" }, dirs: { "/nvm/versions/node": ["v20.0.0"], "/fnm/node-versions": ["v25.0.0"] } });
  assert.deepEqual(findNode({ env: { NVM_DIR: "/nvm", FNM_DIR: "/fnm" }, platform: "linux", home, ...moved, ...OLD_EXEC, min: 21 }), { path: "/fnm/node-versions/v25.0.0/installation/bin/node", version: "25.0.0", source: "fnm" });
});

test("findNode prefers the workspace's .nvmrc major when installed, else the newest even (LTS) major, else the newest", () => {
  const files = {
    "/a/node": "25.2.0",
    "/b/node": "22.20.0",
    "/c/node": "24.1.0",
    "/d/node": "24.11.0",
    "/e/node": "21.7.0",
  };
  const env = { PATH: "/a:/b:/c:/d:/e" };
  const find = (extra) => findNode({ env, platform: "linux", home: "/h", ...machine({ files }), ...OLD_EXEC, ...extra })?.path;
  // the .nvmrc's major, its newest
  assert.equal(find({ nvmrc: 22 }), "/b/node");
  assert.equal(find({ nvmrc: 24 }), "/d/node");
  // a major that isn't installed, none, or one below the minimum: the newest even major (25 is not an LTS line)
  for (const nvmrc of [26, null, 18]) assert.equal(find({ nvmrc }), "/d/node", String(nvmrc));
  // only odd majors: the newest of them
  assert.equal(findNode({ env: { PATH: "/a:/e" }, platform: "linux", home: "/h", ...machine({ files }), ...OLD_EXEC }).path, "/a/node");
  // the current process takes part the same way: an odd one loses to an even one, and wins the .nvmrc's major
  const m = machine({ files: { "/b/node": "22.20.0" } });
  assert.equal(findNode({ env: { PATH: "/b" }, platform: "linux", home: "/h", ...m, execPath: "/me/node", current: "25.0.0" }).path, "/b/node");
  assert.equal(findNode({ env: { PATH: "/b" }, platform: "linux", home: "/h", ...m, execPath: "/me/node", current: "25.0.0", nvmrc: 25 }).path, "/me/node");
});

test("nvmrcMajor reads the major an .nvmrc names; an alias or nothing is null", () => {
  for (const [text, want] of [["24\n", 24], ["v22.11.0", 22], ["  20.1  \r\n", 20], ["lts/*", null], ["lts/jod", null], ["node", null], ["", null], [null, null], ["24 # comment", null]]) assert.equal(nvmrcMajor(text), want, JSON.stringify(text));
});

test("readLocalNode: the pin atf sync recorded in atf/machine.json and the .nvmrc's major; anything missing or broken is null", () => {
  const ws = path.join(path.sep, "ws");
  const at = (rel) => path.join(ws, ...rel.split("/"));
  const read = (files) => (f) => {
    if (!Object.hasOwn(files, f)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return files[f];
  };
  const pin = { path: "/n/24/bin/node", version: "24.1.0", pinnedAt: "2026-11-01T00:00:00.000Z" };
  assert.equal(NODE_PIN_FILE, "atf/machine.json");
  assert.deepEqual(readLocalNode(ws, { read: read({ [at(NODE_PIN_FILE)]: `\ufeff${JSON.stringify({ node: pin })}`, [at(".nvmrc")]: "24\n" }) }), { pin, nvmrc: 24 });
  for (const text of ["{", "[]", '{"node": "/usr/bin/node"}', '{"node": {"path": ""}}', '{"other": 1}'])
    assert.deepEqual(readLocalNode(ws, { read: read({ [at(NODE_PIN_FILE)]: text }) }), { pin: null, nvmrc: null }, text);
  assert.deepEqual(readLocalNode(ws, { read: read({}) }), { pin: null, nvmrc: null });
  assert.deepEqual(readLocalNode(null, { read: () => assert.fail("reads nothing") }), { pin: null, nvmrc: null });
});

test("findNode: among equal versions the first listed wins, and the current process (never probed) only when no listed path is as new", () => {
  const m = machine({ files: { "/usr/local/bin/node": "24.1.0", "/a/node": "24.1.0", "/b/node": "24.1.0" } });
  // the same version listed: the listed path, a name that survives upgrades (Homebrew's opt link, not its Cellar file)
  assert.deepEqual(findNode({ env: { PATH: "/a:/b" }, platform: "linux", home: "/h", ...m, execPath: "/Cellar/24.1.0/bin/node", current: "24.1.0" }), { path: "/a/node", version: "24.1.0", source: "PATH" });
  assert.deepEqual(findNode({ env: { PATH: "/a:/b" }, platform: "linux", home: "/h", ...m, ...OLD_EXEC }), { path: "/a/node", version: "24.1.0", source: "PATH" });
  // nothing listed as new: this process, never probed
  const newest = machine({ files: { "/a/node": "22.0.0" } });
  assert.deepEqual(findNode({ env: { PATH: "/a" }, platform: "linux", home: "/h", ...newest, execPath: "/me/node", current: "24.1.0" }), { path: "/me/node", version: "24.1.0", source: "this process" });
  assert.ok(!newest.probed.includes("/me/node"));
  // this process's own file listed (its folder in PATH): its known version, under the listed name, never probed
  const own = machine({ files: { "/me/node": "0.0.0" } });
  assert.deepEqual(findNode({ env: { PATH: "/me" }, platform: "linux", home: "/h", ...own, execPath: "/me/node", current: "24.1.0" }), { path: "/me/node", version: "24.1.0", source: "PATH" });
  assert.deepEqual(own.probed, []);
  // a newer one anywhere beats the current process
  const newer = machine({ files: { "/usr/local/bin/node": "26.0.0" } });
  assert.deepEqual(findNode({ env: {}, platform: "linux", home: "/h", ...newer, execPath: "/me/node", current: "24.1.0" }), { path: "/usr/local/bin/node", version: "26.0.0", source: "system" });
});

test("findNode (Windows): PATH (as Path), nvm-windows, fnm, Volta and %ProgramFiles%\\nodejs, with Windows paths", () => {
  const home = "C:\\Users\\ann";
  const m = machine({
    files: {
      "C:\\old\\node.exe": "18.20.8",
      "C:\\Users\\ann\\AppData\\Roaming\\nvm\\v22.1.0\\node.exe": "22.1.0",
      "C:\\Program Files\\nodejs\\node.exe": "24.2.0",
      "C:\\Users\\ann\\AppData\\Local\\Volta\\tools\\image\\node\\20.0.0\\node.exe": "20.0.0",
    },
    dirs: { "C:\\Users\\ann\\AppData\\Roaming\\nvm": ["v22.1.0", "settings.txt"], "C:\\Users\\ann\\AppData\\Local\\Volta\\tools\\image\\node": ["20.0.0"] },
  });
  const env = { Path: "C:\\old;C:\\Windows\\System32", ProgramFiles: "C:\\Program Files" };
  assert.deepEqual(findNode({ env, platform: "win32", home, ...m, execPath: "C:\\old\\node.exe", current: "18.20.8" }), { path: "C:\\Program Files\\nodejs\\node.exe", version: "24.2.0", source: "installer" });
  // NVM_HOME moves nvm-windows' folder
  const nvm = machine({ files: { "D:\\nvm\\v25.0.0\\node.exe": "25.0.0" }, dirs: { "D:\\nvm": ["v25.0.0"] } });
  assert.deepEqual(findNode({ env: { NVM_HOME: "D:\\nvm" }, platform: "win32", home, ...nvm, ...OLD_EXEC }), { path: "D:\\nvm\\v25.0.0\\node.exe", version: "25.0.0", source: "nvm-windows" });
});

test("pathNode: the first node the PATH finds, with its version (null when it doesn't answer); none: null", () => {
  const m = machine({ files: { "/b/node": "18.20.8", "/c/node": "24.0.0" } });
  assert.deepEqual(pathNode({ env: { PATH: "/a:/b:/c" }, platform: "linux", ...m }), { path: "/b/node", version: "18.20.8" });
  assert.equal(pathNode({ env: { PATH: "/a" }, platform: "linux", ...m }), null);
  assert.equal(pathNode({ env: {}, platform: "linux", ...m }), null);
  const win = machine({ files: { "C:\\nodejs\\node.exe": null } });
  assert.deepEqual(pathNode({ env: { Path: "C:\\Windows;C:\\nodejs" }, platform: "win32", ...win }), { path: "C:\\nodejs\\node.exe", version: null });
});

test("installHint: nvm when it is there, else Homebrew on macOS, winget on Windows", () => {
  const none = () => false;
  assert.equal(installHint({ env: { NVM_DIR: "/x" }, platform: "darwin", home: "/h", exists: none }), `nvm install ${RECOMMENDED_NODE}`);
  assert.equal(installHint({ env: {}, platform: "linux", home: "/h", exists: (f) => f === "/h/.nvm" }), `nvm install ${RECOMMENDED_NODE}`);
  assert.equal(installHint({ env: {}, platform: "darwin", home: "/h", exists: none }), `brew install node@${RECOMMENDED_NODE}`);
  assert.equal(installHint({ env: {}, platform: "win32", home: "C:\\h", exists: none }), "winget install OpenJS.NodeJS.LTS");
  assert.equal(installHint({ env: { NVM_HOME: "C:\\nvm" }, platform: "win32", home: "C:\\h", exists: none }), `nvm install ${RECOMMENDED_NODE}`);
  assert.match(installHint({ env: {}, platform: "linux", home: "/h", exists: none }), new RegExp(`^nvm install ${RECOMMENDED_NODE} `));
});

test("reexecPlan: nothing on a new Node; on an old one the newest found, its folder first in PATH, the old version passed on", () => {
  assert.equal(reexecPlan({ version: "20.0.0", find: () => assert.fail("never looks") }), null);
  assert.equal(reexecPlan({ version: "v24.19.0", find: () => assert.fail("never looks") }), null);
  const found = { path: "/Users/ann/.nvm/versions/node/v24.19.0/bin/node", version: "24.19.0", source: "nvm" };
  let asked;
  const plan = reexecPlan({ argv: ["/old/node", "/w/node_modules/.bin/atf", "run", "acme"], execArgv: ["--no-warnings"], version: "18.20.8", env: { PATH: "/opt/homebrew/opt/node@18/bin:/usr/bin", HOME: "/Users/ann" }, pid: 4242, ppid: 1, platform: "darwin", find: (o) => ((asked = o), found) });
  assert.equal(plan.line, "atf: using Node.js 24.19.0 (nvm); your default node is 18.20.8");
  assert.deepEqual(plan.run, {
    cmd: found.path,
    args: ["--no-warnings", "/w/node_modules/.bin/atf", "run", "acme"],
    env: { PATH: "/Users/ann/.nvm/versions/node/v24.19.0/bin:/opt/homebrew/opt/node@18/bin:/usr/bin", HOME: "/Users/ann", [REEXEC_ENV]: "18.20.8", [REEXEC_PARENT_ENV]: "4242" },
  });
  assert.equal(asked.current, "18.20.8", "the old process is never a candidate");
  // Windows: Path keeps its name, ; separates
  const win = reexecPlan({ argv: ["C:\\old\\node.exe", "C:\\w\\atf.mjs"], execArgv: [], version: "18.0.0", env: { Path: "C:\\old" }, pid: 7, ppid: 1, platform: "win32", find: () => ({ path: "C:\\Program Files\\nodejs\\node.exe", version: "24.0.0", source: "installer" }) });
  assert.deepEqual(win.run.env, { Path: "C:\\Program Files\\nodejs;C:\\old", [REEXEC_ENV]: "18.0.0", [REEXEC_PARENT_ENV]: "7" });
});

test("reexecPlan: one error line with the install command when nothing is found, or when the Node it switched to is still old", () => {
  const none = reexecPlan({ argv: ["n", "atf"], version: "18.20.8", env: {}, platform: "darwin", home: "/h", exists: () => false, find: () => null });
  assert.deepEqual(Object.keys(none), ["error"]);
  assert.equal(none.error, `atf: Node.js 18.20.8 is older than ${MIN_NODE}, and no newer Node.js is installed on this machine; install one, then run the command again: brew install node@${RECOMMENDED_NODE}`);
  // its own child, still old: a loop, stopped
  const again = reexecPlan({ argv: ["n", "atf"], version: "18.20.8", env: { [REEXEC_ENV]: "16.0.0", [REEXEC_PARENT_ENV]: "4242" }, ppid: 4242, platform: "linux", home: "/h", exists: () => false, find: () => assert.fail("never twice") });
  assert.match(again.error, /^atf: Node\.js 18\.20\.8 is older than 20, even after switching/);
  // the same variables merely inherited (a shell in the session `atf run` opened puts the old node first again): it switches
  const inherited = reexecPlan({ argv: ["n", "atf"], version: "18.20.8", env: { [REEXEC_ENV]: "18.20.8", [REEXEC_PARENT_ENV]: "4242" }, pid: 99, ppid: 98, platform: "linux", find: () => ({ path: "/n/node", version: "24.0.0", source: "PATH" }) });
  assert.equal(inherited.run.env[REEXEC_PARENT_ENV], "99");
});

test("reexecPlan: the Node.js atf sync pinned, while it still answers as 20 or later; else findNode, told the .nvmrc's major", () => {
  const pin = { path: "/pinned/bin/node", version: "24.1.0", pinnedAt: "t" };
  const base = { argv: ["/old/node", "/fw/scripts/run.mjs", "next", "acme"], execArgv: [], version: "18.20.8", env: { PATH: "/old" }, pid: 5, ppid: 1, platform: "linux", home: "/h" };
  const probed = [];
  const plan = reexecPlan({ ...base, local: { pin, nvmrc: 22 }, exists: (f) => f === pin.path, probe: (f) => (probed.push(f), "24.2.0"), find: () => assert.fail("the pin is enough") });
  assert.equal(plan.run.cmd, pin.path);
  assert.deepEqual(probed, [pin.path], "probed once, as it may have been upgraded or replaced");
  assert.equal(plan.found.version, "24.2.0");
  assert.equal(plan.line, `atf: using Node.js 24.2.0 (pinned in ${NODE_PIN_FILE}); your default node is 18.20.8`);
  assert.deepEqual(plan.run.args, ["/fw/scripts/run.mjs", "next", "acme"]);
  // gone, or no longer new enough: findNode decides, preferring the .nvmrc's major
  for (const [exists, version] of [[() => false, "24.0.0"], [(f) => f === pin.path, "18.0.0"]]) {
    let asked;
    const other = reexecPlan({ ...base, local: { pin, nvmrc: 22 }, exists, probe: () => version, find: (o) => ((asked = o), { path: "/n22/node", version: "22.1.0", source: "nvm" }) });
    assert.equal(other.run.cmd, "/n22/node");
    assert.equal(asked.nvmrc, 22);
  }
});

// A fake process for gateNode: its signal listeners, what it exits with and the signals it raises on itself.
function fakeProc({ version = "18.20.8", platform = "linux" } = {}) {
  const listeners = {};
  const proc = {
    versions: { node: version }, platform, argv: ["/old/node", "/fw/scripts/run.mjs", "status", "acme"], execArgv: [], env: { PATH: "/old" }, pid: 42, ppid: 1,
    exited: [], raised: [], listeners,
    on: (event, fn) => ((listeners[event] ??= []).push(fn), proc),
    removeAllListeners: (event) => (delete listeners[event], proc),
    kill: (pid, signal) => proc.raised.push([pid, signal]),
    exit: (code) => proc.exited.push(code),
  };
  return proc;
}
// A fake child_process.spawn: records the call; the test ends the child through `child.end(code, signal)`.
function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const handlers = {};
    const child = { killed: [], on: (e, fn) => ((handlers[e] = fn), child), kill: (s) => child.killed.push(s), end: (code, signal) => handlers.exit(code, signal), fail: (e) => handlers.error(e) };
    calls.push({ cmd, args, opts, child });
    return child;
  };
  return { spawn, calls };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("gateNode: on Node.js 20 or later nothing happens and nothing is read", async () => {
  const proc = fakeProc({ version: "20.0.0" });
  assert.equal(await gateNode({ proc, workspace: "/ws", read: () => assert.fail("reads nothing"), spawn: () => assert.fail("starts nothing") }), null);
  assert.deepEqual(proc.exited, []);
});

test("gateNode: on an older Node the same command runs under the newer one, with the terminal, and this process ends with its exit code", async () => {
  const proc = fakeProc();
  const { spawn, calls } = fakeSpawn();
  const pin = { path: "/pinned/bin/node", version: "24.1.0" };
  const read = (f) => {
    if (f === path.join("/ws", "atf", "machine.json")) return JSON.stringify({ node: pin });
    throw new Error("ENOENT");
  };
  const done = gateNode({ proc, workspace: "/ws", read, spawn, exists: (f) => f === pin.path, probe: () => "24.1.0", find: () => assert.fail("the pin is used") });
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, pin.path);
  assert.deepEqual(calls[0].args, ["/fw/scripts/run.mjs", "status", "acme"], "the agent's command, unchanged");
  assert.equal(calls[0].opts.stdio, "inherit");
  assert.equal(calls[0].opts.env.PATH, `/pinned/bin${path.posix.delimiter}/old`, "npx and Playwright started by the script follow");
  assert.equal(calls[0].opts.env[REEXEC_PARENT_ENV], "42", "the loop guard bin/atf.mjs uses");
  // the old Node going on to load the script's other imports can't end this process meanwhile
  assert.equal(proc.listeners.uncaughtException.length, 1);
  // a SIGTERM or SIGHUP sent to this process alone is passed on; Ctrl-C reaches the child from the terminal
  for (const fn of proc.listeners.SIGTERM) fn();
  for (const fn of proc.listeners.SIGHUP) fn();
  for (const fn of proc.listeners.SIGINT) fn();
  assert.deepEqual(calls[0].child.killed, ["SIGTERM", "SIGHUP"]);
  calls[0].child.end(3, null);
  assert.deepEqual(await done, { code: 3, signal: null });
  assert.deepEqual(proc.exited, [3]);
  assert.deepEqual(proc.raised, []);
});

test("gateNode: a child ended by a signal ends this process by the same signal; nothing newer found: the script carries on", async () => {
  const proc = fakeProc();
  const { spawn, calls } = fakeSpawn();
  const found = () => ({ path: "/n/node", version: "24.0.0", source: "nvm" });
  const done = gateNode({ proc, workspace: null, spawn, exists: () => false, find: found });
  await tick();
  calls[0].child.end(null, "SIGTERM");
  await done;
  assert.deepEqual(proc.raised, [[42, "SIGTERM"]]);
  assert.equal(proc.listeners.SIGTERM, undefined, "its own listeners gone first, so the signal ends it");
  assert.deepEqual(proc.exited, [128 + 15], "and should it survive the signal, the shell's code for it");
  // the child can't start: code 1
  const failed = fakeProc();
  const s2 = fakeSpawn();
  const p2 = gateNode({ proc: failed, spawn: s2.spawn, exists: () => false, find: found });
  await tick();
  s2.calls[0].child.fail(new Error("EACCES"));
  await p2;
  assert.deepEqual(failed.exited, [1]);
  // nothing newer: the plan's error comes back, nothing starts, nothing exits (run.mjs and run-config.mjs refuse)
  const alone = fakeProc();
  const none = await gateNode({ proc: alone, spawn: () => assert.fail("starts nothing"), platform: "linux", home: "/h", exists: () => false, find: () => null });
  assert.match(none.error, /no newer Node\.js is installed/);
  assert.deepEqual(alone.exited, []);
});

test("rerun: the child's exit code and signal; a spawn that throws is code 1", async () => {
  const { spawn, calls } = fakeSpawn();
  const proc = fakeProc();
  const p = rerun({ cmd: "/n/node", args: ["x"], env: {} }, { spawn, proc });
  calls[0].child.end(0, null);
  assert.deepEqual(await p, { code: 0, signal: null });
  const thrown = await rerun({ cmd: "/n/node", args: [], env: {} }, { spawn: () => { throw new Error("ENOENT"); }, proc: fakeProc() });
  assert.deepEqual(thrown, { code: 1, signal: null });
});

// Every framework script an agent runs: named as {fw}/scripts/<x>.mjs in an agent source, or allowed in an agent's
// shell_allow (config/permissions.yaml). build-agents.mjs is the source checkout's build, never a run's.
function agentScripts() {
  const names = new Set();
  const agents = path.join(frameworkRoot, "agents");
  for (const f of readdirSync(agents).filter((n) => n.endsWith(".md"))) for (const [, n] of readFileSync(path.join(agents, f), "utf8").matchAll(/\{fw\}\/scripts\/([a-z0-9-]+)\.mjs/g)) names.add(n);
  for (const [, n] of readFileSync(path.join(frameworkRoot, "config", "permissions.yaml"), "utf8").matchAll(/scripts\/([a-z0-9-]+)\.mjs/g)) names.add(n);
  names.delete("build-agents");
  return [...names].sort();
}
// A module's static imports, in order (side-effect imports included).
const staticImports = (file) => [...readFileSync(file, "utf8").matchAll(/^import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["'];/gm)].map((m) => m[1]);

test("every framework script an agent runs imports lib/node-gate.mjs first, so it runs itself again before its own imports", () => {
  const scripts = agentScripts();
  assert.ok(scripts.includes("run") && scripts.includes("run-config") && scripts.length >= 20, scripts.join(" "));
  for (const name of scripts) assert.equal(staticImports(path.join(frameworkRoot, "scripts", `${name}.mjs`))[0], "./lib/node-gate.mjs", `${name}.mjs`);
  // the gate itself loads only node-version.mjs, roots.mjs and Node built-ins, which an old Node reads
  assert.deepEqual(staticImports(path.join(frameworkRoot, "scripts", "lib", "node-gate.mjs")), ["./node-version.mjs", "./roots.mjs"]);
  for (const spec of staticImports(path.join(frameworkRoot, "scripts", "lib", "roots.mjs"))) assert.match(spec, /^node:/, spec);
});

test("the guard hook never runs itself again: no module it loads imports the gate (it refuses on an older Node, D-109)", () => {
  const seen = new Set();
  // its static imports and the import("…") calls it loads the rest with
  const imports = (file) => [...staticImports(file), ...[...readFileSync(file, "utf8").matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1])];
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of imports(file).filter((s) => s.startsWith("."))) walk(path.resolve(path.dirname(file), spec));
  };
  walk(path.join(frameworkRoot, "scripts", "hooks", "pretooluse.mjs"));
  assert.ok(seen.size > 3);
  assert.ok(![...seen].some((f) => f.endsWith(`${path.sep}node-gate.mjs`)), [...seen].join("\n"));
});

test("bin/atf.mjs and node-version.mjs load only Node built-ins before the switch, so an old Node can run them", () => {
  const bin = readFileSync(path.join(frameworkRoot, "bin", "atf.mjs"), "utf8");
  assert.doesNotMatch(bin, /^\s*import\s/m, "no static import: node-version.mjs, then the CLI, are loaded with import()");
  assert.ok(bin.indexOf('import("../scripts/lib/node-version.mjs")') < bin.indexOf('import("../scripts/lib/cli.mjs")'));
  const lib = readFileSync(path.join(frameworkRoot, "scripts", "lib", "node-version.mjs"), "utf8");
  for (const [, spec] of lib.matchAll(/^import .* from "([^"]+)";$/gm)) assert.match(spec, /^node:/, spec);
});

// The real thing on a Node.js older than 20, where this machine has one (Homebrew's node@18 behind nvm's, say): it
// switches to the newest found and says so in one line. Skipped elsewhere (CI installs one Node).
test("bin/atf.mjs started on an older Node runs itself again on a newer one, with one line saying so", (t) => {
  const old = ["/opt/homebrew/opt/node@18/bin/node", "/usr/local/opt/node@18/bin/node", "/opt/homebrew/opt/node@16/bin/node"].find((f) => existsSync(f) && nodeMajor(probeNode(f) ?? "0.0.0") < MIN_NODE);
  if (!old) return t.skip("no Node.js older than 20 on this machine");
  const r = spawnSync(old, [path.join(frameworkRoot, "bin", "atf.mjs"), "help"], { encoding: "utf8", env: { ...process.env, [REEXEC_ENV]: "", [REEXEC_PARENT_ENV]: "" } });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`^atf: using Node\\.js \\d+\\.\\d+\\.\\d+ \\([^)]+\\); your default node is ${probeNode(old).replaceAll(".", "\\.")}\\n$`));
  assert.match(r.stdout, /^atf <command>/);
});

// The same for the scripts agents run: silently, with the exit code passed through and the newer Node's folder first in
// PATH; an import that fails on the old Node doesn't matter, the child does the work. run.mjs and run-config.mjs, which
// refuse an older Node (D-109), answer as they do on this one.
test("a framework script started on an older Node runs itself again on a newer one, silently, its exit code passed through", (t) => {
  const old = ["/opt/homebrew/opt/node@18/bin/node", "/usr/local/opt/node@18/bin/node", "/opt/homebrew/opt/node@16/bin/node"].find((f) => existsSync(f) && nodeMajor(probeNode(f) ?? "0.0.0") < MIN_NODE);
  if (!old) return t.skip("no Node.js older than 20 on this machine");
  const env = { ...process.env, [REEXEC_ENV]: "", [REEXEC_PARENT_ENV]: "" };
  const dir = mkdtempSync(path.join(os.tmpdir(), "atf-node-gate-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const gate = pathToFileURL(path.join(frameworkRoot, "scripts", "lib", "node-gate.mjs")).href;
  writeFileSync(path.join(dir, "old-fails.mjs"), `if (Number(process.versions.node.split(".")[0]) < ${MIN_NODE}) throw new Error("fails on an old Node");\n`);
  writeFileSync(path.join(dir, "probe.mjs"), `import ${JSON.stringify(gate)};\nimport "./old-fails.mjs";\nconsole.log(JSON.stringify({ version: process.versions.node, first: process.env.PATH.split(${JSON.stringify(path.delimiter)})[0], args: process.argv.slice(2) }));\nprocess.exitCode = 7;\n`);
  const r = spawnSync(old, [path.join(dir, "probe.mjs"), "a", "b c"], { encoding: "utf8", env, cwd: dir });
  assert.equal(r.status, 7, r.stderr);
  assert.equal(r.stderr, "");
  const out = JSON.parse(r.stdout);
  assert.ok(nodeMajor(out.version) >= MIN_NODE, out.version);
  assert.deepEqual(out.args, ["a", "b c"]);
  assert.equal(probeNode(path.join(out.first, process.platform === "win32" ? "node.exe" : "node")), out.version, "the newer Node's folder first in PATH");
  for (const script of ["run.mjs", "run-config.mjs"]) {
    const file = path.join(frameworkRoot, "scripts", script);
    const [a, b] = [old, process.execPath].map((node) => spawnSync(node, [file], { encoding: "utf8", env, cwd: dir }));
    assert.deepEqual({ status: a.status, stdout: a.stdout, stderr: a.stderr }, { status: b.status, stdout: b.stdout, stderr: b.stderr }, script);
  }
});
