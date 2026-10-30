// Where the atf workspace and its framework are (P-12, packaging §3.13). The extension holds no framework code: it
// works only in a folder that holds atf/atf.json (the workspace marker, D-086) with the licensed @testagentic/atf
// installed where Node would resolve it from there. Without either, it says which one is missing and how to get it,
// and does nothing else.
//
// The pure part (detection, the product and environment listing, the artifact paths) reads the disk with node:fs and
// takes no `vscode`, so test/workspace.test.mjs runs it on temp dirs. createWorkspace() is the thin VS Code layer: the
// window's folders in, a `deps.workspace` object out, with an event the other views refresh on.
//
// No script lists a workspace's products or environments, so both come from the layout (artifact contract, D-081):
//   - config/<name>.yaml whose top-level `product:` is a slug (its `environment:`, else `default`);
//   - artifacts/<product>/ with state/ (the `default` environment), envs/<env>/state/ (another one), or modules/.
// The YAML is not parsed (the extension has no runtime dependencies): only those two top-level scalar keys are read.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MARKER = path.join("atf", "atf.json");
export const FRAMEWORK_PACKAGE = "@testagentic/atf";
export const DEFAULT_ENV = "default";
export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const isDir = (p) => {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const subdirs = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() || (d.isSymbolicLink() && isDir(path.join(dir, d.name))))
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
};
const readJson = (file) => {
  const raw = readFileSync(file, "utf8");
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw); // an editor's BOM is not a broken file
};

// The atf workspace among the window's folders (multi-root included): the first folder that holds atf/atf.json, else
// the nearest ancestor of a folder that does (a window opened on playwright-tests/ inside a workspace), as the CLI
// finds it from its working directory. -> { root, folder } | null
export function findWorkspaceRoot(folders) {
  for (const folder of folders) if (existsSync(path.join(folder, MARKER))) return { root: path.resolve(folder), folder };
  for (const folder of folders)
    for (let dir = path.dirname(path.resolve(folder)); ; dir = path.dirname(dir)) {
      if (existsSync(path.join(dir, MARKER))) return { root: dir, folder };
      if (path.dirname(dir) === dir) break;
    }
  return null;
}

// The installed framework, resolved the way Node resolves a package from `root`: node_modules/@testagentic/atf in
// `root` or any folder above it (npm hoisting, a monorepo). It must name itself @testagentic/atf and carry bin/atf.mjs.
// In the framework's own monorepo that is the workspace link to packages/core, which is right too.
// -> { dir, version } | null
export function findFramework(root) {
  for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
    const pkgDir = path.join(dir, "node_modules", ...FRAMEWORK_PACKAGE.split("/"));
    try {
      const pkg = readJson(path.join(pkgDir, "package.json"));
      if (pkg.name === FRAMEWORK_PACKAGE && existsSync(path.join(pkgDir, "bin", "atf.mjs"))) return { dir: pkgDir, version: String(pkg.version ?? "") };
    } catch {
      // not here (or unreadable): Node would look further up too
    }
    if (path.dirname(dir) === dir) return null;
  }
}

// The fixes, in the words the listing and the docs use.
export const INSTALL_HINT = `npm install --save-dev ${FRAMEWORK_PACKAGE} (the licensed package, from your registry)`;
export const INIT_HINT = "npx atf init";

// What the extension can do in this window. state: ok | noFolder | noWorkspace | noFramework | badMarker; every
// state but ok carries the message to show. -> { state, root, folder, framework, frameworkVersion, message }
export function detectWorkspace(folders) {
  const none = { root: null, folder: null, framework: null, frameworkVersion: null };
  if (!folders.length) return { ...none, state: "noFolder", message: "atf: open the folder of your atf workspace (the one holding atf/atf.json)." };
  const ws = findWorkspaceRoot(folders);
  if (!ws) {
    // a folder with the package but no marker is one `atf init` away; otherwise the package comes first
    const installed = folders.find((f) => findFramework(f));
    return {
      ...none,
      folder: installed ?? null,
      state: "noWorkspace",
      message: installed
        ? `atf: no atf workspace is open (no folder holds atf/atf.json). Run ${INIT_HINT} in ${installed} to create one.`
        : `atf: no atf workspace is open (no folder holds atf/atf.json). Install ${INSTALL_HINT} in a folder, then run ${INIT_HINT} there.`,
    };
  }
  try {
    const marker = readJson(path.join(ws.root, MARKER));
    if (!marker || typeof marker !== "object" || Array.isArray(marker)) throw new Error("it must hold a JSON object");
  } catch (e) {
    return { ...none, ...ws, state: "badMarker", message: `atf: ${path.join(ws.root, MARKER)} can't be read (${e.message}). Correct it, then refresh.` };
  }
  const fw = findFramework(ws.root);
  if (!fw) return { ...none, ...ws, state: "noFramework", message: `atf: the atf workspace ${ws.root} has no ${FRAMEWORK_PACKAGE} installed. Run npm install there (or ${INSTALL_HINT}).` };
  return { ...ws, framework: fw.dir, frameworkVersion: fw.version, state: "ok", message: null };
}

// A top-level scalar of a run-config, without a YAML parser: `key: value`, `key: "value"` or `key: 'value'`, with an
// optional trailing comment. Anything else (a flow mapping, an anchor) is not a slug and is ignored.
export function topLevelScalar(text, key) {
  const m = new RegExp(`^${key}:[ \\t]*(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s#'"][^\\s#]*))[ \\t]*(?:#.*)?$`, "m").exec(text);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

// Every product of the workspace with its environments, sorted (`default` first).
// -> [{ product, environments: [{ name, config: "config/<f>.yaml" | null, state: <abs dir> | null }] }]
export function listProducts(root) {
  const products = new Map();
  const env = (product, name) => {
    if (!products.has(product)) products.set(product, new Map());
    const envs = products.get(product);
    if (!envs.has(name)) envs.set(name, { name, config: null, state: null });
    return envs.get(name);
  };
  const configDir = path.join(root, "config");
  let files = [];
  try {
    files = readdirSync(configDir).filter((f) => /\.ya?ml$/i.test(f)).sort();
  } catch {
    // no config/ yet
  }
  for (const f of files) {
    let text;
    try {
      text = readFileSync(path.join(configDir, f), "utf8");
    } catch {
      continue;
    }
    const product = topLevelScalar(text, "product");
    if (!product || !SLUG_RE.test(product)) continue; // permissions.yaml and other non-run-configs
    const name = topLevelScalar(text, "environment") ?? DEFAULT_ENV;
    if (!SLUG_RE.test(name)) continue;
    const e = env(product, name);
    e.config ??= `config/${f}`;
  }
  const artifacts = path.join(root, "artifacts");
  for (const product of subdirs(artifacts).filter((p) => SLUG_RE.test(p))) {
    const dir = path.join(artifacts, product);
    if (isDir(path.join(dir, "state"))) env(product, DEFAULT_ENV).state = path.join(dir, "state");
    for (const name of subdirs(path.join(dir, "envs")).filter((e) => SLUG_RE.test(e)))
      if (isDir(path.join(dir, "envs", name, "state"))) env(product, name).state = path.join(dir, "envs", name, "state");
    if (!products.has(product) && isDir(path.join(dir, "modules"))) env(product, DEFAULT_ENV);
  }
  const order = (a, b) => (a.name === DEFAULT_ENV ? -1 : b.name === DEFAULT_ENV ? 1 : a.name.localeCompare(b.name));
  return [...products.keys()].sort().map((product) => ({ product, environments: [...products.get(product).values()].sort(order) }));
}

// The modules a product has working state for (artifacts/<product>/modules/<m>/), sorted.
export const listModules = (root, product) => subdirs(path.join(root, "artifacts", product, "modules")).filter((m) => SLUG_RE.test(m));

// Artifact paths (artifact contract, D-081): `default` keeps the product's own state/, another environment has
// envs/<env>/state/; results/ is shared by every environment.
export const stateDir = (root, product, environment = DEFAULT_ENV) =>
  environment === DEFAULT_ENV ? path.join(root, "artifacts", product, "state") : path.join(root, "artifacts", product, "envs", environment, "state");
export const resultsDir = (root, product, runId) => path.join(root, "artifacts", product, "results", runId);
export const reportFile = (root, product, runId) => path.join(resultsDir(root, product, runId), "report", "index.html");

// The one path the framework reads each dialog confirmation from (scripts/lib/confirm.mjs): approve's in the module's
// testcases/ folder (shared by every environment), the sweep's in the environment's own state folder.
export const APPROVAL_CONFIRM = "approval-confirm.json";
export const SWEEP_CONFIRM = "sweep-confirm.json";
export const approvalConfirmFile = (root, product, module) => path.join(root, "artifacts", product, "modules", module, "testcases", APPROVAL_CONFIRM);
export const sweepConfirmFile = (root, product, environment = DEFAULT_ENV) => path.join(stateDir(root, product, environment), SWEEP_CONFIRM);

// The environment `approve` runs in (its ATF_ENV): approve reads that environment's last run (state/run.json), which
// must list the module. The sheets have no environment (D-081), so: the first environment, `default` first, whose last
// run lists the module; else `default`, and the script says what is missing.
export function approvalEnvironment(root, product, module) {
  const p = listProducts(root).find((x) => x.product === product);
  for (const e of p?.environments ?? []) {
    if (!e.state) continue;
    try {
      if (readJson(path.join(e.state, "run.json")).modules?.includes(module)) return e.name;
    } catch {
      // no run there, or unreadable: not this one
    }
  }
  return DEFAULT_ENV;
}

// ---- a new product ----------------------------------------------------------------------------------------------------

// What `atf config <product> --url <url>` would refuse (scripts/lib/cli.mjs), checked as the human types in "New
// product…", so the input box says it before anything runs. The CLI checks again; these only say it sooner.
// -> the problem to show, or null. Values are trimmed, as the command trims them before running.
export const configFileOf = (product) => `config/${product}.yaml`;
export function productNameProblem(root, value) {
  const s = String(value ?? "").trim();
  if (!s) return "The product's name: a lowercase kebab-case slug, e.g. acme-crm";
  if (!SLUG_RE.test(s)) return `'${s}' is not a lowercase kebab-case slug: lowercase letters and digits, words joined by single hyphens (acme-crm)`;
  if (root && existsSync(path.join(root, ...configFileOf(s).split("/")))) return `${configFileOf(s)} already exists: open it from the product in the Runs view, or choose another name`;
  return null;
}
export const URL_RE = /^https?:\/\/\S+$/i; // the CLI's own test of --url
export function targetUrlProblem(value) {
  const s = String(value ?? "").trim();
  if (!s) return "The target's URL, e.g. https://crm.example.com";
  if (!URL_RE.test(s)) return `'${s}' is not an http(s) URL: start it with https:// or http://, with no spaces`;
  return null;
}

// `--env <env>` for every environment but `default` (the CLI's own flag, D-081).
export const envArgs = (environment) => (environment && environment !== DEFAULT_ENV ? ["--env", environment] : []);

// ---- the VS Code layer ----------------------------------------------------------------------------------------------

// deps.workspace. Its fields are the latest detection (root, folder, framework: the installed package's folder,
// frameworkVersion, state, message, ok); detect() runs it again. onDidRefresh(listener) fires after `atf.refresh` and
// whenever the detection changes: every view refreshes on it.
export function createWorkspace(vscode) {
  const emitter = new vscode.EventEmitter();
  const folders = () => (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === "file").map((f) => f.uri.fsPath);
  const ws = {
    state: "noFolder",
    root: null,
    folder: null,
    framework: null,
    frameworkVersion: null,
    message: null,
    get ok() {
      return ws.state === "ok";
    },
    folders,
    // re-detects; fires onDidRefresh when anything changed (or when `fire` is set: atf.refresh)
    detect({ fire = false } = {}) {
      const before = JSON.stringify([ws.state, ws.root, ws.framework, ws.frameworkVersion]);
      Object.assign(ws, detectWorkspace(folders()));
      void vscode.commands.executeCommand("setContext", "atf.workspaceState", ws.state);
      void vscode.commands.executeCommand("setContext", "atf.active", ws.state === "ok");
      if (fire || before !== JSON.stringify([ws.state, ws.root, ws.framework, ws.frameworkVersion])) emitter.fire(ws);
      return ws;
    },
    onDidRefresh: emitter.event,
    products: () => (ws.root ? listProducts(ws.root) : []),
    modules: (product) => (ws.root ? listModules(ws.root, product) : []),
    stateDir: (product, environment) => stateDir(ws.root, product, environment),
    resultsDir: (product, runId) => resultsDir(ws.root, product, runId),
    reportFile: (product, runId) => reportFile(ws.root, product, runId),
    uri: (...segments) => vscode.Uri.file(path.join(ws.root, ...segments)),
    dispose: () => emitter.dispose(),
  };
  ws.detect();
  return ws;
}
