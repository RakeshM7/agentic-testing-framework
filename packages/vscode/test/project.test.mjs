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
  AUTH_KEY,
  NPMRC_LINES,
  PENDING_KEY,
  PENDING_MAX_AGE_MS,
  REGISTRY_ACCESS,
  TOKEN_PAGE,
  TOKEN_SECRET,
  createArgs,
  extensionVersion,
  isEmptyFolder,
  pendingAction,
  registryEnv,
  registryRefused,
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

// A fake spawn: handle(child, { cmd, argv, opts }) plays the process (npx, npm, or node for the Products view's reads).
function fakeSpawn(handle) {
  const calls = [];
  const spawn = (cmd, argv, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = 3000 + calls.length;
    child.kill = () => child.emit("close", null);
    calls.push({ cmd, argv, opts, child });
    setImmediate(() => {
      if (cmd === "node") return child.emit("close", 1); // the Products view's status reads: not this test's
      handle(child, { cmd, argv, opts });
    });
    return child;
  };
  // a cancel kills the process group (-pid): the child closes, as a killed npx would
  const killProcess = (pid) => calls.find((c) => c.child.pid === -pid)?.child.emit("close", null);
  return { calls, npm: () => calls.filter((c) => c.cmd !== "node"), cliOptions: { spawn, platform: "linux", killProcess } };
}
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
  assert.deepEqual([call.cmd, call.argv, call.opts.cwd, call.opts.shell], ["npx", ["--yes", `@testagentic/atf@${MANIFEST_VERSION}`, "init", dir], dir, false]);
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
  assert.equal(a.vscode.rec.inputs.length, 0, "the host's ATF_NPM_TOKEN: not asked");
  assert.deepEqual(a.vscode.rec.openDialogs[0], { canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: "Create project here", title: "Create new project: choose an empty folder, or make one" });
  assert.equal(spawn.npm()[0].opts.env.ATF_NPM_TOKEN, TOKEN);
  assert.deepEqual(a.ctx.globalState.values[PENDING_KEY], { folder: dir, at: 42_000 });
  const [[, uri, opts]] = executed(a, "vscode.openFolder");
  assert.deepEqual([uri.fsPath, opts], [dir, { forceNewWindow: false }]);
  assert.equal(executed(a, "atf.newProduct").length, 0, "the new window does it");

  // a non-empty current folder goes straight to the dialog; a cancelled dialog runs nothing
  const busy = tmp();
  put(busy, "README.md");
  const b = activate([busy], { spawn: fakeSpawn(initWorks), env: { ATF_NPM_TOKEN: TOKEN }, openDialogs: [undefined] });
  await b.run("atf.createProject");
  assert.deepEqual([b.vscode.rec.quickPicks.length, b.vscode.rec.openDialogs.length, b.vscode.rec.progress.length], [0, 1, 0]);
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

test("Install the framework: npm install in a cloned project, with the registry's environment, then detected", async () => {
  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  const spawn = fakeSpawn((child, { opts }) => {
    install(opts.cwd);
    say(child, "stdout", "added 42 packages");
    child.emit("close", 0);
  });
  const a = activate([ws], { spawn, context: { secrets: { [TOKEN_SECRET]: TOKEN } }, messageAnswers: [undefined, "New product…"], quickPicks: [undefined] });
  assert.deepEqual(a.vscode.rec.messages[0], ["warning", a.api.workspace.message, ["Install the framework"]], "activation offers it");
  await a.run("atf.installFramework");
  const [call] = spawn.npm();
  assert.deepEqual([call.cmd, call.argv, call.opts.cwd], ["npm", ["install"], ws]);
  assert.equal(call.opts.env.ATF_NPM_TOKEN, TOKEN);
  assert.equal(call.opts.env["npm_config_//npm.pkg.github.com/:_authToken"], "${ATF_NPM_TOKEN?}");
  assert.equal(a.api.workspace.state, "ok");
  assert.deepEqual(a.vscode.rec.messages.at(-1), ["info", `atf: the framework ${MANIFEST_VERSION} is installed in ${ws}.`, ["New product…", "Show output"]]);
  assert.equal(executed(a, "atf.newProduct").length, 1);

  // only in a cloned project
  install(ws);
  const b = activate([ws], { spawn });
  await b.run("atf.installFramework");
  assert.deepEqual(b.vscode.rec.messages.at(-1), ["info", "atf: the framework is already installed.", []]);
  assert.equal(spawn.npm().length, 1);
});

test("atf.hasProducts follows the products: false with none, true once a run-config appears", async () => {
  const ws = tmp();
  put(ws, "atf/atf.json", "{}");
  install(ws);
  const a = activate([ws]);
  assert.equal(a.vscode.rec.context["atf.hasProducts"], false);
  put(ws, "config/acme.yaml", "product: acme\n");
  const w = a.vscode.rec.watchers.find((x) => String(x.pattern).includes("config"));
  w.create.fire({ fsPath: path.join(ws, "config", "acme.yaml") });
  assert.equal(a.vscode.rec.context["atf.hasProducts"], true);
  assert.ok(existsSync(path.join(ws, "config", "acme.yaml")));
});
