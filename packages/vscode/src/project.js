// A project from inside VS Code (D-107, extending D-106): the extension creates the atf project (the workspace: the
// folder holding atf/atf.json) and keeps the registry token itself, so nobody needs a terminal, `npx … init`, a
// hand-made ATF_NPM_TOKEN or an edited ~/.npmrc.
//
//   The token        a GitHub personal access token (classic) with only read:packages, asked once (atf.connect) and
//                    kept in VS Code's secret storage under atf.registryToken (atf.forgetToken deletes it). Without
//                    one stored, an ATF_NPM_TOKEN in the extension host's own environment is used, unasked. It is never
//                    logged, shown, put in argv or written to a file, and goes only into the environment of the npm,
//                    npx and atf init processes the extension starts itself (cli.runNpm, cli.runStreaming), as
//                    ATF_NPM_TOKEN; never to a terminal or the chat panel, where an agent could read it.
//   Create           `npx --yes @testagentic/atf@<this extension's exact version> init <folder>` in the background,
//                    in the folder: an empty one (dotfiles aside) as it is; in any other, a new folder whose name is
//                    asked (default atf-tests); one that is a project or inside one, never. The one place the
//                    extension runs a framework that is not installed (D-107), pinned so the extension and the
//                    package always match (D-105's version lock). Then the new window opens
//                    on the project and goes straight to New product… (a marker in globalState survives the reload).
//   Open             a folder holding atf/atf.json (or inside one), opened in this window.
//   Install          `npm install` in a cloned project whose framework is not installed yet (state noFramework), then
//                    `atf sync`, since npm 12 may skip the framework's postinstall that renders the host files.
//
// The registry, without touching ~/.npmrc and without the token in a file or argv (registryEnv). npm reads any
// setting from an `npm_config_<key>` environment variable, scoped and nerf-darted keys included, and expands ${VAR} in
// its value (@npmcli/config: loadEnv, then parseField's envReplace). So the processes get, beside ATF_NPM_TOKEN:
//     npm_config_@testagentic:registry=https://npm.pkg.github.com
//     npm_config_//npm.pkg.github.com/:_authToken=${ATF_NPM_TOKEN?}
// exactly the two lines of the workspace's .npmrc (templates/workspace/_npmrc, test/project.test.mjs compares them),
// the token line still a placeholder that npm fills from ATF_NPM_TOKEN. Why this and not a file:
//   - A pre-written <folder>/.npmrc is read only when the folder is npm's project root, and npm takes the nearest folder
//     above it holding a package.json or node_modules instead (a ~/package.json is enough), so npx would miss it. It
//     would also be left behind by a failed download, and init would then keep it instead of its own commented one.
//   - A temporary npmrc through npm_config_userconfig replaces the user's ~/.npmrc for that process: its proxy, CA,
//     registry and other scopes' tokens would be lost (and copying them into a temporary file copies their secrets).
//   - Environment settings sit above the project, user and global files and below the command line, and change
//     nothing else; the npm install init starts inherits them, and in the new workspace finds the same two lines in its
//     own .npmrc. npm 12 checked locally: `npm config get @testagentic:registry` gives the URL, the user's own settings
//     stay, the auth key resolves to the token with source "env", npx asks npm.pkg.github.com for @testagentic/atf even
//     with a package.json in the parent folder, and neither key draws an "unknown env config" warning.
//
// The pure parts take no `vscode` (test/project.test.mjs); createRegistry() and createProjectFlows() are the VS Code
// layer, given `vscode`, the extension context and activate.js's helpers.
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import { CREATE_HINT, FRAMEWORK_PACKAGE, MARKER, findWorkspaceRoot } from "./workspace.js";

export const REGISTRY_SCOPE = "@testagentic";
export const REGISTRY_URL = "https://npm.pkg.github.com";
export const TOKEN_ENV = "ATF_NPM_TOKEN";
export const TOKEN_SECRET = "atf.registryToken";
export const TOKEN_PAGE = "https://github.com/settings/tokens/new?scopes=read:packages&description=atf-install";
export const PENDING_KEY = "atf.pendingNewProduct";
export const PENDING_MAX_AGE_MS = 10 * 60_000;

// The registry's auth key, nerf-darted as npm writes it (//host/path/:_authToken).
export const AUTH_KEY = `${REGISTRY_URL.replace(/^https?:/, "")}/:_authToken`;
// The settings, as .npmrc lines (the template's) and as the environment npm reads them from.
export const NPMRC_LINES = [`${REGISTRY_SCOPE}:registry=${REGISTRY_URL}`, `${AUTH_KEY}=\${${TOKEN_ENV}?}`];
export const registryEnv = (token) => ({
  [TOKEN_ENV]: token,
  [`npm_config_${REGISTRY_SCOPE}:registry`]: REGISTRY_URL,
  [`npm_config_${AUTH_KEY}`]: `\${${TOKEN_ENV}?}`,
});

// A light check of a pasted token: something, with no whitespace inside (the ends are trimmed). -> problem | null
export function tokenProblem(value) {
  const s = String(value ?? "").trim();
  if (!s) return "Paste the token: a GitHub personal access token (classic) with only the read:packages scope";
  if (/\s/.test(s)) return "A token has no spaces or line breaks: paste just the token";
  return null;
}

export const REGISTRY_ACCESS =
  "the token can't read @testagentic/atf: it needs the read:packages scope and your account needs access to the testagentic packages";
// Whether npm's output says the registry refused: an `npm error` (npm ERR! before npm 9) line with 401, 403 or 404, or
// their E-codes. lines: [{ line, stream }] as runStreaming's onLine gives them.
export function registryRefused(lines) {
  return lines.some(({ line }) => /^npm (?:error|ERR!)/.test(line.trim()) && /\b(?:E?40[134])\b/.test(line));
}

// npm 12 refusing an allow-scripts setting it was handed as a flag (EALLOWSCRIPTS: "--allow-scripts is not allowed
// in project-scoped installs"). npx passes the user's ~/.npmrc allow-scripts on to the npm it starts that way (the npm
// install init runs, a framework older than its fix); the extension's own npm runs never pass it (cli.npmEnv).
export const ALLOW_SCRIPTS = "npm 12 refused the install because of an allow-scripts setting (your ~/.npmrc)";
export const allowScriptsRefused = (lines) => lines.some(({ line }) => /\bEALLOWSCRIPTS\b/.test(line));

// A reason as the end of a sentence: its own full stop kept, one added only when it has none (never "..").
export const sentence = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);

// A folder with nothing in it but dotfiles (.git, .DS_Store, .vscode): one a project can be created in as it is.
export function isEmptyFolder(dir) {
  try {
    return readdirSync(dir).every((name) => name.startsWith("."));
  } catch {
    return false;
  }
}

// The folder a project gets inside a folder that isn't empty: a plain name of a folder that doesn't exist there yet,
// or is empty. No path separators, no . or .., and none of the characters cmd.exe can't be handed through npx.cmd
// (quoteNpmCmd: " % ! ^) or Windows refuses in a name (< > : | ? *), so the same names work on every OS.
// -> problem | null
export const DEFAULT_PROJECT_NAME = "atf-tests";
export function projectNameProblem(parent, value) {
  const name = String(value ?? "").trim();
  if (!name) return "Name the project's folder";
  if (/[\\/]/.test(name)) return "Just the folder's name: no / or \\";
  if (name === "." || name === "..") return `${name} is not a folder of its own: choose a name`;
  if (/["%!^<>:|?*\x00-\x1f]/.test(name)) return 'A folder name without " % ! ^ < > : | ? * or control characters';
  const target = path.join(parent, name);
  if (existsSync(target) && !isEmptyFolder(target)) return `${name} already exists in ${parent} and isn't an empty folder: choose another name`;
  return null;
}

export const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// The extension's own version (its package.json, which D-105 locks to @testagentic/atf's), or null.
export function extensionVersion(context) {
  const v = String(context?.extension?.packageJSON?.version ?? "");
  return VERSION_RE.test(v) ? v : null;
}
// npx's arguments for a new project: that exact version of the package from the registry, its init, the folder.
export const createArgs = (version, folder) => ["--yes", `${FRAMEWORK_PACKAGE}@${version}`, "init", folder];

const samePath = (a, b, platform) => {
  const n = (p) => (platform === "win32" ? path.win32.resolve(p).toLowerCase() : path.resolve(p));
  return n(a) === n(b);
};
// What activation does with the "go to New product…" marker a created project left (atf.pendingNewProduct =
// { folder, at }): "run" it (this window's workspace is that folder, ready, and the marker is under 10 minutes old),
// "clear" it (stale, malformed, or this window's and used up whatever the state), or "keep" it (another window's).
export function pendingAction(marker, { root, ok }, now = Date.now(), platform = process.platform) {
  if (!marker || typeof marker.folder !== "string" || typeof marker.at !== "number") return "clear";
  const age = now - marker.at;
  if (age < -60_000 || age > PENDING_MAX_AGE_MS) return "clear";
  if (!root || !samePath(marker.folder, root, platform)) return "keep";
  return ok ? "run" : "clear";
}

// ---- the VS Code layer ----------------------------------------------------------------------------------------------

// The token store: secret storage first, else the host's ATF_NPM_TOKEN. Keeps atf.registryConnected set.
// -> { token(), ensure(), connect(), forget(), refresh() }
export function createRegistry({ vscode, context, env = process.env }) {
  const secrets = context.secrets;
  const fromEnv = () => String(env[TOKEN_ENV] ?? "").trim() || null;
  const stored = async () => {
    try {
      return (await secrets?.get(TOKEN_SECRET)) || null;
    } catch {
      return null; // a keychain VS Code can't reach: as if none were stored
    }
  };
  const setConnected = (on) => vscode.commands.executeCommand("setContext", "atf.registryConnected", on);
  const token = async () => (await stored()) ?? fromEnv();
  const refresh = async () => void (await setConnected(Boolean(await token())));

  // asks for the token (password box), stores it. -> the token, or null when cancelled
  async function connect() {
    const value = await vscode.window.showInputBox({
      title: "Connect to the package registry",
      prompt: `atf's framework is a licensed package on GitHub's registry. Paste a GitHub personal access token (classic) with only the read:packages scope; create one at ${TOKEN_PAGE}. VS Code keeps it in its secret storage.`,
      placeHolder: "ghp_…",
      password: true,
      ignoreFocusOut: true,
      validateInput: tokenProblem,
    });
    if (value === undefined || tokenProblem(value)) return null;
    const t = value.trim();
    try {
      await secrets.store(TOKEN_SECRET, t);
    } catch (e) {
      vscode.window.showErrorMessage(`atf: VS Code could not keep the token in its secret storage (${e.message}).`);
      return null;
    }
    await setConnected(true);
    vscode.window.showInformationMessage("atf: connected. The token is kept in VS Code's secret storage; Forget the registry token removes it.");
    return t;
  }
  async function forget() {
    try {
      await secrets.delete(TOKEN_SECRET);
    } catch (e) {
      return void vscode.window.showErrorMessage(`atf: VS Code could not remove the token (${e.message}).`);
    }
    await refresh();
    vscode.window.showInformationMessage(
      fromEnv() ? `atf: the stored token is forgotten. ${TOKEN_ENV} from VS Code's own environment is still used.` : "atf: the registry token is forgotten.",
    );
  }
  // the token, asked for when there is none. -> the token, or null (cancelled)
  const ensure = async () => (await token()) ?? (await connect());
  secrets?.onDidChange?.((e) => e.key === TOKEN_SECRET && void refresh()); // another window connected or forgot
  void refresh();
  return { token, ensure, connect, forget, refresh };
}

// The project commands' flows. helpers: background(args, opts), failed(text) and syncHostFiles() (atf sync in the
// background, as atf.sync runs it) from activate.js; now for tests.
// -> { createProject({ folder? }), openProject(), installFramework(), resumePending() }
export function createProjectFlows({ vscode, context, workspace, output, registry, background, failed, syncHostFiles, now = Date.now, platform = process.platform }) {
  const openFolder = (folder) => vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(folder), { forceNewWindow: false });
  const pickFolder = async (openLabel, title) => (await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel, title }))?.[0]?.fsPath ?? null;
  const isWindowFolder = (folder) => workspace.folders().some((f) => samePath(f, folder, platform));

  const lastLine = (run) => run.lines.filter((l) => l.line.trim()).at(-1)?.line.trim() ?? `exit ${run.result?.code}`;
  // A registry refusal: what the token lacks, with Replace token; npm 12's allow-scripts refusal: why, then next (what
  // to do; default: update and retry); anything else: the reason, then extra (" The project files…"), with Show output.
  async function npmFailed(name, run, { extra = "", next = "Update the extension and try again." } = {}) {
    if (run.error) return failed(`atf: ${run.error.message}`);
    if (registryRefused(run.lines)) {
      const a = await vscode.window.showErrorMessage(`atf: ${name} failed: ${REGISTRY_ACCESS}.${extra}`, "Replace token", "Show output");
      if (a === "Replace token") return vscode.commands.executeCommand("atf.connect");
      if (a === "Show output") output.show(true);
      return;
    }
    if (allowScriptsRefused(run.lines)) return failed(`atf: ${name} failed: ${ALLOW_SCRIPTS}. ${next}`);
    return failed(`atf: ${name} failed: ${sentence(lastLine(run))}${extra}`);
  }

  // A folder that is a project already, or inside one (init refuses both): offered to open that one instead. -> true
  // when it was one
  async function isProject(folder) {
    const ws = findWorkspaceRoot([folder]);
    if (!ws) return false;
    const marker = MARKER.split(path.sep).join("/");
    const text = samePath(ws.root, folder, platform)
      ? `atf: ${folder} is already an atf project (it has ${marker}).`
      : `atf: ${folder} is inside the atf project ${ws.root} (it has ${marker}), and a project can't hold another: open that one instead.`;
    const a = await vscode.window.showWarningMessage(text, "Open it");
    if (a === "Open it") await (isWindowFolder(ws.root) ? vscode.commands.executeCommand("atf.refresh") : openFolder(ws.root));
    return true;
  }

  // The folder the project goes in: an empty one as it is; in any other, a new folder whose name is asked (default
  // atf-tests), made here. -> the folder, or null (cancelled, or it can't be made)
  async function projectFolder(chosen) {
    if (isEmptyFolder(chosen)) return chosen;
    const name = await vscode.window.showInputBox({
      title: "Create new project",
      prompt: `${chosen} isn't empty: the new project gets its own folder in it`,
      value: DEFAULT_PROJECT_NAME,
      ignoreFocusOut: true,
      validateInput: (v) => projectNameProblem(chosen, v),
    });
    if (name === undefined || projectNameProblem(chosen, name)) return null;
    const folder = path.join(chosen, name.trim());
    try {
      mkdirSync(folder, { recursive: true });
    } catch (e) {
      vscode.window.showErrorMessage(`atf: can't create ${folder} (${e.message}).`);
      return null;
    }
    return folder;
  }

  // Create new project…: token, folder, then init from the registry's copy pinned to this extension's version.
  // folder: preselected (Open existing project…'s "Create new project here", init's offer); else asked.
  async function createProject({ folder } = {}) {
    const version = extensionVersion(context);
    if (!version) return void vscode.window.showErrorMessage("atf: the extension can't read its own version, so it can't tell which @testagentic/atf to install. Reinstall the extension.");
    const token = await registry.ensure();
    if (!token) return;
    if (!folder) {
      const folders = workspace.folders();
      const here = folders.length === 1 && !findWorkspaceRoot(folders) ? folders[0] : null;
      if (here) {
        const choice = await vscode.window.showQuickPick(
          [
            isEmptyFolder(here)
              ? { label: `$(folder) In this folder (${path.basename(here)})`, description: here, folder: here }
              : { label: `$(new-folder) In a new folder in this one (${path.basename(here)})`, description: here, folder: here },
            { label: "$(folder-opened) Choose another folder…", description: "or make a new one" },
          ],
          { title: "Create new project", placeHolder: "Where to create the atf project" },
        );
        if (!choice) return;
        folder = choice.folder ?? null;
      }
      folder ??= await pickFolder("Choose where to create the project", "Create new project: an empty folder is used as it is; in any other, the project gets a new folder");
      if (!folder) return;
    }
    // a project, or inside one: refused up front, before anything else is asked
    if (await isProject(path.resolve(folder))) return;
    folder = await projectFolder(path.resolve(folder));
    if (!folder) return;
    const name = `creating the project in ${path.basename(folder)}`;
    const run = await background(createArgs(version, folder), { title: `atf: ${name}`, npm: "npx", cwd: folder, env: registryEnv(token) });
    const made = existsSync(path.join(folder, MARKER));
    if (run.error) return failed(`atf: ${run.error.message}`);
    if (run.result.cancelled || run.result.code !== 0) {
      // init never overwrites, and what it wrote stays: a project with its marker but no framework is one Install away
      const after = made ? ` The project files are in place: open the folder, then Install the framework.` : "";
      if (run.result.cancelled) {
        const a = await vscode.window.showWarningMessage(`atf: ${name} was cancelled.${after}`, ...(made ? ["Open it"] : []));
        if (a === "Open it") return openFolder(folder);
        return;
      }
      return npmFailed(name, run, { extra: after, next: made ? "Update the extension and try again; or open the folder and run Install the framework." : undefined });
    }
    if (isWindowFolder(folder)) {
      workspace.detect({ fire: true });
      if (workspace.ok && samePath(workspace.root, folder, platform)) return vscode.commands.executeCommand("atf.newProduct");
    }
    // the window reloads on the new folder: activation there picks up the marker and opens New product…
    await context.globalState?.update(PENDING_KEY, { folder, at: now() });
    output.appendLine(`atf: the project is ready in ${folder}; opening it`);
    return openFolder(folder);
  }

  // Open existing project…: a folder holding atf/atf.json, or inside one (as the CLI finds it), opened in this window.
  async function openProject() {
    const folder = await pickFolder("Open project", "Open existing project: the folder holding atf/atf.json");
    if (!folder) return;
    const ws = findWorkspaceRoot([folder]);
    if (ws) return openFolder(ws.root);
    const a = await vscode.window.showWarningMessage(`atf: ${folder} is not an atf project (no atf/atf.json in it or above).`, "Create new project here");
    if (a === "Create new project here") return createProject({ folder });
  }

  // Install the framework: npm install in a cloned project (state noFramework), with the registry's settings.
  async function installFramework() {
    workspace.detect();
    if (workspace.state !== "noFramework") return void vscode.window.showInformationMessage(workspace.ok ? "atf: the framework is already installed." : workspace.message);
    const token = await registry.ensure();
    if (!token) return;
    const root = workspace.root;
    const name = `installing the framework in ${path.basename(root)}`;
    const run = await background(["install"], { title: `atf: ${name} (npm install)`, npm: "npm", cwd: root, env: registryEnv(token) });
    workspace.detect({ fire: true });
    if (run.error || run.result.code !== 0) return run.result?.cancelled ? void vscode.window.showWarningMessage(`atf: ${name} was cancelled.`) : npmFailed(name, run);
    if (!workspace.ok) return failed(`atf: npm install finished, but ${workspace.message}`);
    // npm 12 may skip the framework's postinstall, which renders the host files: atf sync renders them, then re-detect
    const installed = `atf: the framework ${workspace.frameworkVersion} is installed in ${root}`;
    const synced = await syncHostFiles();
    workspace.detect({ fire: true });
    if (synced.error) return failed(`${installed}, but ${sentence(synced.error.message)} Run Sync host files to try again.`);
    if (synced.result.cancelled) {
      const s = await vscode.window.showWarningMessage(`${installed}, but atf sync was cancelled: the host files may be missing.`, "Sync host files");
      if (s === "Sync host files") return vscode.commands.executeCommand("atf.sync");
      return;
    }
    if (synced.result.code !== 0) return failed(`${installed}, but atf sync failed: ${sentence(lastLine(synced))} Run Sync host files to try again.`);
    const more = workspace.hasProducts ? [] : ["New product…"];
    const a = await vscode.window.showInformationMessage(`${installed}.`, ...more, "Show output");
    if (a === "New product…") return vscode.commands.executeCommand("atf.newProduct");
    if (a === "Show output") output.show(true);
  }

  // At activation: the marker a created project left for this window. Always cleared once seen here, or when stale.
  async function resumePending() {
    const marker = context.globalState?.get(PENDING_KEY);
    if (marker === undefined) return;
    const act = pendingAction(marker, { root: workspace.root, ok: workspace.ok }, now(), platform);
    if (act === "keep") return;
    await context.globalState.update(PENDING_KEY, undefined);
    if (act === "run") return vscode.commands.executeCommand("atf.newProduct");
  }

  return { createProject, openProject, installFramework, resumePending, offerCreate: (text, folder) => offerCreate(vscode, text, () => createProject({ folder })) };
}

// A message offering Create new project… (atf.init without the package installed).
async function offerCreate(vscode, text, create) {
  if ((await vscode.window.showWarningMessage(text, CREATE_HINT)) === CREATE_HINT) return create();
}
