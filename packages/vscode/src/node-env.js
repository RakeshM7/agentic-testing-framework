// The Node.js an atf session runs on (D-109, D-110). The framework refuses a session on a Node older than NODE_MIN, and
// the session is the agent terminal's: the agent CLI, the guard hooks, the browser server and the tests all run the
// `node` that terminal finds, which can differ from the one VS Code itself finds (a shell's startup files put
// Homebrew's node@18 ahead of nvm's Node 24, say). So the extension can find both, and pin one:
//   - findNodes(): every Node.js on this machine it can see (nvm, Volta, fnm, Homebrew, the usual install folders, the
//     PATH), each with its version, for the human to pick;
//   - terminalNode(): the `node` a new terminal finds, from a login shell started the way VS Code starts one;
//   - pinPrefix(): with atf.nodePath set, what goes before `npx --no atf …` on the agent terminal's command line so the
//     pinned Node's folder leads that command's PATH. On the command line, not the terminal's environment: the shell's
//     startup files run after the environment is applied and could put the old Node first again.
// The extension never edits a shell's startup files, nvm's default or the system's Node.
//
// Pure apart from the spawn and file-system calls, which are injected; tested in test/node-env.test.mjs.
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, readdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// The framework's minimum (packages/core/scripts/lib/node-version.mjs MIN_NODE; test/node-env.test.mjs keeps them equal).
export const NODE_MIN = 20;

// "v24.19.0" | "24.19.0" -> { version: "24.19.0", major: 24 } | null
export function parseVersion(text) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)\s*$/.exec(String(text ?? "").trim());
  return m ? { version: `${m[1]}.${m[2]}.${m[3]}`, major: Number(m[1]) } : null;
}

const listDir = (dir, readdir) => {
  try {
    return readdir(dir);
  } catch {
    return [];
  }
};

// Where a Node.js may be installed, as [{ path, source }]: the version managers' folders, Homebrew's kegs, the usual
// install folders, then each PATH entry. Only paths that exist; the first source named for a path wins.
export function nodeCandidates({ platform = process.platform, env = process.env, home = os.homedir(), exists = existsSync, readdir = readdirSync } = {}) {
  const win = platform === "win32";
  const p = win ? path.win32 : path.posix;
  const exe = win ? "node.exe" : "node";
  const out = [];
  const add = (file, source) => {
    if (file && exists(file) && !out.some((c) => c.path === file)) out.push({ path: file, source });
  };
  const each = (dir, source, sub = (v) => p.join(dir, v, ...(win ? [] : ["bin"]), exe)) => {
    for (const v of listDir(dir, readdir)) add(sub(v), source);
  };
  if (win) {
    each(env.NVM_HOME || p.join(env.APPDATA ?? p.join(home, "AppData", "Roaming"), "nvm"), "nvm-windows");
    each(p.join(env.LOCALAPPDATA ?? p.join(home, "AppData", "Local"), "Volta", "tools", "image", "node"), "Volta");
    each(p.join(env.APPDATA ?? p.join(home, "AppData", "Roaming"), "fnm", "node-versions"), "fnm", (v) => p.join(env.APPDATA ?? p.join(home, "AppData", "Roaming"), "fnm", "node-versions", v, "installation", exe));
    for (const d of [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean)) add(p.join(d, "nodejs", exe), "installer");
  } else {
    each(p.join(env.NVM_DIR || p.join(home, ".nvm"), "versions", "node"), "nvm");
    each(p.join(env.VOLTA_HOME || p.join(home, ".volta"), "tools", "image", "node"), "Volta");
    for (const base of [p.join(home, ".local", "share", "fnm"), p.join(home, "Library", "Application Support", "fnm"), env.FNM_DIR].filter(Boolean))
      each(p.join(base, "node-versions"), "fnm", (v) => p.join(base, "node-versions", v, "installation", "bin", exe));
    for (const prefix of ["/opt/homebrew", "/usr/local"])
      for (const keg of listDir(p.join(prefix, "opt"), readdir).filter((k) => /^node(@\d+)?$/.test(k))) add(p.join(prefix, "opt", keg, "bin", exe), `Homebrew ${keg}`);
    for (const f of ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"]) add(f, "system");
  }
  const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  for (const dir of String(env[pathKey] ?? "").split(win ? ";" : ":").filter(Boolean)) add(p.join(dir, exe), "PATH");
  return out;
}

// The version a Node.js reports (`<file> -p process.versions.node`), or null when it does not answer in time.
export function probeNode(file, { spawn = nodeSpawn, timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(file, ["-p", "process.versions.node"], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true, shell: false });
    } catch {
      return resolve(null);
    }
    const timer = setTimeout(() => child.kill?.(), timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.on("error", () => (clearTimeout(timer), resolve(null)));
    child.on("close", () => (clearTimeout(timer), resolve(parseVersion(out))));
  });
}

// Every Node.js found, newest first, one per real file: [{ path, version, major, source }].
export async function findNodes({ spawn, realpath = realpathSync, ...opts } = {}) {
  const seen = new Set();
  const out = [];
  for (const c of nodeCandidates(opts)) {
    let real = c.path;
    try {
      real = realpath(c.path);
    } catch {
      // keep the path as found
    }
    if (seen.has(real)) continue;
    seen.add(real);
    const v = await probeNode(c.path, { spawn });
    if (v) out.push({ path: c.path, ...v, source: c.source });
  }
  return out.sort((a, b) => b.major - a.major || b.version.localeCompare(a.version, undefined, { numeric: true }));
}

// The script a login shell runs to say which `node` it finds: one marked line, so whatever the startup files print
// is ignored. POSIX sh, bash, zsh and fish (3.4+) all read it.
export const TERMINAL_MARK = "__ATF_NODE__";
export const TERMINAL_PROBE = `printf '\\n${TERMINAL_MARK}%s|%s\\n' "$(command -v node 2>/dev/null)" "$(node -p process.versions.node 2>/dev/null)"`;

// The probe's answer: { path, version, major } | { missing: true } when the shell finds no node | null when unreadable.
export function parseTerminalProbe(text) {
  const line = String(text ?? "").split(/\r?\n/).reverse().find((l) => l.startsWith(TERMINAL_MARK));
  if (line === undefined) return null;
  const [file, version] = line.slice(TERMINAL_MARK.length).split("|");
  const v = parseVersion(version);
  return file && v ? { path: file.trim(), ...v } : { missing: true };
}

// The `node` a new terminal finds. POSIX: VS Code's terminal shell, started as an interactive login shell (`-ilc`) so
// it reads the same startup files a terminal does. Windows: the first node.exe on VS Code's own PATH, which its
// terminals inherit. -> { path, version, major } | { missing: true } | { error }
export async function terminalNode({ shell, platform = process.platform, env = process.env, spawn = nodeSpawn, exists = existsSync, timeoutMs = 15_000 } = {}) {
  if (platform === "win32") {
    const first = nodeCandidates({ platform, env, exists, readdir: () => [] }).find((c) => c.source === "PATH");
    if (!first) return { missing: true };
    const v = await probeNode(first.path, { spawn });
    return v ? { path: first.path, ...v } : { error: `${first.path} did not answer` };
  }
  const sh = shell || env.SHELL || "/bin/sh";
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(sh, ["-ilc", TERMINAL_PROBE], { stdio: ["ignore", "pipe", "ignore"], env, windowsHide: true, shell: false, detached: false });
    } catch (e) {
      return resolve({ error: `${sh}: ${e.message}` });
    }
    const timer = setTimeout(() => child.kill?.(), timeoutMs);
    child.stdout?.on("data", (d) => (out += d));
    child.on("error", (e) => (clearTimeout(timer), resolve({ error: `${sh}: ${e.message}` })));
    child.on("close", () => {
      clearTimeout(timer);
      resolve(parseTerminalProbe(out) ?? { error: `${path.basename(sh)} did not say which node it finds` });
    });
  });
}

// The command-line prefix that puts nodeDir first on the PATH of the command that follows, for a shell kind (cli.js
// shellKind). A folder that can't be quoted safely for that shell is refused, never mangled.
export function pinPrefix(nodeDir, kind) {
  const dir = String(nodeDir ?? "");
  if (!dir || /[\r\n\0]/.test(dir)) throw new Error(`atf: can't pin the Node.js folder ${JSON.stringify(dir)}`);
  if (kind === "posix") return `PATH='${dir.replaceAll("'", `'\\''`)}':"$PATH" `;
  if (kind === "powershell") {
    if (dir.includes('"')) throw new Error(`atf: can't pass ${JSON.stringify(dir)} to PowerShell safely`);
    return `$env:PATH = '${dir.replaceAll("'", "''")};' + $env:PATH; `;
  }
  if (kind === "cmd") {
    if (/["%]/.test(dir)) throw new Error(`atf: can't pass ${JSON.stringify(dir)} to cmd.exe safely`);
    return `set "PATH=${dir};%PATH%" && `;
  }
  throw new Error(`atf: unknown shell kind '${kind}'`);
}

// The Node a session would get, as the environment check shows it: the pin (atf.nodePath, probed), else the terminal's.
// -> { source: "pinned" | "terminal", path?, version?, major?, ok, detail, missing?, error? }
export function sessionNodeRow(found, { pinned = false } = {}) {
  const where = pinned ? "pinned (atf.nodePath)" : "in a new terminal";
  if (!found || found.error) return { source: pinned ? "pinned" : "terminal", ok: false, detail: `Node.js ${where}: can't tell (${found?.error ?? "no answer"})` };
  if (found.missing) return { source: pinned ? "pinned" : "terminal", ok: false, missing: true, detail: `Node.js ${where}: none found` };
  const ok = found.major >= NODE_MIN;
  return { source: pinned ? "pinned" : "terminal", ...found, ok, detail: `Node.js ${found.version} ${where}${ok ? "" : `, older than ${NODE_MIN}`}: ${found.path}` };
}
