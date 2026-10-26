// The two roots (D-085). The framework root holds what the framework ships: scripts/, agents/, the default config/
// (permissions, models, platforms, mcp, hooks), templates/, schemas/ and the agent-facing docs. The workspace root
// holds a client's own work: the run-configs config/<product>.yaml, config/interview-answers.json, artifacts/,
// playwright-tests/, k6-tests/, feedback/ and the generated host files. When both are one directory, every path
// resolves as it always has; in the monorepo the repo root is the workspace and the framework is packages/core
// (docs/packaging.md §3.11).
//
//   frameworkRoot   these scripts' own location
//   workspaceRoot   ATF_WORKSPACE; else the nearest directory, from the working directory up, that holds
//                   atf/atf.json; else the framework root (one directory is both)
//
// Agent sources and config name a framework file as `{fw}/<path>` (`node {fw}/scripts/run.mjs`): the build and
// `run.mjs init` expand the token to the framework's path relative to the workspace, which is empty when the two are
// the same directory, so the text is exactly `node scripts/run.mjs`.
//
// The framework is read-only only when it is installed (isInstalled): its real path lies inside a node_modules folder.
// A source checkout, such as the monorepo's packages/core, stays editable.
//
// Dependency-free (imported by the hook entries and the guard).
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const WORKSPACE_MARKER = "atf/atf.json";
export const FW_TOKEN = "{fw}";

// The workspace marker's content, read in one place for every key it may hold (decisions.mjs "decisions", sync.mjs
// "cloud_agent"; each reader validates its own key). -> { cfg: the object, or null when `root` has no marker } | { error }
export function readMarker(root) {
  const marker = path.join(root, WORKSPACE_MARKER);
  if (!existsSync(marker)) return { cfg: null };
  let cfg;
  try {
    const raw = readFileSync(marker, "utf8");
    cfg = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // an editor's BOM is not a broken file
  } catch (e) {
    return { error: `${WORKSPACE_MARKER} could not be read as JSON (${e.message})` };
  }
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return { error: `${WORKSPACE_MARKER} must hold a JSON object` };
  return { cfg };
}

// The nearest directory from `start` up that holds atf/atf.json, else null.
export function findWorkspace(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, WORKSPACE_MARKER))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

// The workspace of a script: ATF_WORKSPACE, else the nearest atf/atf.json above `cwd`, else the framework root.
export function resolveWorkspaceRoot({ env = process.env, cwd = process.cwd(), framework = frameworkRoot } = {}) {
  if (env.ATF_WORKSPACE) return path.resolve(env.ATF_WORKSPACE);
  return findWorkspace(cwd) ?? framework;
}

export const workspaceRoot = resolveWorkspaceRoot();

// The workspace a hook judges. `hostRoot` is the host adapter's project root (Claude Code's CLAUDE_PROJECT_DIR, else
// the payload's cwd): ATF_WORKSPACE, else the nearest atf/atf.json from there up, else the framework root when the
// host root is inside it (this repository is its own workspace), else the host root as it is.
export function hookWorkspaceRoot(hostRoot, { env = process.env, framework = frameworkRoot } = {}) {
  if (env.ATF_WORKSPACE) return path.resolve(env.ATF_WORKSPACE);
  const start = path.resolve(hostRoot);
  return findWorkspace(start) ?? (isWithin(start, framework) ? framework : start);
}

// Whether two paths are one directory, and whether a path is inside a directory, on every OS. "The same directory"
// switches the read-only framework rule off, so it must never say yes for two different directories: an existing pair
// is compared by the file system's own identity (device and inode), anything else by its resolved path (symlinks,
// junctions and 8.3 names resolved where they exist), with separators unified and case folded only on Windows.
const fold = (p) => {
  const s = String(p).replaceAll("\\", "/").replace(/(.)\/+$/, "$1");
  return process.platform === "win32" ? s.toLowerCase() : s;
};
export function realOrSelf(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return p;
  }
}
const resolved = (p) => fold(realOrSelf(path.resolve(p)));
function identity(p) {
  try {
    const s = statSync(p, { bigint: true });
    return s.ino ? `${s.dev}:${s.ino}` : null; // some file systems report no inode
  } catch {
    return null;
  }
}
export function sameDir(a, b) {
  const [ia, ib] = [identity(a), identity(b)];
  return ia && ib ? ia === ib : resolved(a) === resolved(b);
}
export const isWithin = (p, dir) => {
  const [x, d] = [resolved(p), resolved(dir)];
  return x === d || x.startsWith(d.endsWith("/") ? d : `${d}/`);
};

// The framework's path relative to the workspace, with `/` on every OS: "" when they are the same directory.
export function frameworkRel(workspace = workspaceRoot, framework = frameworkRoot) {
  if (sameDir(workspace, framework)) return "";
  return path.relative(path.resolve(workspace), path.resolve(framework)).replaceAll("\\", "/");
}

// The framework's path from this process's workspace, worked out once: what a printed hint or a generated header names.
let ownRel;
const ownFrameworkRel = () => (ownRel ??= frameworkRel());

// `{fw}/x` -> `<rel>/x`, or `x` when the framework is the workspace. A `{fw}` with no `/` after it stands for the
// directory itself (`.` when they are the same). Without `rel`: from this process's workspace (printed hints and
// generated headers: `node {fw}/scripts/run.mjs …` prints today's text in one directory, `node packages/core/…` in the
// monorepo).
export function expandFw(text, rel = ownFrameworkRel()) {
  const s = String(text);
  return rel ? s.replaceAll(FW_TOKEN, rel) : s.replaceAll(`${FW_TOKEN}/`, "").replaceAll(FW_TOKEN, ".");
}

// Whether the framework is an installed package, which no agent writes (the guard's framework-readonly rule): its real
// path, symlinks and junctions resolved, has a `node_modules` segment (any case, either separator). A source checkout
// (the monorepo's packages/core, also when reached through the workspace's node_modules/@testagentic/atf link, which
// resolves to it) is not. Fails closed: a path that can't be resolved counts as installed.
export function isInstalled(framework = frameworkRoot) {
  let real;
  try {
    real = realpathSync.native(path.resolve(framework));
  } catch {
    return true;
  }
  return String(real).split(/[\\/]+/).some((segment) => segment.toLowerCase() === "node_modules");
}
