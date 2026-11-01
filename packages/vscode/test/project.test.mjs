// src/project.js (D-107): the registry token, Create new project…, Open existing project…, Install the framework and
// the pending New product… marker; the pure parts directly, the flows through activate.js on a fake vscode and a fake
// spawn (no npm, no registry).
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { start } from "../src/activate.js";
import {
  ALLOW_SCRIPTS,
  AUTH_KEY,
  DEFAULT_PROJECT_NAME,
  NPMRC_LINES,
  PENDING_KEY,
  PENDING_MAX_AGE_MS,
  REGISTRY_ACCESS,
  TOKEN_PAGE,
  TOKEN_SECRET,
  allowScriptsRefused,
  createArgs,
  npmrcToken,
  userNpmrcPath,
  extensionVersion,
  isEmptyFolder,
  pendingAction,
  projectNameProblem,
  registryEnv,
  registryRefused,
  sentence,
  tokenProblem,
} from "../src/project.js";
import { MANIFEST_VERSION, fakeContext, fakeVscode } from "./fake-vscode.mjs";

const tmp = () => realpathSync.native(mkdtempSync(path.join(tmpdir(), "atf-vscode-proj-")));
const put = (root, rel, text = "") => {
  const f = path.join(root, ...rel.split("/"));
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, text);
};
const install = (root) => {
  put(root, "node_modules/@testagentic/atf/package.json", JSON.stringify({ name: "@testagentic/atf", version: MANIFEST_VERSION }));
  put(root, "node_modules/@testagentic/atf/bin/atf.mjs", "");
};
const TOKEN = "ghp_TESTTOKEN0123456789";
const tick = () => new Promise((r) => setImmediate(r));

// ---- the pure parts ---------------------------------------------------------------------------------------------------

test("the registry's settings are exactly the workspace template's .npmrc lines, as npm environment settings", () => {
  const template = readFileSync(path.resolve(import.meta.dirname, "..", "..", "core", "templates", "workspace", "_npmrc"), "utf8");
  const lines = template.split(/\r?\n/).filter((l) => l && !l.startsWith("#"));
  assert.deepEqual(lines, NPMRC_LINES, "templates/workspace/_npmrc changed: change project.js's registry with it");
  assert.equal(AUTH_KEY, "//npm.pkg.github.com/:_authToken");
  const env = registryEnv(TOKEN);
  // npm reads npm_config_<key>=<value> as the .npmrc line <key>=<value> (scoped and nerf-darted keys kept as written)
  assert.deepEqual(
    Object.entries(env).filter(([k]) => k.startsWith("npm_config_")).map(([k, v]) => `${k.slice("npm_config_".length)}=${v}`),
    NPMRC_LINES,
  );
  assert.equal(env.ATF_NPM_TOKEN, TOKEN);
  assert.ok(!Object.entries(env).some(([k, v]) => k !== "ATF_NPM_TOKEN" && v.includes(TOKEN)), "only ATF_NPM_TOKEN carries the token; npm fills the placeholder");
});

test("a pasted token: something, no whitespace inside; the ends are trimmed", () => {
  assert.match(tokenProblem(""), /Paste the token/);
  assert.match(tokenProblem("   "), /Paste the token/);
  assert.match(tokenProblem(undefined), /Paste the token/);
  assert.match(tokenProblem("ghp_ab cd"), /no spaces/);
  assert.match(tokenProblem("ghp_ab\ncd"), /no spaces/);
  assert.equal(tokenProblem("  ghp_abcd \n"), null);
});

test("a registry refusal: an npm error line with 401, 403 or 404 (or E-code)", () => {
  const e = (line) => ({ line, stream: "stderr" });
  for (const line of ["npm error code E401", "npm error 403 Forbidden - GET https://npm.pkg.github.com/@testagentic%2fatf", "npm error 404 Not Found - GET https://npm.pkg.github.com/@testagentic%2fatf - npm package not found", "npm ERR! code E404"])
    assert.ok(registryRefused([e("noise"), e(line)]), line);
  for (const line of ["npm error code ENOTFOUND", "atf init: 404 files later", "npm error 4013 things", "npm warn deprecated 403"]) assert.ok(!registryRefused([e(line)]), line);
});

test("npm 12's allow-scripts refusal; a reason ends one sentence, never two full stops", () => {
  const e = (line) => ({ line, stream: "stderr" });
  assert.ok(allowScriptsRefused([e("npm error code EALLOWSCRIPTS"), e("npm error --allow-scripts is not allowed in project-scoped installs")]));
  assert.ok(!allowScriptsRefused([e("npm error code E403"), e("allow-scripts")]));
  assert.equal(sentence("exit 1"), "exit 1.");
  assert.equal(sentence("renders the host files."), "renders the host files.");
  assert.equal(sentence("is it?"), "is it?");
});

test("the project's folder name in a folder that isn't empty: a plain, safe name of nothing there yet (or an empty folder)", () => {
  const parent = tmp();
  put(parent, "repo-a/README.md");
  put(parent, "notes.txt");
  mkdirSync(path.join(parent, "empty"));
  put(parent, "dots/.git/HEAD");
  assert.equal(DEFAULT_PROJECT_NAME, "atf-tests");
  for (const ok of ["atf-tests", " atf-tests ", "my tests", "e2e_tests.v2", "empty", "dots"]) assert.equal(projectNameProblem(parent, ok), null, ok);
  assert.match(projectNameProblem(parent, ""), /Name the project's folder/);
  assert.match(projectNameProblem(parent, "  "), /Name the project's folder/);
  for (const bad of ["a/b", "a\\b", "/abs", "C:\\x"]) assert.match(projectNameProblem(parent, bad), /no \/ or \\/, bad);
  for (const bad of [".", ".."]) assert.match(projectNameProblem(parent, bad), /not a folder of its own/, bad);
  for (const bad of ['a"b', "50%", "hi!", "a^b", "a:b", "a|b", "a?b", "a*b", "a<b", "a>b", "a\tb"]) assert.match(projectNameProblem(parent, bad), /without " % ! \^/, bad);
  for (const taken of ["repo-a", "notes.txt"]) assert.equal(projectNameProblem(parent, taken), `${taken} already exists in ${parent} and isn't an empty folder: choose another name`);
});

test("an empty folder: nothing but dotfiles; the extension's version, exactly; npx's arguments", () => {
  const dir = tmp();
  assert.equal(isEmptyFolder(dir), true);
  put(dir, ".git/HEAD");
  put(dir, ".DS_Store");
  assert.equal(isEmptyFolder(dir), true);
  put(dir, "notes.txt");
  assert.equal(isEmptyFolder(dir), false);
  assert.equal(isEmptyFolder(path.join(dir, "missing")), false);
  assert.equal(extensionVersion(fakeContext()), MANIFEST_VERSION);
  assert.equal(extensionVersion(fakeContext({ version: "1.2.3-beta.1" })), "1.2.3-beta.1");
  for (const v of ["", "^1.0.0", "latest", "1.0", "1.0.0 && calc"]) assert.equal(extensionVersion(fakeContext({ version: v })), null, v);
  assert.deepEqual(createArgs("0.1.1", "/w/x"), ["--yes", "@testagentic/atf@0.1.1", "init", "/w/x"]);
});

test("the pending New product… marker: run it here once, clear it when stale or used, keep another window's", () => {
  const at = 1_000_000_000;
  const m = { folder: "/w/new", at };
  assert.equal(pendingAction(m, { root: "/w/new", ok: true }, at + 5_000), "run");
  assert.equal(pendingAction(m, { root: "/w/new", ok: false }, at + 5_000), "clear", "this window's, but nothing to do: used");
  assert.equal(pendingAction(m, { root: "/w/other", ok: true }, at + 5_000), "keep");
  assert.equal(pendingAction(m, { root: null, ok: false }, at + 5_000), "keep");
  assert.equal(pendingAction(m, { root: "/w/new", ok: true }, at + PENDING_MAX_AGE_MS + 1), "clear", "stale");
  assert.equal(pendingAction(m, { root: "/w/other", ok: true }, at + PENDING_MAX_AGE_MS + 1), "clear", "stale, whoever's");
  assert.equal(pendingAction(m, { root: "/w/new", ok: true }, at - 120_000), "clear", "from the future");
  for (const bad of [null, "x", { folder: 1, at }, { folder: "/w/new" }]) assert.equal(pendingAction(bad, { root: "/w/new", ok: true }, at), "clear");
  assert.equal(pendingAction({ folder: "C:\\Work\\New", at }, { root: "c:\\work\\new", ok: true }, at, "win32"), "run", "Windows paths compare case-insensitively");
});

// ---- the flows, through activate.js -----------------------------------------------------------------------------------

// A fake spawn: handle(child, { cmd, argv, opts }) plays npx and npm; node(child, call) plays atf itself (atf sync after
// Install the framework, the Products view's reads), which by default fails.
function fakeSpawn(handle, { node = (child) => child.emit("close", 1) } = {}) {
  const calls = [];
  const spawn = (command, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    // The real platform: the folders are real ones. On Windows npm and npx run as one cmd.exe line (npmSpawnSpec),
    // read back here as the tool and its arguments so the flows read the same on every OS (the test folders hold no
    // spaces or quotes); a cancel there is taskkill /pid <pid>, played as the process closing.
    if (command === "taskkill") {
      setImmediate(() => calls.find((c) => c.child.pid === Number(args[1]))?.child.emit("close", null));
      return child;
    }
    const [cmd, ...argv] = opts?.shell ? command.split(" ").map((a, i) => (i ? a : path.basename(a).replace(/\.cmd$/i, ""))) : [command, ...args];
    child.pid = 3000 + calls.length;
    child.kill = () => child.emit("close", null);
    calls.push({ cmd, argv, opts, child });
    setImmediate(() => {
      (cmd === "node" ? node : handle)(child, { cmd, argv, opts });
    });
    return child;
  };
  // a cancel kills the process group (-pid): the child closes, as a killed npx would
  const killProcess = (pid) => calls.find((c) => c.child.pid === -pid)?.child.emit("close", null);
  return { calls, npm: () => calls.filter((c) => c.cmd !== "node"), atf: (sub) => calls.filter((c) => c.cmd === "node" && c.argv.at(-1) === sub), cliOptions: { spawn, platform: process.platform, killProcess } };
}
// atf sync works; the Products view's reads are not these tests'
const syncWorks = (child, { argv }) => child.emit("close", argv.at(-1) === "sync" ? 0 : 1);
const say = (child, stream, ...lines) => child[stream].emit("data", Buffer.from(lines.map((l) => `${l}\n`).join("")));
// what `npx … init <folder>` leaves when it works: the marker and the framework installed
const initWorks = (child, { argv }) => {
  const folder = argv.at(-1);
  put(folder, "atf/atf.json", "{}");
  install(folder);
  say(child, "stdout", `atf init: ${folder}`, "  created  atf/atf.json");
  child.emit("close", 0);
};

function activate(folders, { spawn, env = {}, context = {}, now, ...opts } = {}) {
  const vscode = fakeVscode({ folders, ...opts });
  const ctx = fakeContext(context);
  const api = start(vscode, ctx, { cliOptions: spawn?.cliOptions ?? fakeSpawn(() => {}).cliOptions, env, ...(now ? { now } : {}) });
  const run = (id, ...args) => vscode.commands.executeCommand(id, ...args);
  return { vscode, ctx, api, run };
}
const executed = (a, id) => a.vscode.rec.executed.filter(([x]) => x === id);

test("Connect: a password box with the token's scope and link, kept in secret storage; Forget removes it", async () => {
  const a = activate([], { inputs: [`  ${TOKEN} `] });
  await tick();
  assert.equal(a.vscode.rec.context["atf.registryConnected"], false);
  await a.run("atf.connect");
  const box = a.vscode.rec.inputs[0];
  assert.deepEqual([box.password, box.ignoreFocusOut], [true, true]);
  assert.match(box.prompt, /personal access token \(classic\) with only the read:packages scope/);
  assert.ok(box.prompt.includes(TOKEN_PAGE));
  assert.equal(TOKEN_PAGE, "https://github.com/settings/tokens/new?scopes=read:packages&description=atf-install");
  assert.equal(box.validateInput("a b"), "A token has no spaces or line breaks: paste just the token");
  assert.equal(a.ctx.secrets.stored[TOKEN_SECRET], TOKEN, "trimmed");
  assert.equal(a.vscode.rec.context["atf.registryConnected"], true);
  assert.ok(!JSON.stringify([a.vscode.rec.messages, a.vscode.rec.output.lines]).includes(TOKEN), "never shown or logged");

  await a.run("atf.forgetToken");
  assert.equal(a.ctx.secrets.stored[TOKEN_SECRET], undefined);
  await tick();
  assert.equal(a.vscode.rec.context["atf.registryConnected"], false);
  assert.match(a.vscode.rec.messages.at(-1)[1], /the registry token is forgotten/);

  // a cancelled box stores nothing
  const b = activate([], { inputs: [undefined] });
  await b.run("atf.connect");
  assert.deepEqual(b.ctx.rec.secrets, []);

  // the host's own ATF_NPM_TOKEN counts as connected, and survives Forget
  const c = activate([], { env: { ATF_NPM_TOKEN: TOKEN } });
  await tick();
  assert.equal(c.vscode.rec.context["atf.registryConnected"], true);
  await c.run("atf.forgetToken");
  await tick();
  assert.equal(c.vscode.rec.context["atf.registryConnected"], true);
  assert.match(c.vscode.rec.messages.at(-1)[1], /ATF_NPM_TOKEN from VS Code's own environment is still used/);
});

test("the user's npm config (D-112): its file, and the npm.pkg.github.com token in it as npm reads it", () => {
  assert.equal(userNpmrcPath({ HOME: "/home/me" }), path.join("/home/me", ".npmrc"));
  assert.equal(userNpmrcPath({ USERPROFILE: "C:\\Users\\me" }), path.join("C:\\Users\\me", ".npmrc"));
  assert.equal(userNpmrcPath({ HOME: "/home/me", npm_config_userconfig: "/etc/my.npmrc" }), "/etc/my.npmrc");
  assert.equal(userNpmrcPath({ NPM_CONFIG_USERCONFIG: "/etc/my.npmrc" }), "/etc/my.npmrc");
  assert.equal(userNpmrcPath({}), null, "never the real home folder from os.homedir()");

  const other = "registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=npm_OTHER\n";
  assert.equal(npmrcToken(`${other}//npm.pkg.github.com/:_authToken=${TOKEN}\n`), TOKEN);
  assert.equal(npmrcToken(`//npm.pkg.github.com:_authToken = "${TOKEN}"`), TOKEN, "no slash before the colon, spaces, quotes");
  assert.equal(npmrcToken(`//npm.pkg.github.com/:_authToken=ghp_old\r\n//npm.pkg.github.com/:_authToken=${TOKEN}\r\n`), TOKEN, "the last one, as npm keeps it");
  assert.equal(npmrcToken(`; //npm.pkg.github.com/:_authToken=${TOKEN}\n# //npm.pkg.github.com/:_authToken=${TOKEN}`), null, "comments");
  assert.equal(npmrcToken(other), null, "another registry's token is never used");
  assert.equal(npmrcToken("//npm.pkg.github.com/:_authToken=${GH_PACKAGES}", { GH_PACKAGES: TOKEN }), TOKEN);
  assert.equal(npmrcToken("//npm.pkg.github.com/:_authToken=${GH_PACKAGES?}", {}), null, "an unset variable");
  assert.equal(npmrcToken("//npm.pkg.github.com/:_authToken=${ATF_NPM_TOKEN?}", { ATF_NPM_TOKEN: TOKEN }), null, "the template's own line");
  assert.equal(npmrcToken("//npm.pkg.github.com/:_authToken="), null);
  assert.equal(npmrcToken(null), null);
});

test("a token already in the user's npm config is used unasked, never copied; secret storage and ATF_NPM_TOKEN come first", async () => {
  const home = tmp();
  put(home, ".npmrc", `//npm.pkg.github.com/:_authToken=${TOKEN}\n`);
  const here = (items) => items.find((i) => i.folder);
  // -> the ATF_NPM_TOKEN Create new project… gave npx, and the run
  const create = async (opts) => {
    const spawn = fakeSpawn(initWorks);
    const a = activate([tmp()], { spawn, quickPicks: [here, undefined], ...opts });
    await tick();
    await a.run("atf.createProject");
    return { a, call: spawn.npm()[0] };
  };

  const { a, call } = await create({ env: { HOME: home } });
  assert.equal(a.vscode.rec.context["atf.registryConnected"], true);
  assert.equal(a.vscode.rec.inputs.length, 0, "no token box");
  assert.equal(call.opts.env.ATF_NPM_TOKEN, TOKEN, "the token only in the process's environment");
  assert.ok(!call.argv.join(" ").includes(TOKEN), "never in argv");
  assert.deepEqual(a.ctx.rec.secrets, [], "not copied into secret storage");
  assert.ok(!JSON.stringify([a.vscode.rec.messages, a.vscode.rec.output.lines]).includes(TOKEN), "never shown or logged");
  await a.run("atf.forgetToken");
  assert.match(a.vscode.rec.messages.at(-1)[1], /token in your npm config \(.*\.npmrc\) is still used; atf never changes that file/);
  assert.equal(readFileSync(path.join(home, ".npmrc"), "utf8"), `//npm.pkg.github.com/:_authToken=${TOKEN}\n`, "the file is untouched");

  // the order: secret storage, then ATF_NPM_TOKEN, then the npm config
  const b = await create({ env: { HOME: home, ATF_NPM_TOKEN: "ghp_FROMENV" }, context: { secrets: { [TOKEN_SECRET]: "ghp_STORED" } } });
  assert.equal(b.call.opts.env.ATF_NPM_TOKEN, "ghp_STORED");
  const c = await create({ env: { HOME: home, ATF_NPM_TOKEN: "ghp_FROMENV" } });
  assert.equal(c.call.opts.env.ATF_NPM_TOKEN, "ghp_FROMENV");
  // npm_config_userconfig names the file npm reads, as it does for npm
  const elsewhere = path.join(tmp(), "work.npmrc");
  writeFileSync(elsewhere, "//npm.pkg.github.com/:_authToken=ghp_WORK\n");
  const d = await create({ env: { HOME: home, npm_config_userconfig: elsewhere } });
  assert.equal(d.call.opts.env.ATF_NPM_TOKEN, "ghp_WORK");
  // none anywhere: asked, as before
  const e = await create({ env: { HOME: tmp() }, inputs: [undefined] });
  assert.equal(e.a.vscode.rec.inputs[0].password, true);
  assert.equal(e.call, undefined);
});

test("Create new project… in this empty folder: npx init of the extension's exact version, the token only in its environment, then New product…", async () => {
  const dir = tmp();
  put(dir, ".git/HEAD");
  const spawn = fakeSpawn(initWorks);
  const here = (items) => items.find((i) => i.folder);
  const a = activate([dir], { spawn, context: { secrets: { [TOKEN_SECRET]: TOKEN } }, quickPicks: [here, undefined] });
  assert.equal(a.api.workspace.state, "noWorkspace");
  await a.run("atf.createProject");
  const pick = a.vscode.rec.quickPicks[0].items.map((i) => i.label);
  assert.deepEqual(pick, [`$(folder) In this folder (${path.basename(dir)})`, "$(folder-opened) Choose another folder…"]);
  const [call] = spawn.npm();
  assert.deepEqual([call.cmd, call.argv, call.opts.cwd, call.opts.shell], ["npx", ["--yes", `@testagentic/atf@${MANIFEST_VERSION}`, "init", dir], dir, process.platform === "win32"]);
  assert.equal(call.opts.env.ATF_NPM_TOKEN, TOKEN);
  assert.equal(call.opts.env["npm_config_@testagentic:registry"], "https://npm.pkg.github.com");
  assert.equal(call.opts.env["npm_config_//npm.pkg.github.com/:_authToken"], "${ATF_NPM_TOKEN?}");
  assert.equal(a.vscode.rec.progress[0].opts.title, `atf: creating the project in ${path.basename(dir)}`);
  assert.equal(a.vscode.rec.progress[0].opts.cancellable, true);
  assert.ok(a.vscode.rec.output.lines.includes(`  atf init: ${dir}`), "every line in the atf channel");
  // re-detected, then straight to New product… (its first pick, cancelled here)
  assert.equal(a.api.workspace.state, "ok");
  assert.equal(executed(a, "atf.newProduct").length, 1);
  assert.equal(executed(a, "vscode.openFolder").length, 0);
  // the token: in no argv, line, message, terminal or chat
  assert.ok(!JSON.stringify([call.argv, a.vscode.rec.output.lines, a.vscode.rec.messages, a.vscode.rec.executed]).includes(TOKEN));
  assert.equal(a.vscode.rec.terminals.length, 0);
  assert.equal(a.vscode.rec.inputs.length, 0, "a stored token is not asked for again");
});

test("Create new project… elsewhere: the folder dialog, then the window opens on it with a pending New product…", async () => {
  const dir = tmp();
  const spawn = fakeSpawn(initWorks);
  const a = activate([], { spawn, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [dir], now: () => 42_000 });
  await a.run("atf.createProject");
  assert.equal(a.vscode.rec.inputs.length, 0, "the host's ATF_NPM_TOKEN: not asked; an empty folder: no name asked either");
  assert.deepEqual(a.vscode.rec.openDialogs[0], {
    canSelectFolders: true,
    canSelectFiles: false,
    canSelectMany: false,
    openLabel: "Choose where to create the project",
    title: "Create new project: an empty folder is used as it is; in any other, the project gets a new folder",
  });
  assert.deepEqual([spawn.npm()[0].argv.at(-1), spawn.npm()[0].opts.cwd], [dir, dir], "the empty folder, as it is");
  assert.equal(spawn.npm()[0].opts.env.ATF_NPM_TOKEN, TOKEN);
  assert.deepEqual(a.ctx.globalState.values[PENDING_KEY], { folder: dir, at: 42_000 });
  const [[, uri, opts]] = executed(a, "vscode.openFolder");
  assert.deepEqual([uri.fsPath, opts], [dir, { forceNewWindow: false }]);
  assert.equal(executed(a, "atf.newProduct").length, 0, "the new window does it");

  // a cancelled dialog runs nothing
  const b = activate([], { spawn: fakeSpawn(initWorks), env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [undefined] });
  await b.run("atf.createProject");
  assert.deepEqual([b.vscode.rec.openDialogs.length, b.vscode.rec.inputs.length, b.vscode.rec.progress.length], [1, 0, 0]);
});

test("Create new project… in a folder that isn't empty: its name asked (atf-tests), the project in a new folder there", async () => {
  const parent = tmp();
  put(parent, "repo-a/README.md");
  put(parent, ".DS_Store");
  const spawn = fakeSpawn(initWorks);
  const a = activate([], { spawn, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [parent], inputs: [(box) => box.value], now: () => 7_000 });
  await a.run("atf.createProject");
  const [box] = a.vscode.rec.inputs;
  assert.deepEqual([box.title, box.prompt, box.value, box.ignoreFocusOut], ["Create new project", `${parent} isn't empty: the new project gets its own folder in it`, "atf-tests", true]);
  assert.equal(box.validateInput("repo-a"), `repo-a already exists in ${parent} and isn't an empty folder: choose another name`);
  assert.match(box.validateInput("../x"), /no \/ or \\/);
  const target = path.join(parent, "atf-tests");
  const [call] = spawn.npm();
  assert.deepEqual([call.argv.at(-1), call.opts.cwd], [target, target]);
  assert.equal(a.vscode.rec.progress[0].opts.title, "atf: creating the project in atf-tests");
  assert.ok(existsSync(path.join(target, "atf", "atf.json")) && !existsSync(path.join(parent, "atf")), "nothing written into the folder itself");
  assert.deepEqual(a.ctx.globalState.values[PENDING_KEY], { folder: target, at: 7_000 });
  assert.equal(executed(a, "vscode.openFolder")[0][1].fsPath, target);

  // the window's own folder, not empty: offered as a new folder in it, named, created there
  const b = activate([parent], { spawn: fakeSpawn(initWorks), env: { ATF_NPM_TOKEN: TOKEN }, quickPicks: [(items) => items[0]], inputs: [" e2e-tests "] });
  await b.run("atf.createProject");
  assert.deepEqual(
    b.vscode.rec.quickPicks[0].items.map((i) => i.label),
    [`$(new-folder) In a new folder in this one (${path.basename(parent)})`, "$(folder-opened) Choose another folder…"],
  );
  assert.equal(b.vscode.rec.openDialogs.length, 0);
  assert.equal(executed(b, "vscode.openFolder")[0][1].fsPath, path.join(parent, "e2e-tests"), "the new folder, trimmed");

  // the name box cancelled: nothing made, nothing run
  const nothing = fakeSpawn(initWorks);
  const c = activate([], { spawn: nothing, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [parent], inputs: [undefined] });
  await c.run("atf.createProject");
  assert.deepEqual([nothing.npm().length, existsSync(path.join(parent, DEFAULT_PROJECT_NAME, "atf"))], [0, true], "only the first run's project");
  assert.ok(!c.vscode.rec.messages.length);
});

test("Create new project…: a folder inside a project is refused up front, before its name is asked; Open it opens that project", async () => {
  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  put(ws, "playwright-tests/package.json", "{}");
  const sub = path.join(ws, "playwright-tests");
  const spawn = fakeSpawn(initWorks);
  const a = activate([], { spawn, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [sub], messageAnswers: ["Open it"] });
  await a.run("atf.createProject");
  assert.deepEqual(a.vscode.rec.messages[0], ["warning", `atf: ${sub} is inside the atf project ${ws} (it has atf/atf.json), and a project can't hold another: open that one instead.`, ["Open it"]]);
  assert.deepEqual([a.vscode.rec.inputs.length, spawn.npm().length], [0, 0], "no name asked, nothing run");
  assert.equal(executed(a, "vscode.openFolder")[0][1].fsPath, ws);

  // the project itself: already one, the same refusal up front
  const b = activate([], { spawn, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [ws] });
  await b.run("atf.createProject");
  assert.deepEqual(b.vscode.rec.messages[0], ["warning", `atf: ${ws} is already an atf project (it has atf/atf.json).`, ["Open it"]]);
  assert.deepEqual([b.vscode.rec.inputs.length, spawn.npm().length], [0, 0]);
});

test("the reloaded window: the marker for this folder opens New product… once; a stale one is cleared; another's kept", async () => {
  const dir = tmp();
  put(dir, "atf/atf.json", "{}");
  install(dir);
  const a = activate([dir], { context: { globalState: { [PENDING_KEY]: { folder: dir, at: 1_000 } } }, now: () => 61_000 });
  await tick();
  assert.equal(executed(a, "atf.newProduct").length, 1);
  assert.equal(a.ctx.globalState.values[PENDING_KEY], undefined, "used: cleared");

  const stale = activate([dir], { context: { globalState: { [PENDING_KEY]: { folder: dir, at: 1_000 } } }, now: () => 1_000 + PENDING_MAX_AGE_MS + 1 });
  await tick();
  assert.equal(executed(stale, "atf.newProduct").length, 0);
  assert.equal(stale.ctx.globalState.values[PENDING_KEY], undefined, "stale: cleared");

  const other = tmp();
  const kept = activate([dir], { context: { globalState: { [PENDING_KEY]: { folder: other, at: 1_000 } } }, now: () => 2_000 });
  await tick();
  assert.equal(executed(kept, "atf.newProduct").length, 0);
  assert.deepEqual(kept.ctx.globalState.values[PENDING_KEY], { folder: other, at: 1_000 }, "another window's");
});

test("Create new project…: no token and the box cancelled runs nothing; a folder that is already a project is offered to open", async () => {
  const spawn = fakeSpawn(initWorks);
  const a = activate([], { spawn, inputs: [undefined] });
  await a.run("atf.createProject");
  assert.equal(a.vscode.rec.inputs[0].password, true, "the connect flow");
  assert.deepEqual([a.vscode.rec.openDialogs.length, spawn.npm().length], [0, 0]);

  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  const b = activate([], { spawn, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [ws], messageAnswers: ["Open it"] });
  await b.run("atf.createProject");
  assert.deepEqual(b.vscode.rec.messages[0], ["warning", `atf: ${ws} is already an atf project (it has atf/atf.json).`, ["Open it"]]);
  assert.equal(executed(b, "vscode.openFolder")[0][1].fsPath, ws);
  assert.equal(spawn.npm().length, 0);
});

test("Create new project…: a registry refusal says what the token needs, with Replace token; init's own refusal is shown as it is", async () => {
  const dir = tmp();
  const denied = fakeSpawn((child) => {
    say(child, "stderr", "npm error code E403", `npm error 403 403 Forbidden - GET https://npm.pkg.github.com/@testagentic%2fatf`);
    child.emit("close", 1);
  });
  const a = activate([], { spawn: denied, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [dir], messageAnswers: ["Replace token"], inputs: [undefined] });
  await a.run("atf.createProject");
  assert.deepEqual(a.vscode.rec.messages[0], ["error", `atf: creating the project in ${path.basename(dir)} failed: ${REGISTRY_ACCESS}.`, ["Replace token", "Show output"]]);
  assert.equal(a.vscode.rec.inputs.length, 1, "Replace token: the connect box");
  assert.equal(a.ctx.globalState.values[PENDING_KEY], undefined);

  const refused = fakeSpawn((child, { argv }) => {
    say(child, "stderr", `atf init: ${argv.at(-1)} is inside the atf workspace /w (it has atf/atf.json), and a workspace can't hold another; use that one, or create this one outside it`);
    child.emit("close", 1);
  });
  const b = activate([], { spawn: refused, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [dir] });
  await b.run("atf.createProject");
  assert.equal(b.vscode.rec.messages[0][0], "error");
  assert.match(b.vscode.rec.messages[0][1], /failed: atf init: .* is inside the atf workspace \/w/);
  assert.deepEqual(b.vscode.rec.messages[0][2], ["Show output"]);

  // init's own sentence, then what to do: one full stop each, never ".."
  const halfway = fakeSpawn((child, { argv }) => {
    put(argv.at(-1), "atf/atf.json", "{}");
    say(child, "stderr", "atf init: the workspace files above are in place, but npm install failed (exit 1). Run npm install, then atf sync renders the host files.");
    child.emit("close", 1);
  });
  const h = activate([], { spawn: halfway, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [tmp()] });
  await h.run("atf.createProject");
  const [, text] = h.vscode.rec.messages[0];
  assert.match(text, /renders the host files\. The project files are in place: open the folder, then Install the framework\.$/);
  assert.ok(!text.includes(".."), text);

  // npm 12 refusing an allow-scripts setting: why, and what to do, not npm's raw line
  const allow = (writes) =>
    fakeSpawn((child, { argv }) => {
      if (writes) put(argv.at(-1), "atf/atf.json", "{}");
      say(child, "stderr", "npm error code EALLOWSCRIPTS", "npm error --allow-scripts is not allowed in project-scoped installs", "atf init: the workspace files above are in place, but npm install failed.");
      child.emit("close", 1);
    });
  for (const [writes, next] of [
    [true, "Update the extension and try again; or open the folder and run Install the framework."],
    [false, "Update the extension and try again."],
  ]) {
    const d = tmp();
    const x = activate([], { spawn: allow(writes), env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [d] });
    await x.run("atf.createProject");
    assert.deepEqual(x.vscode.rec.messages[0], ["error", `atf: creating the project in ${path.basename(d)} failed: ${ALLOW_SCRIPTS}. ${next}`, ["Show output"]]);
  }
  assert.equal(ALLOW_SCRIPTS, "npm 12 refused the install because of an allow-scripts setting (your ~/.npmrc)");

  // cancelled after init wrote the marker: open it, then Install the framework
  const slow = fakeSpawn((child, { argv }) => put(argv.at(-1), "atf/atf.json", "{}"));
  const c = activate([], { spawn: slow, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [dir], onProgress: (p, token) => setTimeout(() => token.cancel(), 5) });
  await c.run("atf.createProject");
  assert.match(c.vscode.rec.messages[0][1], /was cancelled\. The project files are in place: open the folder, then Install the framework\./);
  assert.deepEqual(c.vscode.rec.messages[0][2], ["Open it"]);
});

test("Open existing project…: a project folder (or one inside it) opens; anything else is offered Create new project here", async () => {
  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  mkdirSync(path.join(ws, "playwright-tests"));
  const a = activate([], { openDialogs: [path.join(ws, "playwright-tests")] });
  await a.run("atf.openProject");
  assert.deepEqual(a.vscode.rec.openDialogs[0], { canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Open project", title: "Open existing project: the folder holding atf/atf.json" });
  const [[, uri, opts]] = executed(a, "vscode.openFolder");
  assert.deepEqual([uri.fsPath, opts], [ws, { forceNewWindow: false }]);

  const plain = tmp();
  const spawn = fakeSpawn(initWorks);
  const b = activate([], { spawn, env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [plain], messageAnswers: ["Create new project here"] });
  await b.run("atf.openProject");
  assert.deepEqual(b.vscode.rec.messages[0], ["warning", `atf: ${plain} is not an atf project (no atf/atf.json in it or above).`, ["Create new project here"]]);
  assert.deepEqual(spawn.npm()[0].argv.slice(2), ["init", plain], "created there, no second dialog");
  assert.equal(b.vscode.rec.openDialogs.length, 1);
});

test("Install the framework: npm install in a cloned project, with the registry's environment, then atf sync, then detected", async () => {
  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  const npmInstall = (child, { opts }) => {
    install(opts.cwd);
    say(child, "stdout", "added 42 packages");
    child.emit("close", 0);
  };
  const spawn = fakeSpawn(npmInstall, { node: syncWorks });
  const a = activate([ws], { spawn, context: { secrets: { [TOKEN_SECRET]: TOKEN } }, messageAnswers: [undefined, "New product…"], quickPicks: [undefined] });
  assert.deepEqual(a.vscode.rec.messages[0], ["warning", a.api.workspace.message, ["Install the framework"]], "activation offers it");
  await a.run("atf.installFramework");
  const [call] = spawn.npm();
  assert.deepEqual([call.cmd, call.argv, call.opts.cwd], ["npm", ["install"], ws]);
  assert.equal(call.opts.env.ATF_NPM_TOKEN, TOKEN);
  assert.equal(call.opts.env["npm_config_//npm.pkg.github.com/:_authToken"], "${ATF_NPM_TOKEN?}");
  // npm 12 may skip the framework's postinstall: atf sync renders the host files, in the background, after the install
  const [sync] = spawn.atf("sync");
  assert.ok(sync && spawn.calls.indexOf(sync) > spawn.calls.indexOf(call), "atf sync, after npm install");
  assert.deepEqual([sync.argv, sync.opts.cwd], [[path.join(ws, "node_modules", "@testagentic", "atf", "bin", "atf.mjs"), "sync"], ws]);
  assert.ok(a.vscode.rec.progress.some((p) => p.opts.title === "atf sync: the host files"));
  assert.equal(a.api.workspace.state, "ok");
  assert.deepEqual(a.vscode.rec.messages.at(-1), ["info", `atf: the framework ${MANIFEST_VERSION} is installed in ${ws}.`, ["New product…", "Show output"]]);
  assert.equal(executed(a, "atf.newProduct").length, 1);

  // only in a cloned project
  install(ws);
  const b = activate([ws], { spawn });
  await b.run("atf.installFramework");
  assert.deepEqual(b.vscode.rec.messages.at(-1), ["info", "atf: the framework is already installed.", []]);
  assert.equal(spawn.npm().length, 1);

  // atf sync failing: the framework is installed, the reason, and Sync host files to try again
  const ws2 = tmp();
  put(ws2, "atf/atf.json", "{}");
  const broken = fakeSpawn(npmInstall, {
    node: (child, { argv }) => {
      if (argv.at(-1) === "sync") say(child, "stderr", "atf sync: config/claude.yaml is not valid YAML");
      child.emit("close", 1);
    },
  });
  const c = activate([ws2], { spawn: broken, env: { ATF_NPM_TOKEN: TOKEN } });
  await c.run("atf.installFramework");
  assert.deepEqual(c.vscode.rec.messages.at(-1), ["error", `atf: the framework ${MANIFEST_VERSION} is installed in ${ws2}, but atf sync failed: atf sync: config/claude.yaml is not valid YAML. Run Sync host files to try again.`, ["Show output"]]);
  assert.equal(c.api.workspace.state, "ok");

  // npm install refused by npm 12's allow-scripts check: why, and what to do
  const ws3 = tmp();
  put(ws3, "atf/atf.json", "{}");
  const refused = fakeSpawn((child) => {
    say(child, "stderr", "npm error code EALLOWSCRIPTS");
    child.emit("close", 1);
  });
  const d = activate([ws3], { spawn: refused, env: { ATF_NPM_TOKEN: TOKEN } });
  await d.run("atf.installFramework");
  assert.deepEqual(d.vscode.rec.messages.at(-1), ["error", `atf: installing the framework in ${path.basename(ws3)} failed: ${ALLOW_SCRIPTS}. Update the extension and try again.`, ["Show output"]]);
  assert.equal(refused.atf("sync").length, 0, "no sync without the framework");
});

test("atf.hasProducts follows the products: false with none, true once a run-config appears", async () => {
  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  install(ws);
  const a = activate([ws]);
  assert.equal(a.vscode.rec.context["atf.hasProducts"], false);
  put(ws, "config/acme.yaml", "product: acme\n");
  for (const w of a.vscode.rec.watchers.filter((x) => String(x.pattern).includes("config"))) w.create.fire({ fsPath: path.join(ws, "config", "acme.yaml") });
  assert.equal(a.vscode.rec.context["atf.hasProducts"], true);
  assert.ok(existsSync(path.join(ws, "config", "acme.yaml")));
});
