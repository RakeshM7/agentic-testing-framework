// Dependency checks (D-064): what each stage needs on this machine, checked before the stage starts instead of failing
// halfway through it. Every check is a pure function of the file system, the environment and (for `target`) one HEAD
// request, so the same list serves `atf` (scripts/doctor.mjs, before a login or a session) and the run
// (`run.mjs doctor <product>`, which records the result in state/doctor.json for `stage … start`).
//
// Groups, and the stages that need them (STAGE_NEEDS):
//   base     Node.js, the framework's own dependencies, and its peer dependency (playwright) in the workspace; the
//            workspace's artifact contract (atf/atf.json "contract") against this code's; for
//            an installed framework, the host files in sync with it (atf check), with the cloud-agent opt-in its
//            setup workflow and the committed files git must not ignore, and with the Claude Code plugin opt-in the
//            plugin's version against the package's and its entry in .claude/settings.json
//   login    the browser the login opens (lib/login.mjs, D-069): the default browser when Chromium-based, else
//            Microsoft Edge, else Google Chrome, else the Chromium build of the framework's Playwright
//   browser  the Playwright MCP server's browser, and its init page (which loads the run's session, D-076)
//   session  the saved session (present, not empty, not expired) and the credentials files the run-config names
//   repo     the product Playwright repo's node_modules and its Chromium builds
//   k6       the k6 binary
//   target   the target (and API hosts) answer an HTTP HEAD
// A check is {id, group, ok, level: "fail"|"warn", detail, fix?, autofix?}. Only an `ok: false, level: "fail"` check
// blocks; a warning is reported and never blocks. `autofix` is an install that scripts/doctor.mjs --fix may run in a
// human's terminal (never run by an agent): npm install, a Playwright browser download, or k6 through the OS's package
// manager (K6_INSTALL).
import { existsSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { INIT_PAGE } from "./browser-tools.mjs";
import { configLocation, ejectedRel, loadConfig, overlayRel } from "./config.mjs";
import { CONTRACT_VERSION, STAGES, UNRECORDED_CONTRACT, contractProblem, frameworkRoot, paths, workspaceContract } from "./contract.mjs";
import { tryReadJson, writeJson } from "./files.mjs";
import { inSandbox, netFetch, networkError, proxyUnsupported } from "./net.mjs";
import { MIN_NODE, NODE_PIN_FILE, nodeProblem, readLocalNode } from "./node-version.mjs";
import { PLUGIN_ID, claudeMode, pluginVersionCheck } from "./provenance.mjs";
import { expandFw, isInstalled } from "./roots.mjs";

export const GROUPS = ["base", "login", "browser", "session", "repo", "k6", "target"];
export const STAGE_NEEDS = {
  knowledge: ["base", "target"],
  "module-knowledge": ["base", "target"],
  "playwright-repo": ["base"],
  explore: ["base", "browser", "session", "target"],
  clarifications: ["base", "browser", "session", "target"],
  "api-discovery": ["base", "session", "target"],
  testcases: ["base"],
  "playwright-ui": ["base", "repo", "session", "target"],
  "playwright-api": ["base", "repo", "session", "target"],
  k6: ["base", "k6", "target"],
  report: ["base"],
};
export const LOGIN_NEEDS = ["base", "login"];
// What this machine needs for any product (doctor.mjs --machine, the VS Code extension's environment checks, D-110): no
// run-config, so no session, product repo or target. k6 is checked too, but only a run with the k6 step needs it.
export const MACHINE_GROUPS = ["base", "login", "browser", "k6"];

const RECORD = "doctor.json";
const slash = (p) => String(p ?? "").replaceAll("\\", "/").replace(/^\.\//, "");

export function groupsFor(stages) {
  return GROUPS.filter((g) => stages.some((s) => STAGE_NEEDS[s]?.includes(g)));
}

// Where Playwright keeps its browsers (Playwright's own rules: PLAYWRIGHT_BROWSERS_PATH, "0" = inside the package).
export function browsersDir(pkgRoot, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const custom = env.PLAYWRIGHT_BROWSERS_PATH;
  if (custom === "0") return path.join(pkgRoot, "node_modules", "playwright-core", ".local-browsers");
  if (custom) return custom;
  if (platform === "win32") return path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "ms-playwright");
  if (platform === "darwin") return path.join(home, "Library", "Caches", "ms-playwright");
  return path.join(env.XDG_CACHE_HOME ?? path.join(home, ".cache"), "ms-playwright");
}

// The browser builds a Playwright install expects and which of them are missing. coreDir: a playwright-core folder.
// -> null when there is no playwright-core there, else {version, missing: [{name, revision, dir}]}
export function browserBuilds(coreDir, names, opts = {}) {
  const spec = tryReadJson(path.join(coreDir, "browsers.json"));
  if (!spec) return null;
  const version = tryReadJson(path.join(coreDir, "package.json"))?.version ?? "unknown";
  const dir = browsersDir(path.resolve(coreDir, "..", ".."), opts);
  const missing = [];
  for (const name of names) {
    const b = spec.browsers?.find((x) => x.name === name);
    if (!b) continue;
    const folder = path.join(dir, `${name.replaceAll("-", "_")}-${b.revision}`);
    if (!existsSync(path.join(folder, "INSTALLATION_COMPLETE"))) missing.push({ name, revision: b.revision, dir: folder });
  }
  return { version, missing };
}

const describeMissing = (missing) => missing.map((m) => `${m.name} build ${m.revision}`).join(" and ");

// The folder of an installed package as Node finds it from `from`: the nearest node_modules/<name> from there up (npm
// workspaces hoist the framework's dependencies into the workspace's node_modules). -> the folder, else null
export function packageDir(name, from) {
  for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
    const d = path.join(dir, "node_modules", ...name.split("/"));
    if (existsSync(path.join(d, "package.json"))) return d;
    if (path.dirname(dir) === dir) return null;
  }
}

// ---- the checks, one function per group --------------------------------------------------------------------------

// The base group: Node.js and the framework's dependencies, the workspace's contract, then, for an installed framework,
// its host files.
async function base(ctx) {
  const out = deps(ctx);
  if (inSandbox(ctx.sys.env)) out.push(sandboxCheck(ctx));
  if (ctx.root) out.push(contractCheck(ctx));
  if (ctx.root && isInstalled(ctx.framework)) out.push(...(await hostFiles(ctx)), ...plugin(ctx));
  return out;
}

// The check runs inside Claude Code's sandbox (D-117): a warning, never a block. The sandbox reaches the network only
// through its proxy (netFetch routes the framework's requests there) and only to the hosts it allows, and it can't
// write the npm cache or the Playwright browsers folder, so the installs fail there and a live run may be refused.
function sandboxCheck({ product }) {
  return {
    id: "sandbox", ok: false, level: "warn",
    detail: "this check runs inside Claude Code's sandbox: installs (npm, Playwright browsers, k6) can't run there, and the target is reached only through the sandbox's proxy, for the hosts it allows",
    fix: `for a live run, turn the sandbox off in the agent session (/sandbox); run the installs in your own terminal: npx atf doctor${product ? ` ${product}` : ""} --fix`,
  };
}

// The Claude Code plugin (atf/atf.json "claude_plugin", docs/packaging.md §3.12, draft P-11), in plugin mode only:
//   plugin-version   the version the plugin recorded (artifacts/.atf-plugin.json, written by its SessionStart hook) must
//                    be the installed package's: another fails, as run.mjs init refuses it; none yet only warns, since
//                    no Claude Code session has started here (provenance.mjs pluginVersionCheck)
//   plugin-enabled   .claude/settings.json enables the plugin for the project (sync writes the entry): a warning, as
//                    a user may enable it in their own settings instead, and host-files already fails on a stale sync
// A bad opt-in is host-files' failure (the sync refuses it), so nothing is said here.
function plugin({ root, framework }) {
  let mode;
  try {
    mode = claudeMode({ workspace: root, framework });
  } catch {
    return [];
  }
  if (!mode.on) return [];
  const version = { id: "plugin-version", ...pluginVersionCheck({ workspace: root, framework }) };
  const settings = tryReadJson(path.join(root, ".claude", "settings.json"));
  const enabled = settings?.enabledPlugins?.[PLUGIN_ID] === true
    ? { id: "plugin-enabled", ok: true, detail: `.claude/settings.json enables the ${PLUGIN_ID} plugin for the project` }
    : { id: "plugin-enabled", ok: true, level: "warn", detail: `.claude/settings.json does not enable the ${PLUGIN_ID} plugin (enabledPlugins["${PLUGIN_ID}"]), so a Claude Code session here may start without the framework's agents`, fix: "npx atf sync (in the workspace) writes it" };
  return [version, enabled];
}

// The workspace's artifact contract against this code's (docs/packaging.md §3.10), as run.mjs init refuses it: a
// workspace a newer package migrated, or one an older package left that needs npx atf migrate. Never autofixed: a
// migration is a human's step.
function contractCheck({ root }) {
  const problem = contractProblem(root);
  if (problem) return { id: "workspace-contract", ok: false, level: "fail", ...problem };
  const { recorded } = workspaceContract(root);
  return { id: "workspace-contract", ok: true, detail: `artifact contract ${CONTRACT_VERSION}${recorded ? "" : ` (not recorded in atf/atf.json, ${UNRECORDED_CONTRACT} assumed)`}` };
}

// The Node.js check: this process's Node, and in a client's workspace the Node.js atf sync pinned for the hooks and the
// browser server when the PATH's node is older (the machine-local NODE_PIN_FILE, lib/sync.mjs; the framework's scripts
// run themselves again under it when an agent starts them on an older Node, lib/node-gate.mjs): reported, and a failure
// when its file is gone (host-files fails on it too; this says which Node).
function nodeCheck({ root, framework, nodeVersion, exists }) {
  const old = nodeProblem(nodeVersion);
  if (old) return { id: "node", ok: false, level: "fail", ...old };
  const pin = root && isInstalled(framework) ? readLocalNode(root).pin : null;
  if (!pin) return { id: "node", ok: true, detail: `Node.js ${nodeVersion}` };
  const pinned = `${NODE_PIN_FILE} pins Node.js ${pin.version} (${pin.path}) for the hooks, the browser server and the scripts`;
  if (!exists(pin.path)) return { id: "node", ok: false, level: "fail", detail: `Node.js ${nodeVersion}; ${pinned}, but that file is gone`, fix: "npx atf sync (in the workspace) finds another" };
  return { id: "node", ok: true, detail: `Node.js ${nodeVersion}; ${pinned}, since your PATH's node is older than ${MIN_NODE}` };
}

// The framework's own dependencies: its package.json, each resolved from the framework root the way Node resolves it
// (D-085). Its peer dependencies (playwright) are the workspace's own install, so they must resolve from the workspace
// root, at the version the framework pins.
function deps({ root, framework, nodeVersion, exists = existsSync }) {
  const out = [];
  out.push(nodeCheck({ root, framework, nodeVersion, exists }));
  const pkg = tryReadJson(path.join(framework, "package.json"));
  if (!pkg) return out;
  const wanted = { ...pkg.dependencies, ...pkg.devDependencies };
  const problems = [];
  const versionProblem = (name, spec, from) => {
    const dir = packageDir(name, from);
    const got = dir && tryReadJson(path.join(dir, "package.json"));
    if (!got) return `${name} is not installed`;
    return /^\d+\.\d+\.\d+$/.test(spec) && got.version !== spec ? `${name} is ${got.version}, package.json pins ${spec}` : null;
  };
  for (const [name, spec] of Object.entries(wanted)) problems.push(versionProblem(name, spec, framework));
  out.push(problems.some(Boolean)
    ? { id: "framework-deps", ok: false, level: "fail", detail: problems.filter(Boolean).join("; "), fix: "npm install (in the repo root)", autofix: { cmd: "npm", args: ["install"], cwd: framework } }
    : { id: "framework-deps", ok: true, detail: `${Object.keys(wanted).length} framework dependencies installed` });
  const peers = Object.entries(pkg.peerDependencies ?? {});
  if (!peers.length || !root) return out;
  const ws = tryReadJson(path.join(root, "package.json"));
  const unlisted = peers.filter(([name]) => !{ ...ws?.dependencies, ...ws?.devDependencies }[name]);
  const peerProblems = peers.map(([name, spec]) => versionProblem(name, spec, root)).filter(Boolean);
  out.push(peerProblems.length
    ? {
      id: "framework-peers",
      ok: false,
      level: "fail",
      detail: `the framework's peer dependencies must resolve from the workspace: ${peerProblems.join("; ")}`,
      ...(unlisted.length
        ? { fix: `npm install --save-dev ${unlisted.map(([n, spec]) => `${n}@${spec}`).join(" ")} (in the workspace)` }
        : { fix: "npm install (in the workspace)", autofix: { cmd: "npm", args: ["install"], cwd: root } }),
    }
    : { id: "framework-peers", ok: true, detail: `${peers.map(([n, spec]) => `${n} ${spec}`).join(", ")} resolve from the workspace` });
  return out;
}

// A client's host files (agents, hooks, MCP config, the .gitignore block) as `atf check` sees them: rendered from the
// installed framework and the workspace's atf/ (packaging §3.6). The postinstall renders them, but not after
// `npm install --ignore-scripts`, nor after a hand edit or a changed overlay; stale hooks or agents are a session that
// doesn't match the package, so it fails. Never autofixed: a human runs the sync. The build is loaded only here, so
// what imports the doctor (run.mjs) doesn't load it in a source checkout.
//
// With the cloud-agent opt-in (atf/atf.json "cloud_agent": true, sync.mjs), two more: the setup workflow GitHub runs
// before the agent starts must install the framework with the registry token (a failure: without it the committed
// guard hook denies every call), and the files the client commits for the agent must not be git-ignored by their own
// lines (a warning: what is ignored never reaches the agent).
async function hostFiles({ root, framework, sys }) {
  const { SETUP_WORKFLOW, setupTemplateRel, sync } = await import("./sync.mjs");
  let r;
  try {
    r = sync({ workspace: root, framework, check: true });
  } catch (e) {
    r = { errors: [e.message], changed: [] };
  }
  if (r.errors.length) return [{ id: "host-files", ok: false, level: "fail", detail: `the host files can't be rendered from the installed framework: ${r.errors.join("; ")}`, fix: "fix that, then run npx atf sync (in the workspace)" }];
  const n = r.changed.length;
  const out = [n
    ? { id: "host-files", ok: false, level: "fail", detail: `${n} host file(s) out of date with the installed framework: ${r.changed.slice(0, 5).join(", ")}${n > 5 ? ` and ${n - 5} more` : ""}`, fix: "npx atf sync (in the workspace)" }
    : { id: "host-files", ok: true, detail: "host files in sync with the installed framework" }];
  if (!r.cloudAgent) return out;
  const [problem] = r.problems;
  out.push(r.created.length
    ? { id: "cloud-agent-setup", ok: false, level: "fail", detail: `${SETUP_WORKFLOW} is missing: the Copilot cloud agent would start without the framework installed, and its guard would deny every tool call`, fix: `npx atf sync (in the workspace) creates it from ${setupTemplateRel(root, framework)}; commit it and merge it to the default branch` }
    : problem
      ? { id: "cloud-agent-setup", ok: false, level: "fail", ...problem }
      : { id: "cloud-agent-setup", ok: true, detail: `${SETUP_WORKFLOW} installs the framework for the Copilot cloud agent` });
  out.push(committedButIgnored({ root, files: r.committed, env: sys?.env }));
  return out;
}

// Which of `files` git would ignore in `root`, whether tracked or not (--no-index: a file a later package version adds
// is new to git), by every ignore source git reads (the client's .gitignore files, info/exclude, a global excludesFile).
// A negation (`!x`) that matches means not ignored. Without git, or outside a repository, nothing to say.
function committedButIgnored({ root, files, env }) {
  const id = "cloud-agent-git";
  let r;
  try {
    r = spawnSync("git", ["check-ignore", "--no-index", "--verbose", "--", ...files], { cwd: root, env, encoding: "utf8", timeout: 15_000 });
  } catch (e) {
    r = { error: e };
  }
  if (r.error || (r.status !== 0 && r.status !== 1))
    return { id, ok: true, detail: `not checked whether git ignores the files the Copilot cloud agent reads: ${r.error ? "git is not available" : "not a git repository"}` };
  // `<source>:<line>:<pattern>\t<path>` per matching path
  const hits = r.stdout.split(/\r?\n/).filter(Boolean).flatMap((l) => {
    const [, source, line, pattern, file] = /^(.*?):(\d+):(.*)\t(.*)$/.exec(l) ?? [];
    return file && !pattern.startsWith("!") ? [{ where: `${source}:${line} (${pattern})`, file }] : [];
  });
  if (!hits.length) return { id, ok: true, detail: `git commits the ${files.length} files the Copilot cloud agent reads` };
  const where = [...new Set(hits.map((h) => h.where))];
  return {
    id,
    ok: true,
    level: "warn",
    detail: `${hits.length} of the files the Copilot cloud agent reads are git-ignored (${where.join(", ")}), so they never reach it: ${hits.slice(0, 3).map((h) => h.file).join(", ")}${hits.length > 3 ? ` and ${hits.length - 3} more` : ""}`,
    fix: "remove or narrow those ignore lines (or add a `!` exception after them), then commit the files",
  };
}

// The login needs a real browser window: some single sign-on providers refuse Playwright's own Chromium, so the login
// opens the OS default browser when it is Chromium-based, else an installed Microsoft Edge, then Google Chrome
// (lib/login.mjs picks the same way, through loginBrowser).
function login({ framework, sys, exists }) {
  const picked = loginBrowser({ sys, exists });
  if (picked.source === "default") return [{ id: "login-browser", ok: true, detail: `the login opens ${picked.name} (your default browser)` }];
  const channel = picked.channel ?? null;
  if (channel === "msedge") return [{ id: "login-browser", ok: true, detail: "the login opens Microsoft Edge" }];
  if (channel === "chrome") return [{ id: "login-browser", ok: true, level: "warn", detail: "Microsoft Edge is not installed: the login opens Google Chrome", fix: "install Microsoft Edge if your identity provider blocks Chrome" }];
  const b = browserBuilds(packageDir("playwright-core", framework) ?? path.join(framework, "node_modules", "playwright-core"), ["chromium"], sys);
  if (!b) return [{ id: "login-browser", ok: false, level: "fail", detail: "neither Microsoft Edge nor Google Chrome is installed, and the framework's Playwright is not installed", fix: "install Microsoft Edge, or npm install (in the repo root)", autofix: { cmd: "npm", args: ["install"], cwd: framework } }];
  if (b.missing.length)
    return [{ id: "login-browser", ok: false, level: "fail", detail: `neither Microsoft Edge nor Google Chrome is installed, and Playwright ${b.version} needs ${describeMissing(b.missing)}, which is not downloaded`, fix: "install Microsoft Edge, or npx playwright install chromium (in the repo root)", autofix: { cmd: "npx", args: ["playwright", "install", "chromium"], cwd: framework } }];
  return [{ id: "login-browser", ok: true, level: "warn", detail: `neither Microsoft Edge nor Google Chrome is installed: the login opens Playwright ${b.version}'s Chromium, which some single sign-on providers block`, fix: "install Microsoft Edge" }];
}

const argValue = (args, flag) => {
  const i = args.findIndex((a) => a === flag || a.startsWith(`${flag}=`));
  if (i < 0) return undefined;
  return args[i].includes("=") ? args[i].slice(flag.length + 1) : args[i + 1];
};

// Locations of a branded browser channel that Playwright MCP launches by default.
export function channelPaths(channel, { env = process.env, platform = process.platform } = {}) {
  const win = (rel) => [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, rel));
  const table = {
    chrome: { win32: win("Google\\Chrome\\Application\\chrome.exe"), darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"], linux: ["/opt/google/chrome/chrome"] },
    msedge: { win32: win("Microsoft\\Edge\\Application\\msedge.exe"), darwin: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"], linux: ["/opt/microsoft/msedge/msedge"] },
  };
  return table[channel]?.[platform === "win32" || platform === "darwin" ? platform : "linux"] ?? null;
}

// The branded browser the login falls back to: "msedge" or "chrome" when installed, else null (Playwright's own Chromium).
export function loginChannel({ sys = {}, exists = existsSync } = {}) {
  return ["msedge", "chrome"].find((ch) => (channelPaths(ch, sys) ?? []).some((p) => exists(p))) ?? null;
}

// Chromium-based browsers the login can open when one is the OS default. Keyed by what each platform reports: macOS
// bundle id (lower-cased), Windows ProgId prefix (lower-cased), Linux desktop file (without ".desktop"). A channel is
// Playwright's own name for Chrome and Edge; the others launch by executable path (win/mac/linux candidate lists).
const win = (env, rel) => [env.ProgramFiles, env["ProgramFiles(x86)"], env.LOCALAPPDATA].filter(Boolean).map((d) => path.join(d, rel));
const CHROMIUM_BROWSERS = [
  { name: "Google Chrome", channel: "chrome", mac: ["com.google.chrome"], win: ["chromehtml"], linux: ["google-chrome", "google-chrome-stable"] },
  { name: "Microsoft Edge", channel: "msedge", mac: ["com.microsoft.edgemac"], win: ["msedgehtm"], linux: ["microsoft-edge", "microsoft-edge-stable"] },
  { name: "Brave", mac: ["com.brave.browser"], win: ["bravehtml"], linux: ["brave-browser", "brave"], paths: { darwin: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"], linux: ["/usr/bin/brave-browser", "/opt/brave.com/brave/brave"], win32: (e) => win(e, "BraveSoftware\\Brave-Browser\\Application\\brave.exe") } },
  { name: "Arc", mac: ["company.thebrowser.browser"], paths: { darwin: ["/Applications/Arc.app/Contents/MacOS/Arc"] } },
  { name: "Vivaldi", mac: ["com.vivaldi.vivaldi"], win: ["vivaldihtm"], linux: ["vivaldi-stable", "vivaldi"], paths: { darwin: ["/Applications/Vivaldi.app/Contents/MacOS/Vivaldi"], linux: ["/usr/bin/vivaldi-stable", "/opt/vivaldi/vivaldi"], win32: (e) => win(e, "Vivaldi\\Application\\vivaldi.exe") } },
  { name: "Chromium", mac: ["org.chromium.chromium"], win: ["chromiumhtm"], linux: ["chromium", "chromium-browser"], paths: { darwin: ["/Applications/Chromium.app/Contents/MacOS/Chromium"], linux: ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"], win32: (e) => win(e, "Chromium\\Application\\chrome.exe") } },
];

// The default https handler as the platform names it (a bundle id, a ProgId or a desktop file), or null. run(cmd, args)
// -> stdout text or null (injectable; the default runs the command with a short timeout).
function runCommand(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { encoding: "utf8", timeout: 4000, windowsHide: true });
    return r.status === 0 ? r.stdout : null;
  } catch {
    return null;
  }
}

// macOS: the `defaults read ... LSHandlers` text is a list of { key = value; } blocks.
export function parseMacHandlers(text) {
  for (const block of String(text ?? "").split(/\}\s*,?/)) {
    const scheme = /LSHandlerURLScheme\s*=\s*"?([A-Za-z0-9.+-]+)"?\s*;/.exec(block)?.[1];
    if (scheme?.toLowerCase() !== "https") continue;
    const role = /LSHandlerRole(?:All|Viewer)\s*=\s*"?([^";\s]+)"?\s*;/.exec(block)?.[1];
    if (role) return role;
  }
  return null;
}

export function defaultBrowserId({ platform = process.platform, run = runCommand } = {}) {
  if (platform === "darwin") return parseMacHandlers(run("defaults", ["read", "com.apple.LaunchServices/com.apple.launchservices.secure", "LSHandlers"]));
  if (platform === "win32") {
    const out = run("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice", "/v", "ProgId"]);
    return /ProgId\s+REG_SZ\s+(\S+)/i.exec(out ?? "")?.[1] ?? null;
  }
  const out = String(run("xdg-settings", ["get", "default-web-browser"]) ?? "").trim();
  return out || null;
}

// Maps a platform's default-browser id to a Chromium browser the login can open: {name, channel} or {name,
// executablePath} (the first candidate path that exists), or null when it is not Chromium-based or not found.
export function chromiumFromId(id, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (!id) return null;
  const key = String(id).toLowerCase().replace(/\.desktop$/, "");
  const os3 = platform === "darwin" ? "mac" : platform === "win32" ? "win" : "linux";
  const entry = CHROMIUM_BROWSERS.find((b) => (b[os3] ?? []).some((m) => (os3 === "win" ? key.startsWith(m) : key === m)));
  if (!entry) return null;
  if (entry.channel) return (channelPaths(entry.channel, { env, platform }) ?? []).some((p) => exists(p)) ? { name: entry.name, channel: entry.channel } : null;
  const list = entry.paths?.[platform === "win32" || platform === "darwin" ? platform : "linux"];
  const candidates = typeof list === "function" ? list(env) : (list ?? []);
  const found = candidates.find((p) => exists(p));
  return found ? { name: entry.name, executablePath: found } : null;
}

// The browser the login opens: the OS default when it is Chromium-based, else Edge, Chrome, then Playwright's Chromium.
// -> {name, channel?, executablePath?, source: "default" | "fallback"}
// A caller that passes its own `sys.platform` (a test, or a faked machine) never reads the real OS default unless it
// also passes `run`: the detection is of the real machine only when nothing is faked.
export function loginBrowser({ sys = {}, exists = existsSync, run } = {}) {
  const platform = sys.platform ?? process.platform;
  const env = sys.env ?? process.env;
  const runner = run ?? (sys.platform ? () => null : runCommand);
  const def = chromiumFromId(defaultBrowserId({ platform, run: runner }), { platform, env, exists });
  if (def) return { ...def, source: "default" };
  const channel = loginChannel({ sys, exists });
  return { name: channel === "msedge" ? "Microsoft Edge" : channel === "chrome" ? "Google Chrome" : "Playwright's Chromium", ...(channel ? { channel } : {}), source: "fallback" };
}

// The playwright-core of an npx-cached package@version (Playwright MCP runs through npx -y).
export function npxCore(pkgName, version, { env = process.env, platform = process.platform, home = os.homedir() } = {}) {
  const cache = env.npm_config_cache ?? (platform === "win32" ? path.join(env.LOCALAPPDATA ?? path.join(home, "AppData", "Local"), "npm-cache") : path.join(home, ".npm"));
  const npx = path.join(cache, "_npx");
  if (!existsSync(npx)) return null;
  for (const h of readdirSync(npx)) {
    const nm = path.join(npx, h, "node_modules");
    if (tryReadJson(path.join(nm, ...pkgName.split("/"), "package.json"))?.version !== version) continue;
    for (const core of [path.join(nm, ...pkgName.split("/"), "node_modules", "playwright-core"), path.join(nm, "playwright-core")])
      if (existsSync(path.join(core, "browsers.json"))) return core;
  }
  return null;
}

// The command that renders the host files again after a config change: a client's workspace syncs from the installed
// package (packaging §3.3; npm run build-agents is the framework's own script, absent there), a source checkout builds.
const rebuildCommand = (framework) => (isInstalled(framework) ? "npx atf sync (in the workspace)" : "npm run build-agents");

// Where the browser server's config comes from (named, from: for the details) and where a person changes it (edit). A
// source checkout edits its own config/mcp.yaml. Installed, that copy sits inside node_modules (read-only, replaced on
// every install), so a client edits the workspace's (D-088, lib/config.mjs): the ejected atf/config/mcp.yaml when there
// is one, else the overlay atf/mcp.yaml (created if need be), merged over the package's copy key by key, where a list
// such as `args` replaces the package's whole list. The init page then goes in as `{fw}/…`, which the sync expands to
// the package's path; the bare path would name a file in the workspace that isn't there.
function mcpPlace(root, framework) {
  if (!isInstalled(framework)) return { named: "config/mcp.yaml", from: "config/mcp.yaml", edit: "config/mcp.yaml", initPage: INIT_PAGE };
  const { source, files } = configLocation("mcp.yaml", { framework, workspace: root });
  const edit = source === "ejected"
    ? `${ejectedRel("mcp.yaml")} (your ejected copy)`
    : `${overlayRel("mcp.yaml")} (an overlay of the package's config/mcp.yaml: a list such as args replaces the package's whole list)`;
  const list = files.join(" + ");
  return { named: `the effective mcp.yaml (${list})`, from: `mcp.yaml: ${list}`, edit, initPage: `{fw}/${INIT_PAGE}` };
}

function browser({ root, framework, cfg, sys, exists }) {
  const out = [];
  const rebuild = rebuildCommand(framework);
  const place = mcpPlace(root, framework);
  let mcp = null;
  try {
    mcp = loadConfig("mcp.yaml", { framework, workspace: root });
  } catch {}
  const server = mcp?.servers?.[mcp?.browser_server];
  if (!server) return [{ id: "mcp-browser", ok: false, level: "fail", detail: `${place.named} names no browser_server`, fix: `define the browser server in ${place.edit}, then ${rebuild}` }];
  const args = (server.args ?? []).map(String);
  const pkgArg = args.find((a) => /^@playwright\/mcp(@|$)/.test(a));
  const pkgVersion = pkgArg?.split("@")[2];
  const channel = argValue(args, "--browser") ?? "chrome";

  const places = channelPaths(channel, sys);
  if (places) {
    const found = places.find((p) => exists(p));
    out.push(found
      ? { id: "mcp-browser", ok: true, detail: `the browser server uses ${channel}: ${found}` }
      : { id: "mcp-browser", ok: false, level: "fail", detail: `the browser server (${place.from}) launches ${channel}, which is not installed here`, fix: `install ${channel === "chrome" ? "Google Chrome" : "Microsoft Edge"}, or npx playwright install ${channel}` });
  } else {
    const core = pkgVersion ? npxCore("@playwright/mcp", pkgVersion, sys) : null;
    const name = channel === "chromium" ? ["chromium"] : [channel];
    const b = core ? browserBuilds(core, name, sys) : null;
    if (!b) out.push({ id: "mcp-browser", ok: true, level: "warn", detail: `cannot tell which ${channel} build @playwright/mcp${pkgVersion ? `@${pkgVersion}` : ""} needs until it has run once`, fix: "start the session once; if the browser tools report a missing browser, run their browser_install tool" });
    else if (b.missing.length) out.push({ id: "mcp-browser", ok: false, level: "fail", detail: `@playwright/mcp@${pkgVersion} (Playwright ${b.version}) needs ${describeMissing(b.missing)}, which is not downloaded`, fix: `npx -y playwright@${b.version} install ${channel}`, autofix: { cmd: "npx", args: ["-y", `playwright@${b.version}`, "install", channel], cwd: root } });
    else out.push({ id: "mcp-browser", ok: true, detail: `@playwright/mcp@${pkgVersion}: ${channel} is installed` });
  }

  // D-076: the framework's init page loads the run's session and guards readonly writes; a --storage-state would load
  // one product's session for every product
  const auth = cfg.authorizations ?? {};
  const fixMcp = `in ${place.edit}, then run ${rebuild} and restart the agent session`;
  // as config/mcp.yaml writes it: `{fw}/` before the framework's path (D-085), or the bare path in a same-root repo
  const initPage = argValue(args, "--init-page") ?? args.find((a) => a.startsWith("--init-page="))?.slice("--init-page=".length);
  if (slash(initPage)?.replace(/^\{fw\}\//, "") !== INIT_PAGE)
    out.push({ id: "mcp-session", ok: false, level: "fail", detail: `the browser server does not run the framework's init page (--init-page ${INIT_PAGE}), which loads the run's session and aborts every write in a readonly run`, fix: `add "--init-page", "${place.initPage}" to the browser server's args ${fixMcp}` });
  else if (argValue(args, "--storage-state"))
    out.push({ id: "mcp-session", ok: false, level: "fail", detail: `the browser server also starts from --storage-state ${slash(argValue(args, "--storage-state"))}, one product's session for every product`, fix: `remove --storage-state (the init page loads this run's session) ${fixMcp}` });
  else if (auth.authenticated_crawl) out.push({ id: "mcp-session", ok: true, detail: `the init page loads ${slash(auth.session_state_file)} into every new browser` });
  else out.push({ id: "mcp-session", ok: true, detail: "no login: the browser server starts logged out" });
  return out;
}

const hostOf = (u) => {
  try {
    return new URL(u).hostname;
  } catch {
    return null;
  }
};
const cookieMatches = (domain, host) => {
  const d = String(domain ?? "").replace(/^\./, "").toLowerCase();
  return !!d && (host === d || host.endsWith(`.${d}`));
};

// The saved session passes when it is present, readable and not empty (D-069). A single sign-on login often leaves no
// cookie on the target's own host (the session sits with the identity provider, or in local storage), so a missing
// target cookie only warns: the browser confirms the login when a stage opens the target, and a sign-in page there
// sends the human back to the login. Expiry still fails, since it is certain: every cookie for the target, or every
// cookie in the file, has expired.
function session({ root, cfg, now, product }) {
  const out = [];
  const auth = cfg.authorizations ?? {};
  const relogin = `npx atf login ${product}`;
  if (auth.authenticated_crawl) {
    const file = path.resolve(root, auth.session_state_file ?? "");
    const state = auth.session_state_file ? tryReadJson(file) : null;
    if (!state) out.push({ id: "session", ok: false, level: "fail", detail: `the saved session ${slash(auth.session_state_file) || "(none set)"} is missing or unreadable`, fix: relogin });
    else {
      const host = hostOf(cfg.target?.url) ?? "";
      const t = now / 1000;
      const liveOf = (cs) => cs.filter((c) => !(c.expires > 0) || c.expires > t);
      const all = state.cookies ?? [];
      const cookies = all.filter((c) => cookieMatches(c.domain, host));
      const live = liveOf(cookies);
      const stored = (state.origins ?? []).some((o) => (o.localStorage ?? []).length);
      if (!all.length && !stored) out.push({ id: "session", ok: false, level: "fail", detail: `the saved session ${slash(auth.session_state_file)} is empty (no cookie, no local storage): the login did not finish`, fix: relogin });
      else if (cookies.length && !live.length) out.push({ id: "session", ok: false, level: "fail", detail: `every cookie for ${host} in the saved session has expired`, fix: relogin });
      else if (all.length && !liveOf(all).length) out.push({ id: "session", ok: false, level: "fail", detail: "every cookie in the saved session has expired", fix: relogin });
      else if (!cookies.length) out.push({ id: "session", ok: true, level: "warn", detail: `nothing to fix: the saved session has no cookie for ${host} (usual after a single sign-on login); the login is confirmed when a stage opens the target`, fix: `only if a stage meets a sign-in page, ${relogin}` });
      else {
        const ends = live.filter((c) => c.expires > 0).map((c) => c.expires).sort((a, b) => a - b)[0];
        const soon = ends && ends - t < 24 * 3600;
        const when = ends ? new Date(ends * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC" : null;
        out.push(soon
          ? { id: "session", ok: true, level: "warn", detail: `the saved session's first cookie for ${host} expires ${when}`, fix: `${relogin} before a long stage` }
          : { id: "session", ok: true, detail: `saved session for ${host}${when ? ` (first cookie expires ${when})` : ""}` });
      }
    }
  } else out.push({ id: "session", ok: true, detail: "authenticated_crawl is off: no saved session needed" });
  const files = [auth.credentials_file, ...(auth.identities ?? []).flatMap((i) => [i.credentials_file, i.session_state_file])].filter(Boolean);
  const absent = files.filter((f) => !existsSync(path.resolve(root, f)));
  if (absent.length) out.push({ id: "credentials", ok: false, level: "fail", detail: `the run-config names files that do not exist: ${absent.map(slash).join(", ")}`, fix: "create them (a .env-style file or a saved session), or remove them from the run-config" });
  else if (files.length) out.push({ id: "credentials", ok: true, detail: `${files.length} credential/session file(s) present` });
  return out;
}

function repo({ root, product, sys }) {
  const pw = paths(product, root).pwProject;
  const rel = slash(path.relative(root, pw));
  const install = { fix: expandFw(`node {fw}/scripts/foundation.mjs install ${product} (or in ${rel}: npm install, then npx playwright install chromium)`), autofix: { steps: [{ cmd: "npm", args: ["install"], cwd: pw }, { cmd: "npx", args: ["playwright", "install", "chromium"], cwd: pw }] } };
  // Not built yet is not a problem: the run's playwright-repo stage builds and installs it. `pending` makes
  // doctorStatus ask for a fresh check once it exists.
  if (!existsSync(path.join(pw, "package.json"))) return [{ id: "repo-deps", ok: true, level: "warn", pending: true, detail: `${rel} is not built yet (the playwright-repo stage builds and installs it; checked again after that)` }];
  if (!existsSync(path.join(pw, "node_modules", "@playwright", "test", "package.json"))) return [{ id: "repo-deps", ok: false, level: "fail", detail: `${rel} has no node_modules (@playwright/test is not installed)`, ...install }];
  const b = browserBuilds(path.join(pw, "node_modules", "playwright-core"), ["chromium", "chromium-headless-shell"], sys);
  if (!b) return [{ id: "repo-deps", ok: false, level: "fail", detail: `${rel} has no playwright-core`, ...install }];
  if (b.missing.length) return [{ id: "repo-browsers", ok: false, level: "fail", detail: `${rel} runs Playwright ${b.version}, which needs ${describeMissing(b.missing)}, not downloaded`, ...install }];
  return [{ id: "repo-browsers", ok: true, detail: `${rel}: Playwright ${b.version} and its Chromium builds are installed` }];
}

// k6's own installer per OS (https://grafana.com/docs/k6/latest/set-up/install-k6/), offered as an autofix where the
// OS has a package manager that installs without sudo: winget on Windows, Homebrew on macOS. Linux needs a package
// repository and sudo, so it only gets the link.
export const K6_INSTALL = {
  win32: { manager: "winget", cmd: "winget", args: ["install", "k6", "--source", "winget", "--accept-package-agreements", "--accept-source-agreements"] },
  darwin: { manager: "brew", cmd: "brew", args: ["install", "k6"] },
};
const K6_DOCS = "https://grafana.com/docs/k6/latest/set-up/install-k6/";

// Where the installers put k6, to tell "not installed" from "installed, but this terminal's PATH predates it".
export function k6Paths({ env = process.env, platform = process.platform } = {}) {
  if (platform === "win32") return [env.ProgramFiles, env["ProgramFiles(x86)"]].filter(Boolean).map((d) => path.join(d, "k6", "k6.exe"));
  if (platform === "darwin") return ["/opt/homebrew/bin/k6", "/usr/local/bin/k6"];
  return ["/usr/bin/k6", "/usr/local/bin/k6", "/snap/bin/k6"];
}

function k6({ which, exists, sys }) {
  if (which("k6", ["version"])) return [{ id: "k6", ok: true, detail: "k6 is on PATH" }];
  const found = k6Paths(sys).find((p) => exists(p));
  if (found) return [{ id: "k6", ok: false, level: "fail", detail: `k6 is installed (${found}) but not on this terminal's PATH`, fix: "open a new terminal (an install updates PATH for new terminals only), then run the command again" }];
  const how = K6_INSTALL[sys.platform];
  if (how && which(how.cmd, ["--version"]))
    return [{ id: "k6", ok: false, level: "fail", detail: "k6 is not installed", fix: `${how.cmd} ${how.args.join(" ")}, then open a new terminal`, autofix: { cmd: how.cmd, args: how.args, cwd: process.cwd(), newTerminal: true } }];
  const fix = how ? `install ${how.manager}, then ${how.cmd} ${how.args.join(" ")}; or see ${K6_DOCS}` : `install k6 with your package manager: ${K6_DOCS}`;
  return [{ id: "k6", ok: false, level: "fail", detail: "k6 is not installed", fix: `${fix}, then open a new terminal` }];
}

async function target({ cfg, fetchImpl, sys, httpApi }) {
  const urls = [cfg.target?.url, ...(cfg.target?.api_urls ?? [])].filter(Boolean);
  const out = [];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      out.push({ id: `target:${url}`, ok: true, detail: `${url} answers (HTTP ${res.status})` });
    } catch (e) {
      out.push({ id: `target:${url}`, ok: false, level: "fail", ...unreachable(url, networkError(e), sys.env, httpApi) });
    }
  }
  return out;
}

// Why a target didn't answer, and its fix (D-117): the sandbox's or the network's proxy refused the host, a proxy is
// set that this Node.js can't use, the sandbox without a proxy, or the host itself.
export function unreachable(url, err, env = process.env, httpApi = http) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    host = url;
  }
  const again = "then run the check again";
  if (err.proxyStatus && inSandbox(env))
    return { detail: `${url}: Claude Code's sandbox does not allow ${host} (its proxy answered ${err.proxyStatus})`, fix: `allow ${host} in the agent session's sandbox (/sandbox), or turn the sandbox off for a live run, ${again}` };
  if (err.proxyStatus)
    return { detail: `${url}: the network proxy (HTTPS_PROXY) refused ${host} (it answered ${err.proxyStatus})`, fix: `ask your network team to allow ${host} through the proxy, or add it to NO_PROXY if it is reachable directly, ${again}` };
  if (proxyUnsupported(env, httpApi))
    return { detail: `${url} does not answer (${err.message}): a network proxy is set (HTTPS_PROXY), but Node.js ${process.versions.node} can't send requests through it`, fix: `use Node.js 24 or newer, or start the command with NODE_USE_ENV_PROXY=1, ${again}` };
  if (inSandbox(env))
    return { detail: `${url} does not answer (${err.message}) from inside Claude Code's sandbox`, fix: `allow ${host} in the agent session's sandbox (/sandbox), or turn the sandbox off for a live run; npx atf doctor in your own terminal shows whether the host itself answers` };
  return { detail: `${url} does not answer: ${err.message}`, fix: `check the URL in the run-config, your network or VPN, ${again}` };
}

const CHECKS = { base, login, browser, session, repo, k6, target };

// Whether `cmd args` runs and exits 0 (args: the command's own version flag).
const defaultWhich = (cmd, args = ["--version"]) => {
  try {
    return spawnSync(cmd, args, { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
};

// cfg: a validated run-config (normalized). root: the workspace; framework: the framework root (D-085), whose
// dependencies and browser config are checked. -> [{group, id, ok, level?, detail, fix?, autofix?}]
export async function runChecks(cfg, groups, { root, framework = frameworkRoot, env = process.env, platform = process.platform, home = os.homedir(), nodeVersion = process.versions.node, now = Date.now(), fetchImpl = netFetch, httpApi = http, which = defaultWhich, exists = existsSync } = {}) {
  const ctx = { root, framework, cfg, product: cfg.product, nodeVersion, now, fetchImpl, httpApi, which, exists, sys: { env, platform, home } };
  const out = [];
  for (const g of GROUPS.filter((x) => groups.includes(x))) for (const c of await CHECKS[g](ctx)) out.push({ group: g, level: c.ok ? undefined : "fail", ...c });
  return out;
}

export const failures = (checks, groups = GROUPS) => checks.filter((c) => !c.ok && c.level === "fail" && groups.includes(c.group));

// ---- the run's record (state/doctor.json), cleared by run.mjs init and --resume like the guard check -----------

export function recordDoctor(product, root, { groups, checks }) {
  const file = path.join(paths(product, root).state, RECORD);
  writeJson(file, { at: new Date().toISOString(), groups, checks: checks.map(({ autofix, ...c }) => c) });
}

export function clearDoctor(product, root) {
  rmSync(path.join(paths(product, root).state, RECORD), { force: true });
}

// -> { ready, reason? } for starting `stage`
export function doctorStatus(product, stage, root) {
  const rec = tryReadJson(path.join(paths(product, root).state, RECORD));
  const rerun = expandFw(`node {fw}/scripts/run.mjs doctor ${product}`);
  if (!rec) return { ready: false, reason: `the dependency check has not run in this session: run \`${rerun}\`` };
  const needs = STAGE_NEEDS[stage] ?? [];
  const unchecked = needs.filter((g) => !rec.groups?.includes(g));
  if (unchecked.length) return { ready: false, reason: `the dependency check did not cover ${unchecked.join(", ")}: run \`${rerun}\`` };
  const stale = (rec.checks ?? []).filter((c) => c.pending && needs.includes(c.group) && c.group === "repo" && existsSync(path.join(paths(product, root).pwProject, "package.json")));
  if (stale.length) return { ready: false, reason: `the product's Playwright repo was built after the last dependency check: run \`${rerun}\` again` };
  const bad = failures(rec.checks ?? [], needs);
  if (!bad.length) return { ready: true };
  return { ready: false, reason: `${stage} needs what this machine is missing (a human fixes these, then runs \`${rerun}\` again): ${bad.map((c) => `${c.detail}${c.fix ? ` -> fix: ${c.fix}` : ""}`).join("; ")}` };
}

// Stages with no entry in STAGE_NEEDS would start unchecked; the test suite keeps the two lists equal.
export const uncoveredStages = () => Object.keys(STAGES).filter((s) => !STAGE_NEEDS[s]);
