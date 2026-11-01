// src/node-env.js (D-110): finding the Node.js installs, the terminal's node, and pinning one into an agent terminal's
// command line. The spawn and file-system calls are faked; one test probes this process's own node for real.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { MIN_NODE } from "../../core/scripts/lib/node-version.mjs";
import { terminalLine } from "../src/cli.js";
import { NODE_MIN, TERMINAL_MARK, TERMINAL_PROBE, findNodes, nodeCandidates, parseTerminalProbe, parseVersion, pinPrefix, probeNode, sessionNodeRow, terminalNode } from "../src/node-env.js";

// A spawn whose child prints out(cmd, argv) on stdout and exits 0 (an Error thrown by out: the spawn fails).
function fakeSpawn(out) {
  const calls = [];
  const spawn = (cmd, argv, opts) => {
    calls.push({ cmd, argv, opts });
    const text = out(cmd, argv);
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      if (text === null) return child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }));
      if (text) child.stdout.emit("data", Buffer.from(text));
      child.emit("close", 0);
    });
    return child;
  };
  return { spawn, calls };
}

test("the minimum is the framework's", () => {
  assert.equal(NODE_MIN, MIN_NODE);
});

test("parseVersion: a version line, with or without v; anything else is null", () => {
  assert.deepEqual(parseVersion("v24.19.0\n"), { version: "24.19.0", major: 24 });
  assert.deepEqual(parseVersion("18.20.8"), { version: "18.20.8", major: 18 });
  for (const x of ["", "node", "v24", undefined, "24.1.0 extra"]) assert.equal(parseVersion(x), null, String(x));
});

test("nodeCandidates (macOS/Linux): nvm, Volta, fnm, Homebrew kegs, system folders, then PATH; only what exists, once", () => {
  const home = "/Users/me";
  const files = new Set([
    `${home}/.nvm/versions/node/v24.19.0/bin/node`,
    `${home}/.nvm/versions/node/v18.1.0/bin/node`,
    `${home}/.volta/tools/image/node/22.3.0/bin/node`,
    `${home}/.local/share/fnm/node-versions/v20.11.0/installation/bin/node`,
    "/opt/homebrew/opt/node@18/bin/node",
    "/opt/homebrew/opt/node/bin/node",
    "/opt/homebrew/bin/node",
    "/custom/bin/node",
  ]);
  const dirs = {
    [`${home}/.nvm/versions/node`]: ["v24.19.0", "v18.1.0"],
    [`${home}/.volta/tools/image/node`]: ["22.3.0"],
    [`${home}/.local/share/fnm/node-versions`]: ["v20.11.0"],
    "/opt/homebrew/opt": ["node@18", "node", "python@3"],
  };
  const readdir = (d) => {
    if (!dirs[d]) throw new Error("ENOENT");
    return dirs[d];
  };
  const c = nodeCandidates({ platform: "darwin", home, env: { PATH: "/opt/homebrew/bin:/custom/bin:/nowhere" }, exists: (f) => files.has(f), readdir });
  assert.deepEqual(c, [
    { path: `${home}/.nvm/versions/node/v24.19.0/bin/node`, source: "nvm" },
    { path: `${home}/.nvm/versions/node/v18.1.0/bin/node`, source: "nvm" },
    { path: `${home}/.volta/tools/image/node/22.3.0/bin/node`, source: "Volta" },
    { path: `${home}/.local/share/fnm/node-versions/v20.11.0/installation/bin/node`, source: "fnm" },
    { path: "/opt/homebrew/opt/node@18/bin/node", source: "Homebrew node@18" },
    { path: "/opt/homebrew/opt/node/bin/node", source: "Homebrew node" },
    { path: "/opt/homebrew/bin/node", source: "system" },
    { path: "/custom/bin/node", source: "PATH" },
  ]);
});

test("nodeCandidates (Windows): nvm-windows, Volta, the installer's folder, then Path (any case)", () => {
  const home = "C:\\Users\\me";
  const files = new Set(["C:\\nvm\\v24.1.0\\node.exe", "C:\\Program Files\\nodejs\\node.exe", "D:\\tools\\node.exe"]);
  const readdir = (d) => (d === "C:\\nvm" ? ["v24.1.0"] : []);
  const c = nodeCandidates({ platform: "win32", home, env: { NVM_HOME: "C:\\nvm", ProgramFiles: "C:\\Program Files", Path: "D:\\tools;C:\\Program Files\\nodejs" }, exists: (f) => files.has(f), readdir });
  assert.deepEqual(c, [
    { path: "C:\\nvm\\v24.1.0\\node.exe", source: "nvm-windows" },
    { path: "C:\\Program Files\\nodejs\\node.exe", source: "installer" },
    { path: "D:\\tools\\node.exe", source: "PATH" },
  ]);
});

test("findNodes: each found once by its real file, probed, newest first; one that does not answer is left out", async () => {
  const home = "/h";
  const files = new Set(["/h/.nvm/versions/node/v24.19.0/bin/node", "/opt/homebrew/opt/node@18/bin/node", "/opt/homebrew/bin/node", "/broken/node"]);
  const versions = { "/h/.nvm/versions/node/v24.19.0/bin/node": "24.19.0\n", "/opt/homebrew/opt/node@18/bin/node": "18.20.8\n", "/opt/homebrew/bin/node": "18.20.8\n", "/broken/node": "" };
  const { spawn, calls } = fakeSpawn((cmd) => versions[cmd]);
  const found = await findNodes({
    platform: "darwin",
    home,
    env: { PATH: "/broken" },
    exists: (f) => files.has(f),
    readdir: (d) => ({ "/h/.nvm/versions/node": ["v24.19.0"], "/opt/homebrew/opt": ["node@18"] })[d] ?? [],
    realpath: (f) => (f === "/opt/homebrew/bin/node" ? "/opt/homebrew/opt/node@18/bin/node" : f),
    spawn,
  });
  assert.deepEqual(found, [
    { path: "/h/.nvm/versions/node/v24.19.0/bin/node", version: "24.19.0", major: 24, source: "nvm" },
    { path: "/opt/homebrew/opt/node@18/bin/node", version: "18.20.8", major: 18, source: "Homebrew node@18" },
  ]);
  assert.deepEqual(calls.map((c) => [c.cmd, c.argv]), [
    ["/h/.nvm/versions/node/v24.19.0/bin/node", ["-p", "process.versions.node"]],
    ["/opt/homebrew/opt/node@18/bin/node", ["-p", "process.versions.node"]],
    ["/broken/node", ["-p", "process.versions.node"]],
  ], "the symlink to a node already probed is not probed again");
  assert.ok(calls.every((c) => c.opts.shell === false));
});

test("probeNode: this process's own node, for real", async () => {
  assert.deepEqual(await probeNode(process.execPath), parseVersion(process.versions.node));
  assert.equal(await probeNode(path.join(path.dirname(process.execPath), "no-such-node")), null);
});

test("terminalNode (POSIX): an interactive login shell runs the probe; its startup files' noise is ignored", async () => {
  assert.match(TERMINAL_PROBE, /command -v node/);
  const { spawn, calls } = fakeSpawn(() => `Welcome!\nnvm: using v24\n\n${TERMINAL_MARK}/Users/me/.nvm/versions/node/v24.19.0/bin/node|24.19.0\n`);
  assert.deepEqual(await terminalNode({ shell: "/bin/zsh", platform: "darwin", env: { HOME: "/Users/me" }, spawn }), { path: "/Users/me/.nvm/versions/node/v24.19.0/bin/node", version: "24.19.0", major: 24 });
  assert.deepEqual([calls[0].cmd, calls[0].argv], ["/bin/zsh", ["-ilc", TERMINAL_PROBE]]);
  assert.deepEqual(parseTerminalProbe(`${TERMINAL_MARK}|`), { missing: true }, "the shell finds no node");
  assert.equal(parseTerminalProbe("nothing marked"), null);
  const silent = fakeSpawn(() => "");
  assert.match((await terminalNode({ shell: "/bin/bash", platform: "linux", spawn: silent.spawn })).error, /bash did not say which node it finds/);
  const none = fakeSpawn(() => null);
  assert.match((await terminalNode({ shell: "/bin/nosh", platform: "linux", spawn: none.spawn })).error, /\/bin\/nosh: spawn ENOENT/);
});

test("terminalNode (Windows): the first node.exe on VS Code's Path, probed", async () => {
  const { spawn, calls } = fakeSpawn(() => "20.11.1\n");
  const found = await terminalNode({ platform: "win32", env: { Path: "C:\\a;C:\\Program Files\\nodejs" }, exists: (f) => f === "C:\\Program Files\\nodejs\\node.exe", spawn });
  assert.deepEqual(found, { path: "C:\\Program Files\\nodejs\\node.exe", version: "20.11.1", major: 20 });
  assert.equal(calls.length, 1);
  assert.deepEqual(await terminalNode({ platform: "win32", env: { Path: "C:\\a" }, exists: () => false, spawn }), { missing: true });
});

test("pinPrefix: the pinned folder first on the next command's PATH, quoted for each shell; an unsafe folder is refused", () => {
  assert.equal(pinPrefix("/Users/me/.nvm/versions/node/v24.19.0/bin", "posix"), `PATH='/Users/me/.nvm/versions/node/v24.19.0/bin':"$PATH" `);
  assert.equal(pinPrefix("/it's here/bin", "posix"), `PATH='/it'\\''s here/bin':"$PATH" `);
  assert.equal(pinPrefix("C:\\Program Files\\nodejs", "powershell"), "$env:PATH = 'C:\\Program Files\\nodejs;' + $env:PATH; ");
  assert.equal(pinPrefix("C:\\Bob's\\node", "powershell"), "$env:PATH = 'C:\\Bob''s\\node;' + $env:PATH; ");
  assert.equal(pinPrefix("C:\\Program Files\\nodejs", "cmd"), 'set "PATH=C:\\Program Files\\nodejs;%PATH%" && ');
  assert.throws(() => pinPrefix("C:\\100%\\node", "cmd"), /cmd\.exe/);
  assert.throws(() => pinPrefix('C:\\a"b', "powershell"), /PowerShell/);
  assert.throws(() => pinPrefix("/a\nb", "posix"), /can't pin/);
  assert.throws(() => pinPrefix("", "posix"), /can't pin/);

  // the agent terminal's line (cli.js terminalLine)
  const dir = "/Users/me/.nvm/versions/node/v24.19.0/bin";
  assert.equal(terminalLine(["run", "acme"], { kind: "posix", platform: "darwin", nodeDir: dir }), `PATH='${dir}':"$PATH" npx --no atf run acme`);
  assert.equal(terminalLine(["run", "acme"], { kind: "powershell", platform: "win32", nodeDir: "C:\\node" }), "$env:PATH = 'C:\\node;' + $env:PATH; npx.cmd --no atf run acme");
  assert.equal(terminalLine(["run", "acme"], { kind: "posix", platform: "darwin" }), "npx --no atf run acme", "no pin: the line as before");
});

test("sessionNodeRow: ok from the minimum up; too old, missing or unknown is not", () => {
  assert.deepEqual(sessionNodeRow({ path: "/n", version: "24.19.0", major: 24 }), { source: "terminal", path: "/n", version: "24.19.0", major: 24, ok: true, detail: "Node.js 24.19.0 in a new terminal: /n" });
  assert.deepEqual(sessionNodeRow({ path: "/o", version: "18.20.8", major: 18 }, { pinned: true }), { source: "pinned", path: "/o", version: "18.20.8", major: 18, ok: false, detail: "Node.js 18.20.8 pinned (atf.nodePath), older than 20: /o" });
  assert.deepEqual(sessionNodeRow({ missing: true }), { source: "terminal", ok: false, missing: true, detail: "Node.js in a new terminal: none found" });
  assert.deepEqual(sessionNodeRow({ error: "zsh timed out" }), { source: "terminal", ok: false, detail: "Node.js in a new terminal: can't tell (zsh timed out)" });
});
