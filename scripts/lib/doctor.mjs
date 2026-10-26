// Dependency checks (D-064): what each stage needs on this machine, checked before the stage starts instead of failing
// halfway through it. Every check is a pure function of the file system, the environment and (for `target`) one HEAD
// request, so the same list serves `make` (scripts/doctor.mjs, before a login or a session) and the run
// (`run.mjs doctor <product>`, which records the result in state/doctor.json for `stage … start`).
//
// Groups, and the stages that need them (STAGE_NEEDS):
//   base     Node.js, the framework's own dependencies, and its peer dependency (playwright) in the workspace
//   login    the browser the login opens (lib/login.mjs, D-069): Microsoft Edge, else Google Chrome, else the
//            Chromium build of the framework's Playwright
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
import os from "node:os";
import path from "node:path";
import { INIT_PAGE } from "./browser-tools.mjs";
import { loadConfig } from "./config.mjs";
import { STAGES, frameworkRoot, paths } from "./contract.mjs";
import { tryReadJson, writeJson } from "./files.mjs";
import { expandFw } from "./roots.mjs";

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
export const MIN_NODE = 20;

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

// The framework's own dependencies: its package.json, each resolved from the framework root the way Node resolves it
// (D-085). Its peer dependencies (playwright) are the workspace's own install, so they must resolve from the workspace
// root, at the version the framework pins.
function base({ root, framework, nodeVersion }) {
  const out = [];
  const major = Number(String(nodeVersion).split(".")[0]);
  out.push(major >= MIN_NODE
    ? { id: "node", ok: true, detail: `Node.js ${nodeVersion}` }
    : { id: "node", ok: false, level: "fail", detail: `Node.js ${nodeVersion} is older than ${MIN_NODE}`, fix: `install Node.js ${MIN_NODE} or later (https://nodejs.org)` });
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

// The login needs a real browser window: some single sign-on providers refuse Playwright's own Chromium, so the login
// prefers an installed Microsoft Edge, then Google Chrome (lib/login.mjs picks the same way).
function login({ framework, sys, exists }) {
  const channel = loginChannel({ sys, exists });
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

// The branded browser the login opens: "msedge" or "chrome" when installed, else null (Playwright's own Chromium).
export function loginChannel({ sys = {}, exists = existsSync } = {}) {
  return ["msedge", "chrome"].find((ch) => (channelPaths(ch, sys) ?? []).some((p) => exists(p))) ?? null;
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

function browser({ root, framework, cfg, sys, exists }) {
  const out = [];
  let mcp = null;
  try {
    mcp = loadConfig("mcp.yaml", { framework });
  } catch {}
  const server = mcp?.servers?.[mcp?.browser_server];
  if (!server) return [{ id: "mcp-browser", ok: false, level: "fail", detail: "config/mcp.yaml names no browser_server", fix: "define the browser server in config/mcp.yaml, then npm run build-agents" }];
  const args = (server.args ?? []).map(String);
  const pkgArg = args.find((a) => /^@playwright\/mcp(@|$)/.test(a));
  const pkgVersion = pkgArg?.split("@")[2];
  const channel = argValue(args, "--browser") ?? "chrome";

  const places = channelPaths(channel, sys);
  if (places) {
    const found = places.find((p) => exists(p));
    out.push(found
      ? { id: "mcp-browser", ok: true, detail: `the browser server uses ${channel}: ${found}` }
      : { id: "mcp-browser", ok: false, level: "fail", detail: `the browser server (config/mcp.yaml) launches ${channel}, which is not installed here`, fix: `install ${channel === "chrome" ? "Google Chrome" : "Microsoft Edge"}, or npx playwright install ${channel}` });
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
  const fixMcp = "in config/mcp.yaml, then run npm run build-agents and restart the agent session";
  // as config/mcp.yaml writes it: `{fw}/` before the framework's path (D-085), or the bare path in a same-root repo
  const initPage = argValue(args, "--init-page") ?? args.find((a) => a.startsWith("--init-page="))?.slice("--init-page=".length);
  if (slash(initPage)?.replace(/^\{fw\}\//, "") !== INIT_PAGE)
    out.push({ id: "mcp-session", ok: false, level: "fail", detail: `the browser server does not run the framework's init page (--init-page ${INIT_PAGE}), which loads the run's session and aborts every write in a readonly run`, fix: `add "--init-page", "${INIT_PAGE}" to the browser server's args ${fixMcp}` });
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
  const relogin = `make login PRODUCT=${product}`;
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
      else if (!cookies.length) out.push({ id: "session", ok: true, level: "warn", detail: `the saved session has no cookie for ${host} (usual after a single sign-on login): the login is confirmed when a stage opens the target`, fix: `if a stage meets a sign-in page, ${relogin}` });
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

async function target({ cfg, fetchImpl }) {
  const urls = [cfg.target?.url, ...(cfg.target?.api_urls ?? [])].filter(Boolean);
  const out = [];
  for (const url of urls) {
    try {
      const res = await fetchImpl(url, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      out.push({ id: `target:${url}`, ok: true, detail: `${url} answers (HTTP ${res.status})` });
    } catch (e) {
      out.push({ id: `target:${url}`, ok: false, level: "fail", detail: `${url} does not answer: ${e.cause?.code ?? e.cause?.message ?? e.message}`, fix: "check the URL in the run-config, your network or VPN, then run the check again" });
    }
  }
  return out;
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
export async function runChecks(cfg, groups, { root, framework = frameworkRoot, env = process.env, platform = process.platform, home = os.homedir(), nodeVersion = process.versions.node, now = Date.now(), fetchImpl = fetch, which = defaultWhich, exists = existsSync } = {}) {
  const ctx = { root, framework, cfg, product: cfg.product, nodeVersion, now, fetchImpl, which, exists, sys: { env, platform, home } };
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
