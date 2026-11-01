// The Node.js the framework needs (D-109). Playwright, the browser server and every script and hook of a session run
// on the session's Node, and an older one fails only when a browser starts. So it is checked before anything else: the
// guard hook refuses every tool call of a session on an older Node, run.mjs and run-config.mjs refuse every command,
// and the doctor reports it. The package declares it as engines.node, and atf init writes the workspace's .nvmrc.
// Loaded by the guard hook, so it is safety code: human-only, and plain enough to load on any Node (Node built-ins
// only, and no syntax newer than the oldest Node a human may still have first in their PATH).
//
// A newer Node is often installed beside the old one (nvm's 24 behind Homebrew's node@18 in PATH). findNode() finds
// it (the workspace's .nvmrc major first, then the newest LTS line, then the newest), and three callers use it:
//   bin/atf.mjs       started on an older Node, `npx atf …` runs itself again under the one found (reexecPlan)
//   lib/node-gate.mjs the first import of every framework script an agent runs (`node {fw}/scripts/run.mjs …` with the
//                     session shell's node): started on an older Node, the script runs itself again the same way
//                     (gateNode), under the pinned Node when there is one, so the agents' commands never change
//   lib/sync.mjs      in a client's workspace whose PATH node is older, the host files name the one found by its
//                     absolute path (the hook commands and the browser server), recorded in the machine-local
//                     NODE_PIN_FILE, which sync keeps out of git (a team commits atf/atf.json; a path is per machine)
// The guard hook itself never runs itself again: it refuses (D-109), and sync pins it.
// findNode() and reexecPlan() are pure apart from the injected calls (exists, readdir, probe, read), so every
// platform's layout is tested on any machine.
import { spawn as spawnChild, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const MIN_NODE = 20;
// the Node.js major a missing install is told to get: the one atf init's .nvmrc names and CI tests on
// (node-version.test.mjs keeps it equal to templates/workspace/_nvmrc)
export const RECOMMENDED_NODE = 24;
// set by bin/atf.mjs on the Node it starts again: the version of the Node it was started on (the PATH's), so
// lib/sync.mjs knows the PATH's node was older
export const REEXEC_ENV = "ATF_NODE_REEXEC";
// and the pid of the process that switched: only its own child still on an older Node is a loop (the session that
// `atf run` opens inherits both, and a shell there may put the old node first again for an `npx atf` the human types)
export const REEXEC_PARENT_ENV = "ATF_NODE_REEXEC_PARENT";
// The machine-local record of the Node.js atf sync pinned, workspace-relative: { "node": { path, version, pinnedAt } }.
// Under atf/, which only a human writes (the guard's workspace-settings rule), since the scripts run what it names; and
// in sync's .gitignore block, since the path is this machine's.
export const NODE_PIN_FILE = "atf/machine.json";
export const NODE_PIN_KEY = "node";

// -> null when version (default: this process's) is MIN_NODE or later, else {detail, fix}
export function nodeProblem(version = process.versions.node) {
  const v = String(version).replace(/^v/, "");
  if (Number(v.split(".")[0]) >= MIN_NODE) return null;
  return {
    detail: `Node.js ${v} is older than ${MIN_NODE}, which Playwright, the browser server and the framework's scripts need`,
    fix: `switch to Node.js ${MIN_NODE} or later (with nvm: nvm use, which reads the workspace's .nvmrc; or put a newer node ahead of the old one in your PATH; https://nodejs.org), check it with node -v, then start a new agent session from that terminal`,
  };
}

// "v24.1.0" | "24.1.0\n" -> "24.1.0" | null
export function parseNodeVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)\s*$/.exec(String(text ?? "").trim());
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}
const parts = (v) => String(v).split(".").map(Number);
// a > b as versions (each "x.y.z")
function newer(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
export const nodeMajor = (version) => parts(version)[0];

// `<file> --version` -> its version, or null when it doesn't answer as a Node.js in time
export function probeNode(file) {
  try {
    const r = spawnSync(file, ["--version"], { encoding: "utf8", timeout: 5000, windowsHide: true, shell: false });
    return r.status === 0 ? parseNodeVersion(r.stdout) : null;
  } catch {
    return null;
  }
}

const listDir = (dir, readdir) => {
  try {
    return readdir(dir);
  } catch {
    return [];
  }
};
// env.PATH under any case of its name (Windows keeps it as Path)
export const pathKey = (env) => Object.keys(env ?? {}).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

// The node the PATH finds first, as a host's `node` command finds it: { path, version (null when it doesn't answer) }
// | null when no PATH folder holds one.
export function pathNode({ env = process.env, platform = process.platform, exists = existsSync, probe = probeNode } = {}) {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  for (const dir of String(env[pathKey(env)] ?? "").split(win ? ";" : ":").filter(Boolean)) {
    const file = p.join(dir, win ? "node.exe" : "node");
    if (exists(file)) return { path: file, version: probe(file) };
  }
  return null;
}

// Where a Node.js may be installed, in the order findNode() prefers among equal versions: [{ path, source }].
function candidates({ env, platform, home, readdir }) {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const exe = win ? "node.exe" : "node";
  const out = [];
  const add = (file, source) => out.push({ path: file, source });
  const each = (dir, source, file) => {
    for (const v of listDir(dir, readdir)) add(file(v), source);
  };
  for (const dir of String(env[pathKey(env)] ?? "").split(win ? ";" : ":").filter(Boolean)) add(p.join(dir, exe), "PATH");
  if (win) {
    const appData = env.APPDATA || p.join(home, "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA || p.join(home, "AppData", "Local");
    const nvmHome = env.NVM_HOME || p.join(appData, "nvm");
    each(nvmHome, "nvm-windows", (v) => p.join(nvmHome, v, exe));
    if (env.NVM_SYMLINK) add(p.join(env.NVM_SYMLINK, exe), "nvm-windows");
    const fnm = env.FNM_DIR || p.join(appData, "fnm");
    each(p.join(fnm, "node-versions"), "fnm", (v) => p.join(fnm, "node-versions", v, "installation", exe));
    const volta = p.join(env.VOLTA_HOME || p.join(localAppData, "Volta"), "tools", "image", "node");
    each(volta, "volta", (v) => p.join(volta, v, exe));
    for (const d of [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean)) add(p.join(d, "nodejs", exe), "installer");
    return out;
  }
  const nvm = p.join(env.NVM_DIR || p.join(home, ".nvm"), "versions", "node");
  each(nvm, "nvm", (v) => p.join(nvm, v, "bin", exe));
  for (const base of [env.FNM_DIR, p.join(home, ".local", "share", "fnm"), p.join(home, "Library", "Application Support", "fnm"), p.join(home, ".fnm")].filter(Boolean))
    each(p.join(base, "node-versions"), "fnm", (v) => p.join(base, "node-versions", v, "installation", "bin", exe));
  const volta = p.join(env.VOLTA_HOME || p.join(home, ".volta"), "tools", "image", "node");
  each(volta, "volta", (v) => p.join(volta, v, "bin", exe));
  const asdf = p.join(env.ASDF_DATA_DIR || p.join(home, ".asdf"), "installs", "nodejs");
  each(asdf, "asdf", (v) => p.join(asdf, v, "bin", exe));
  for (const prefix of ["/opt/homebrew", "/usr/local"]) {
    for (const keg of listDir(p.join(prefix, "opt"), readdir).filter((k) => /^node(@\d+)?$/.test(k))) add(p.join(prefix, "opt", keg, "bin", exe), "Homebrew");
    if (prefix === "/opt/homebrew") add("/opt/homebrew/bin/node", "Homebrew");
  }
  add("/usr/local/bin/node", "system");
  add("/usr/bin/node", "system");
  return out;
}

// The Node.js major a workspace's .nvmrc names ("24", "v24.1.0"), or null (none, or an alias such as lts/*).
export function nvmrcMajor(text) {
  const m = /^v?(\d+)(?:\.\d+){0,2}$/.exec(String(text ?? "").trim().split(/\r?\n/)[0].trim());
  return m ? Number(m[1]) : null;
}

// The Node.js on this machine that is `min` or later that a run should use -> { path, version, source } | null. In
// order of preference: the newest of the major the workspace's .nvmrc names (`nvmrc`, which atf init writes: the
// Node.js the framework is tested on); else the newest of an even major (a release line that becomes LTS); else the
// newest. The candidates: the PATH, the version managers (nvm, fnm, Volta, asdf; nvm-windows on Windows), Homebrew and
// the system folders (Windows: the installer's %ProgramFiles%\nodejs), each existing file probed once
// (`<file> --version`), and the current process when it is new enough (its version is known, so it is never probed).
// Among equal versions the first listed wins, and the current process only when no listed path is as new: its execPath
// is the resolved file (Homebrew's versioned Cellar folder, which an upgrade deletes), while a listed path is the name
// that survives upgrades (/opt/homebrew/opt/node/bin/node).
export function findNode({
  min = MIN_NODE,
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  exists = existsSync,
  readdir = readdirSync,
  probe = probeNode,
  execPath = process.execPath,
  current = process.versions.node,
  nvmrc = null,
} = {}) {
  // 0: the .nvmrc's major, 1: an even (LTS) major, 2: any other
  const tier = (version) => (nodeMajor(version) === nvmrc ? 0 : nodeMajor(version) % 2 === 0 ? 1 : 2);
  let best = null;
  const consider = (c) => {
    if (!c.version || nodeMajor(c.version) < min) return;
    if (!best || tier(c.version) < tier(best.version) || (tier(c.version) === tier(best.version) && newer(c.version, best.version))) best = c;
  };
  const seen = new Set();
  for (const c of candidates({ env, platform, home, readdir })) {
    if (seen.has(c.path)) continue;
    seen.add(c.path);
    // this process's own file: its version is known (an old one is never a candidate)
    if (c.path === execPath) consider({ ...c, version: current });
    else if (exists(c.path)) consider({ ...c, version: probe(c.path) });
  }
  if (execPath && current && !seen.has(execPath)) consider({ path: execPath, version: current, source: "this process" });
  return best;
}

// The one command a human runs to get a Node.js new enough, for this machine.
export function installHint({ env = process.env, platform = process.platform, home = os.homedir(), exists = existsSync } = {}) {
  const p = platform === "win32" ? path.win32 : path.posix;
  if (platform === "win32") return env.NVM_HOME || exists(p.join(env.APPDATA || p.join(home, "AppData", "Roaming"), "nvm")) ? `nvm install ${RECOMMENDED_NODE}` : "winget install OpenJS.NodeJS.LTS";
  if (env.NVM_DIR || exists(p.join(home, ".nvm"))) return `nvm install ${RECOMMENDED_NODE}`;
  if (platform === "darwin") return `brew install node@${RECOMMENDED_NODE}`;
  return `nvm install ${RECOMMENDED_NODE} (https://github.com/nvm-sh/nvm), or your package manager's Node.js ${RECOMMENDED_NODE}`;
}

// What a workspace says about the Node.js to use, read without failing: { pin: NODE_PIN_FILE's "node" record when it
// names a file ({ path, version, … }), else null; nvmrc: its .nvmrc's major, else null }. workspace: null reads nothing.
export function readLocalNode(workspace, { read = (f) => readFileSync(f, "utf8") } = {}) {
  const text = (rel) => {
    try {
      return workspace ? read(path.join(workspace, ...rel.split("/"))) : null;
    } catch {
      return null;
    }
  };
  let pin = null;
  try {
    const raw = text(NODE_PIN_FILE);
    const record = raw === null ? null : JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)?.[NODE_PIN_KEY];
    if (record && typeof record.path === "string" && record.path !== "") pin = record;
  } catch {
    // unreadable: as if there were none (sync reports it)
  }
  return { pin, nvmrc: nvmrcMajor(text(".nvmrc")) };
}

// What bin/atf.mjs and a framework script (gateNode) do about the Node they were started on:
//   null            this Node is MIN_NODE or later: carry on
//   { run, line }   run `run.cmd run.args` with `run.env` instead (the Node atf sync pinned when it still answers as
//                   MIN_NODE or later, else the one findNode prefers; its folder first in PATH so what the command
//                   starts, npm, npx, Playwright and the agent session, runs on it too), after printing `line`
//   { error }       nothing new enough here (or the Node started again is still too old): print it and stop
// argv: process.argv (the script's path, then the CLI's arguments); execArgv: process.execArgv, kept.
// local: readLocalNode's { pin, nvmrc }. where: findNode's and installHint's injections (platform, home, exists,
// readdir, probe, execPath).
export function reexecPlan({ argv = process.argv, execArgv = process.execArgv, version = process.versions.node, env = process.env, pid = process.pid, ppid = process.ppid, find = findNode, local = {}, ...where } = {}) {
  const v = String(version).replace(/^v/, "");
  if (nodeMajor(v) >= MIN_NODE) return null;
  const hint = () => installHint({ env, ...where });
  if (env[REEXEC_PARENT_ENV] && Number(env[REEXEC_PARENT_ENV]) === ppid)
    return { error: `atf: Node.js ${v} is older than ${MIN_NODE}, even after switching to a newer one found on this machine; install Node.js ${RECOMMENDED_NODE}: ${hint()}` };
  const { exists = existsSync, probe = probeNode } = where;
  const pinned = local.pin && exists(local.pin.path) ? probe(local.pin.path) : null;
  const found = pinned && nodeMajor(pinned) >= MIN_NODE ? { path: local.pin.path, version: pinned, source: `pinned in ${NODE_PIN_FILE}` } : find({ env, ...where, current: v, nvmrc: local.nvmrc ?? null });
  if (!found) return { error: `atf: Node.js ${v} is older than ${MIN_NODE}, and no newer Node.js is installed on this machine; install one, then run the command again: ${hint()}` };
  const p = (where.platform ?? process.platform) === "win32" ? path.win32 : path.posix;
  const key = pathKey(env);
  const rest = env[key] ? `${p.delimiter}${env[key]}` : "";
  return {
    line: `atf: using Node.js ${found.version} (${found.source}); your default node is ${v}`,
    run: { cmd: found.path, args: [...execArgv, ...argv.slice(1)], env: { ...env, [key]: `${p.dirname(found.path)}${rest}`, [REEXEC_ENV]: v, [REEXEC_PARENT_ENV]: String(pid) } },
    found,
  };
}

const SIGNALS_PASSED_ON = ["SIGTERM", "SIGHUP"];

// Runs a reexecPlan's `run` with this process's terminal -> Promise<{ code, signal }> once it ends (code 1 when it
// could not start, said on stderr). The terminal sends Ctrl-C to both processes, so this one ignores it and lets the
// child decide; a SIGTERM or SIGHUP sent to this process alone is passed on. spawn and proc are injectable (tests).
export function rerun({ cmd, args, env }, { spawn = spawnChild, proc = process } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: "inherit", env });
    } catch (e) {
      console.error(`atf: ${cmd}: ${e.message}`);
      return resolve({ code: 1, signal: null });
    }
    proc.on("SIGINT", () => {});
    for (const signal of SIGNALS_PASSED_ON) proc.on(signal, () => child.kill(signal));
    child.on("error", (e) => {
      console.error(`atf: ${cmd}: ${e.message}`);
      resolve({ code: 1, signal: null });
    });
    child.on("exit", (code, signal) => resolve({ code, signal }));
  });
}

// The start of every framework script an agent runs (lib/node-gate.mjs, its first import). On MIN_NODE or later: null,
// at once, reading nothing. On an older Node with a newer one installed: the same command again under it (reexecPlan,
// with the workspace's pin and .nvmrc), silently (an agent's output stays the script's own), then this process ends as
// the child did: its exit code, or the signal that ended it raised again. Meanwhile the old Node goes on loading the
// script's other imports, so an error there is swallowed: the child does the work. Nothing newer (or the loop guard):
// the plan's { error } is returned and the script carries on, where run.mjs and run-config.mjs refuse (D-109).
// workspace: the workspace root (roots.mjs workspaceRoot); spawn, proc and reexecPlan's injections: tests.
export async function gateNode({ workspace = null, proc = process, spawn, read, ...where } = {}) {
  if (nodeMajor(String(proc.versions.node)) >= MIN_NODE) return null;
  const plan = reexecPlan({ argv: proc.argv, execArgv: proc.execArgv, version: proc.versions.node, env: proc.env, pid: proc.pid, ppid: proc.ppid, local: readLocalNode(workspace, read ? { read } : {}), ...where });
  if (!plan?.run) return plan;
  proc.on("uncaughtException", () => {});
  const { code, signal } = await rerun(plan.run, { spawn, proc });
  if (signal && proc.platform !== "win32") {
    for (const s of ["SIGINT", ...SIGNALS_PASSED_ON]) proc.removeAllListeners(s);
    try {
      proc.kill(proc.pid, signal);
    } catch {
      // not a signal this platform raises: the exit code below says it
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  proc.exit(code ?? 128 + (os.constants.signals[signal] ?? 0));
  return { code, signal };
}
