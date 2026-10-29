// The one reader of the framework's config files (D-085, docs/packaging.md §3.4): config/permissions.yaml,
// models.yaml, platforms.yaml, mcp.yaml and hooks.yaml. Every script and lib reads them through here, so where a file
// comes from, and what a workspace changes in it, is decided in one place. (A workspace's run-configs,
// config/<product>.yaml, are the workspace's files, not framework config; they are read where they are named.)
//
// Per file, the effective config is, in order:
//   ejected    <workspace>/atf/config/<name> exists: it is the whole file; the framework's copy and any overlay are
//              ignored
//   overlay    <workspace>/atf/<name> exists: the framework's config/<name> is the base and the overlay is deep-merged
//              over it (mergeConfig): a map merges key by key, a list replaces the base list, `null` deletes the key.
//              An overlay that is not a YAML mapping is an error naming the file
//   framework  otherwise, and always when the workspace and the framework are one directory: the framework's copy, as
//              it always was
// The effective result is checked by the callers' own validators, as the framework's copy always was
// (resolvePermissions at run.mjs init and in the build, the build's checks for the rest), with one exception here:
// hooks.yaml may hold only `post_tool_use: async|sync|off` (checkHooks), so no override can register, reorder or turn
// off the PreToolUse guard, which is not configurable at all (P-4).
//
// API (opts: {framework, workspace}, defaulting to this process's roots; tests pass scratch ones):
//   loadConfig(name, opts)   -> the effective object
//   configText(name, opts)   -> the effective text: the ejected file's, the framework's when nothing overrides it,
//                               else a YAML dump of the merged object under a one-line `#` header naming its sources
//   configPath(name, opts)   -> the framework's own copy, always (what `--post-hook` writes; a run's permissionsPath)
//   configLocation(name, opts) -> { name, source, files }: where the file comes from, reading nothing
//   configSource(name, opts) -> { name, source: "framework" | "overlay" | "ejected",
//                                 files: [the files it came from, base first: workspace-relative with `/`, else absolute],
//                                 digest: sha256 hex of configText }
//   configSources(opts)      -> configSource of every CONFIG_FILES entry, in that order
// configSource/configSources are the provenance record of a run (which files were overlaid or ejected): keep the shape.
//
// Dependency-free to import: the YAML parser is loaded only when a file is parsed or an overlay is merged, so the guard
// reads mcp.yaml's text here (browser-tools.mjs networkGuarded) with node's built-ins alone when nothing overrides it.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { frameworkRoot, sameDir, workspaceRoot } from "./roots.mjs";

export const CONFIG_FILES = ["permissions.yaml", "models.yaml", "platforms.yaml", "mcp.yaml", "hooks.yaml"];
export const configRel = (name) => `config/${name}`;
export const ejectedRel = (name) => `atf/config/${name}`;
export const overlayRel = (name) => `atf/${name}`;

// hooks.yaml's only key and its values (hook-registrations.mjs POST_MODES, kept here so the guard's import stays small)
export const HOOKS_KEYS = { post_tool_use: ["async", "sync", "off"] };

let yaml;
const YAML = () => (yaml ??= createRequire(import.meta.url)("js-yaml"));
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

function checkName(name) {
  if (!CONFIG_FILES.includes(name)) throw new Error(`'${name}' is not a framework config file (one of: ${CONFIG_FILES.join(", ")})`);
}

// -> the absolute path of the framework's own copy. `framework`: the framework root (tests pass a scratch one).
export function configPath(name, { framework = frameworkRoot } = {}) {
  checkName(name);
  return path.join(framework, "config", name);
}

// A file as a person finds it: from the workspace, else absolute; with `/` on every OS, so a run's provenance and the
// effective text read the same everywhere.
function shown(file, workspace) {
  const rel = path.relative(path.resolve(workspace), file);
  return (rel && !rel.startsWith("..") && !path.isAbsolute(rel) ? rel : file).replaceAll("\\", "/");
}

// -> { source, files: [absolute paths, base first] }. Only existence decides; nothing is read.
function locate(name, { framework = frameworkRoot, workspace = workspaceRoot } = {}) {
  const base = configPath(name, { framework });
  if (!workspace || sameDir(workspace, framework)) return { source: "framework", files: [base] };
  const ejected = path.join(workspace, ejectedRel(name));
  if (existsSync(ejected)) return { source: "ejected", files: [ejected] };
  const overlay = path.join(workspace, overlayRel(name));
  if (existsSync(overlay)) return { source: "overlay", files: [base, overlay] };
  return { source: "framework", files: [base] };
}

const isMap = (v) => Object.prototype.toString.call(v) === "[object Object]";
// an own, enumerable key even when it is `__proto__` (a YAML key is data, never the object's prototype)
const put = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true });

// The overlay rule, pure: `over` merged over `base` into a new object. A map merges key by key; any other value (a
// list, a scalar) replaces; `null` deletes the key. A map under a key the base lacks (or holds as a non-map) is taken
// as it is, its own nulls dropped.
export function mergeConfig(base, over) {
  const out = {};
  if (isMap(base)) for (const [k, v] of Object.entries(base)) put(out, k, v);
  for (const [k, v] of Object.entries(over)) {
    if (v === null) delete out[k];
    else if (isMap(v)) put(out, k, mergeConfig(isMap(out[k]) ? out[k] : {}, v));
    else put(out, k, v);
  }
  return out;
}

// hooks.yaml, whatever it came from: a mapping of post_tool_use: async|sync|off and nothing else. Throws naming `where`.
export function checkHooks(doc, where = configRel("hooks.yaml")) {
  const [key, modes] = Object.entries(HOOKS_KEYS)[0];
  if (!isMap(doc)) throw new Error(`${where}: must be a mapping with only '${key}: ${modes.join("|")}'`);
  const extra = Object.keys(doc).filter((k) => !(k in HOOKS_KEYS));
  if (extra.length)
    throw new Error(`${where}: '${extra.join("', '")}' not configurable: hooks.yaml holds only '${key}: ${modes.join("|")}'; the PreToolUse guard is always registered and blocking, and no override changes that`);
  if (!modes.includes(doc[key])) throw new Error(`${where}: ${key} '${doc[key]}' not in [${modes}]`);
  return doc;
}

// YAML text -> its value; a syntax error names the file it is in.
function parse(text, where) {
  try {
    return YAML().load(text);
  } catch (e) {
    if (e?.name !== "YAMLException") throw e;
    throw new Error(`${where}: not valid YAML: ${e.message}`);
  }
}

// -> { source, files (absolute), shownFiles, text, doc() }: the one place the three cases are told apart.
function effective(name, opts = {}) {
  const workspace = opts.workspace ?? workspaceRoot;
  const { source, files } = locate(name, opts);
  const shownFiles = files.map((f) => shown(f, workspace));
  const where = shownFiles.join(" + ");
  let text;
  let parsed;
  if (source === "overlay") {
    const base = parse(readFileSync(files[0], "utf8"), shownFiles[0]);
    const over = parse(readFileSync(files[1], "utf8"), shownFiles[1]);
    if (!isMap(over)) throw new Error(`${shownFiles[1]}: an overlay must be a YAML mapping (the keys it changes in ${shownFiles[0]}), not ${over === undefined || over === null ? "empty" : Array.isArray(over) ? "a list" : typeof over}`);
    parsed = { value: mergeConfig(base, over) };
    text = `# Effective ${name}: ${shownFiles[0]}, overlaid by ${shownFiles[1]} (scripts/lib/config.mjs); edit the overlay, not this\n${YAML().dump(parsed.value, { lineWidth: -1, noRefs: true })}`;
  } else text = readFileSync(files[0], "utf8");
  const doc = () => (parsed ??= { value: parse(text, where) }).value;
  if (name === "hooks.yaml") checkHooks(doc(), where);
  return { source, files, shownFiles, text, doc };
}

// -> the effective text. Throws when a file is missing, or (an overlay or hooks.yaml) not valid YAML or not allowed.
export const configText = (name, opts) => effective(name, opts).text;

// -> the effective object. Throws when a file is missing or not YAML, like a direct read would.
export const loadConfig = (name, opts) => effective(name, opts).doc();

// -> { name, source, files } (configSource without the digest): which files exist decides; nothing is read or checked.
export function configLocation(name, opts = {}) {
  const { source, files } = locate(name, opts);
  return { name, source, files: files.map((f) => shown(f, opts.workspace ?? workspaceRoot)) };
}

// -> { name, source, files, digest } (see the header). Throws like configText.
export function configSource(name, opts) {
  const e = effective(name, opts);
  return { name, source: e.source, files: e.shownFiles, digest: sha256(e.text) };
}

export const configSources = (opts) => CONFIG_FILES.map((name) => configSource(name, opts));
