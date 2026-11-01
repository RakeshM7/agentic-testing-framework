// packages/vscode/package.json against SPEC.md: every view and command the spec lists, with its title, the menus and
// icons, the listing fields; and, both ways, the code: every command, view and setting the sources use is declared,
// and every one Basil owns is registered.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { COMMANDS } from "../src/activate.js";
import { COMMAND_CONTRIBUTION } from "../src/cockpit-panel.js";

const PKG = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
const core = JSON.parse(readFileSync(path.join(PKG, "..", "core", "package.json"), "utf8"));
const c = manifest.contributes;

// SPEC.md "Contributions". The atf.runs view is titled Products since D-107 ("project" now means the workspace).
const SPEC_VIEWS = { "atf.cockpit": "Cockpit", "atf.runs": "Products", "atf.clarifications": "Clarifications", "atf.approvals": "Test case approval" };
// D-107's project commands: create or open a project, the registry token, installing the framework
const PROJECT_COMMANDS = {
  "atf.createProject": "Create new project…",
  "atf.openProject": "Open existing project…",
  "atf.connect": "Connect to the package registry…",
  "atf.forgetToken": "Forget the registry token",
  "atf.installFramework": "Install the framework",
};
const SPEC_COMMANDS = {
  "atf.refresh": "Refresh",
  ...PROJECT_COMMANDS,
  "atf.init": "Set up atf in this folder (init)",
  "atf.sync": "Sync host files",
  "atf.check": "Check host files",
  "atf.doctor": "Doctor",
  "atf.run": "Start or continue a run",
  "atf.resume": "Resume a stage",
  "atf.newProduct": "New product…",
  "atf.openConfig": "Open config",
  "atf.validate": "Validate config",
  "atf.sweep": "Sweep leftovers…",
  "atf.openClarifications": "Open clarifications",
  "atf.openApproval": "Open approval sheet",
  "atf.approveModule": "Approve module…",
  "atf.openReport": "Open report",
  "atf.openCockpit": "Open Cockpit",
};

const sources = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sources(path.join(dir, d.name)) : d.name.endsWith(".js") ? [path.join(dir, d.name)] : []));
const code = Object.fromEntries(sources(path.join(PKG, "src")).map((f) => [path.relative(PKG, f).split(path.sep).join("/"), readFileSync(f, "utf8")]));
const ids = (re, text = Object.values(code).join("\n")) => [...text.matchAll(re)].map((m) => m[1]);
const versionOf = (range) => range.replace(/^[\^~>=\s]+/, "").split(".").map(Number);
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

test("the listing: name, publisher, version locked to @testagentic/atf, private to npm, needs the licensed package", () => {
  assert.equal(manifest.name, "atf-vscode");
  assert.equal(manifest.publisher, "testagentic");
  assert.equal(manifest.displayName, "atf: agentic testing");
  assert.equal(manifest.version, core.version);
  assert.equal(manifest.private, true, "npm publish must refuse it; vsce publishes it");
  assert.equal(manifest.main, "./dist/extension.js");
  assert.match(manifest.description, /Requires the licensed @testagentic\/atf package installed in your workspace/);
  assert.equal(manifest.license, "MIT");
  assert.ok(existsSync(path.join(PKG, manifest.icon)), manifest.icon);
  assert.ok(manifest.icon.endsWith(".png"), "the Marketplace takes no SVG icon");
  assert.deepEqual(manifest.activationEvents, ["workspaceContains:atf/atf.json"]);
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, false, "it runs the workspace's node_modules");
  assert.deepEqual(manifest.extensionKind, ["workspace"]);
  assert.ok(cmp(versionOf(manifest.engines.vscode), [1, 93, 0]) >= 0, "shell integration's executeCommand is in 1.93");
  assert.ok(cmp(versionOf(manifest.devDependencies["@types/vscode"]), versionOf(manifest.engines.vscode)) <= 0, "vsce refuses @types/vscode newer than engines.vscode");
  assert.equal(manifest.devDependencies.esbuild, core.devDependencies.esbuild);
  assert.equal(manifest.dependencies, undefined, "the extension ships nothing but dist/");
  assert.equal(manifest.scripts["vscode:prepublish"], undefined);
});

test("the view container and every view of the spec", () => {
  // VS Code shows a container title as written; "atf" was rendered "Atf"
  assert.deepEqual(c.viewsContainers.activitybar.map((v) => [v.id, v.title]), [["atf", "ATF"]]);
  assert.ok(existsSync(path.join(PKG, c.viewsContainers.activitybar[0].icon)));
  assert.deepEqual(Object.fromEntries(c.views.atf.map((v) => [v.id, v.name])), SPEC_VIEWS);
  for (const w of c.viewsWelcome) assert.ok(SPEC_VIEWS[w.view], w.view);
});

test("until a project is open, only the Products view shows: the sheets' views are hidden, not empty", () => {
  const when = Object.fromEntries(c.views.atf.map((v) => [v.id, v.when]));
  assert.equal(when["atf.runs"], undefined, "Products always shows: its welcome content is the way in");
  assert.equal(when["atf.cockpit"], undefined, "the Cockpit always shows: without a project it offers to create or open one");
  assert.equal(when["atf.clarifications"], "atf.workspaceState == ok");
  assert.equal(when["atf.approvals"], "atf.workspaceState == ok");
});

test("the Cockpit is the main view (D-111): it opens expanded, the three trees collapsed", () => {
  const visibility = Object.fromEntries(c.views.atf.map((v) => [v.id, v.visibility]));
  assert.deepEqual(visibility, { "atf.cockpit": undefined, "atf.runs": "collapsed", "atf.clarifications": "collapsed", "atf.approvals": "collapsed" });
});

test("the Cockpit's editor tab: the manifest carries src/cockpit-panel.js COMMAND_CONTRIBUTION", () => {
  for (const x of COMMAND_CONTRIBUTION.commands) assert.deepEqual(c.commands.find((y) => y.command === x.command), x);
  for (const [menu, entries] of Object.entries(COMMAND_CONTRIBUTION.menus))
    for (const e of entries) assert.ok(c.menus[menu].some((y) => JSON.stringify(y) === JSON.stringify(e)), `${menu}: ${JSON.stringify(e)}`);
});

// The Products view's welcome content for a workspace state; each line holding only a link is a button.
const welcome = (state) => c.viewsWelcome.filter((w) => w.view === "atf.runs" && w.when === `atf.workspaceState == ${state}`);
const buttons = (w) => w.contents.split("\n").filter((l) => /^\[[^\]]+\]\(command:[^)]+\)$/.test(l));

test("welcome content: one per workspace state, with buttons instead of npx commands", () => {
  for (const state of ["noFolder", "noWorkspace", "noFramework", "badMarker", "ok"]) assert.equal(welcome(state).length, 1, state);
  const SETUP = ["[Create new project…](command:atf.createProject)", "[Open existing project…](command:atf.openProject)"];
  assert.deepEqual(buttons(welcome("noFolder")[0]), SETUP);
  assert.deepEqual(buttons(welcome("noWorkspace")[0]), SETUP);
  assert.deepEqual(buttons(welcome("noFramework")[0]), ["[Install the framework](command:atf.installFramework)", "[Refresh](command:atf.refresh)"]);
  assert.deepEqual(buttons(welcome("badMarker")[0]), ["[Refresh](command:atf.refresh)"]);
  // the token hint: only before a project exists, and only while no token is stored
  const hint = c.viewsWelcome.filter((w) => /command:atf\.connect\)/.test(w.contents));
  assert.equal(hint.length, 1);
  assert.match(hint[0].contents, /read:packages/);
  assert.match(hint[0].when, /!atf\.registryConnected/);
  const states = /atf\.workspaceState =~ \/(.+)\/ &&/.exec(hint[0].when);
  assert.ok(states, hint[0].when);
  const re = new RegExp(states[1]);
  assert.deepEqual(["noFolder", "noWorkspace", "noFramework", "badMarker", "ok"].filter((s) => re.test(s)), ["noFolder", "noWorkspace"]);
  for (const w of c.viewsWelcome) assert.doesNotMatch(w.contents, /\bnpx\b/, w.when);
});

// The walkthrough: each step's description, and its markdown media.
const walkthrough = c.walkthroughs?.find((w) => w.id === "atf.getStarted");
const stepMarkdown = (s) => (s.media?.markdown ? readFileSync(path.join(PKG, s.media.markdown), "utf8") : "");
// command links a welcome or walkthrough may use beside the extension's own commands
const BUILT_IN = new Set(["workbench.action.openSettings"]);

test("every command: link in the welcome content and the walkthrough names a contributed command or a known built-in", () => {
  const declared = new Set(c.commands.map((x) => x.command));
  const texts = [...c.viewsWelcome.map((w) => [w.view, w.contents]), ...walkthrough.steps.flatMap((s) => [[s.id, s.description], [s.media?.markdown, stepMarkdown(s)]])];
  let links = 0;
  for (const [where, text] of texts)
    for (const id of ids(/\(command:([\w.]+)/g, text)) {
      links++;
      assert.ok(declared.has(id) || BUILT_IN.has(id), `${where}: ${id}`);
    }
  assert.ok(links > 10);
});

test("the Get Started walkthrough: its steps, a button each, completion events and media that ship", () => {
  assert.ok(walkthrough, "atf.getStarted");
  assert.equal(walkthrough.title, "Get started with atf");
  assert.ok(walkthrough.description);
  const steps = walkthrough.steps.map((s) => [s.title, ids(/\]\(command:([\w.]+)/g, s.description), s.completionEvents]);
  assert.deepEqual(steps, [
    ["Connect to the package registry", ["atf.connect"], ["onContext:atf.registryConnected"]],
    ["Create or open a project", ["atf.createProject", "atf.openProject"], ["onContext:atf.workspaceState == ok"]],
    ["Add a product", ["atf.newProduct"], ["onContext:atf.hasProducts"]],
    ["Choose where agents run", ["workbench.action.openSettings"], ["onSettingChanged:atf.host", "onStepSelected"]],
    ["Start your first run", ["atf.run"], ["onCommand:atf.run"]],
  ]);
  assert.equal(new Set(walkthrough.steps.map((s) => s.id)).size, walkthrough.steps.length, "unique step ids");
  for (const s of walkthrough.steps) {
    // the button: a line holding only the link
    assert.ok(s.description.split("\n").some((l) => /^\[[^\]]+\]\(command:[^)]+\)$/.test(l)), s.id);
    assert.deepEqual(Object.keys(s.media), ["markdown"], s.id);
    assert.match(s.media.markdown, /^media\/walkthrough\/[\w-]+\.md$/);
    assert.ok(existsSync(path.join(PKG, s.media.markdown)), s.media.markdown);
  }
  // the settings link opens atf.host itself
  const host = walkthrough.steps.find((s) => s.title === "Choose where agents run");
  const arg = /command:workbench\.action\.openSettings\?([^)]+)\)/.exec(host.description);
  assert.deepEqual(JSON.parse(decodeURIComponent(arg[1])), ["atf.host"]);
  assert.ok(c.configuration.properties["atf.host"]);
  assert.match(host.description, /Optional/);
  assert.match(walkthrough.steps.find((s) => s.id === "connect").description, /read:packages/);
  assert.match(walkthrough.steps.find((s) => s.id === "run").description, /readonly by default/);
});

test("every command of the spec, with its title, category atf and an icon; nothing else", () => {
  assert.equal(new Set(Object.values(SPEC_COMMANDS)).size, Object.keys(SPEC_COMMANDS).length, "no two commands share a title");
  assert.deepEqual(Object.fromEntries(c.commands.map((x) => [x.command, x.title])), SPEC_COMMANDS);
  for (const x of c.commands) {
    assert.equal(x.category, "atf", x.command);
    assert.match(x.icon, /^\$\([a-z-]+\)$/, x.command);
  }
});

test("menus: view titles and items, declared commands and views only", () => {
  const declared = new Set(c.commands.map((x) => x.command));
  const menus = Object.entries(c.menus);
  assert.deepEqual(menus.map(([k]) => k).sort(), ["commandPalette", "view/item/context", "view/title"]);
  for (const [, entries] of menus)
    for (const e of entries) {
      assert.ok(declared.has(e.command), e.command);
      for (const v of ids(/view == ([\w.]+)/g, e.when ?? "")) assert.ok(SPEC_VIEWS[v], `${e.command}: ${v}`);
    }
  const items = c.menus["view/item/context"];
  const on = (cmd, ctx) => items.some((e) => e.command === cmd && new RegExp(`(viewItem == ${ctx.replaceAll(".", "\\.")}\\b)|(viewItem =~ /.*\\b${ctx.split(".")[1]}\\b)`).test(e.when));
  // the tree's context values (src/runs.js) and the sheets' (src/sheets/trees.js)
  assert.ok(on("atf.run", "atf.product") && on("atf.doctor", "atf.environment") && on("atf.resume", "atf.stage") && on("atf.resume", "atf.module"));
  assert.ok(on("atf.openReport", "atf.run"));
  assert.ok(on("atf.openClarifications", "atf.module") && on("atf.openClarifications", "atf.clarificationModule"));
  assert.ok(on("atf.openApproval", "atf.module") && on("atf.openApproval", "atf.approvalModule"));
  assert.ok(on("atf.approveModule", "atf.module") && on("atf.approveModule", "atf.approvalModule"));
  const titles = c.menus["view/title"];
  assert.ok(titles.some((e) => e.command === "atf.refresh" && /atf\.runs/.test(e.when) && /atf\.clarifications/.test(e.when) && /atf\.approvals/.test(e.when)));
  assert.ok(titles.some((e) => e.command === "atf.run" && e.group.startsWith("navigation")));
});

test("the code declares nothing the manifest doesn't (commands, views, settings, context values in menus)", () => {
  const declared = new Set(c.commands.map((x) => x.command));
  const registered = ids(/registerCommand\(\s*["']([\w.]+)["']/g);
  for (const id of registered) assert.ok(declared.has(id), `registered but undeclared: ${id}`);
  for (const id of ids(/(?:executeCommand|command:)\(?\s*["'](atf\.[\w]+)["']/g)) assert.ok(declared.has(id), `used but undeclared: ${id}`);
  for (const id of ids(/(?:createTreeView|registerTreeDataProvider)\(\s*["']([\w.]+)["']/g)) assert.ok(SPEC_VIEWS[id], `view not declared: ${id}`);
  const settings = Object.keys(c.configuration.properties);
  for (const k of ids(/getConfiguration\(\s*["']atf["']\s*\)\s*\.get\(\s*["']([\w.]+)["']/g)) assert.ok(settings.includes(`atf.${k}`), `setting not declared: atf.${k}`);
  for (const k of ids(/["']setContext["'],\s*["']([\w.]+)["']/g)) assert.ok(JSON.stringify(c).includes(k), `context key never used by the manifest: ${k}`);
});

test("the palette: the project commands only where they make sense", () => {
  const palette = Object.fromEntries(c.menus.commandPalette.map((e) => [e.command, e.when]));
  assert.equal(palette["atf.createProject"], undefined, "always");
  assert.equal(palette["atf.openProject"], undefined, "always");
  assert.equal(palette["atf.installFramework"], "atf.workspaceState == noFramework");
  assert.equal(palette["atf.forgetToken"], "atf.registryConnected");
  assert.equal(palette["atf.init"], "atf.workspaceState == noWorkspace", "init doesn't compete with Create new project…");
  const titles = c.menus["view/title"];
  assert.ok(titles.some((e) => e.command === "atf.createProject" && e.when === "view == atf.runs" && !e.group.startsWith("navigation")), "in the Products view's ... menu");
});

test("every context key the when clauses and the walkthrough use is one the code sets", () => {
  const whens = [...Object.values(c.menus).flat(), ...c.viewsWelcome, ...c.views.atf].map((e) => e.when ?? "");
  // VS Code's own keys compare against view ids and context values: drop those comparisons first
  const keys = new Set(ids(/\b(atf\.\w+)\b/g, whens.map((w) => w.replace(/\b(view|viewItem)\s*(==|=~)\s*(\/[^/]*\/|[\w.]+)/g, "")).join("\n")));
  for (const s of walkthrough.steps) for (const e of s.completionEvents) if (e.startsWith("onContext:")) for (const k of ids(/\b(atf\.\w+)\b/g, e)) keys.add(k);
  assert.deepEqual([...keys].sort(), ["atf.active", "atf.hasProducts", "atf.registryConnected", "atf.workspaceState"]);
  const all = Object.values(code).join("\n");
  for (const k of keys) assert.ok(new RegExp(`["']${k.replace(".", "\\.")}["']`).test(all), `context key never set by the code: ${k}`);
});

test("Basil's commands and the Products view are registered by the extension's code", () => {
  // the 11 commands of D-102/D-106 in activate.js's COMMANDS; D-107's project commands registered by Biscuit's code
  assert.deepEqual(COMMANDS.filter((id) => !PROJECT_COMMANDS[id]), Object.keys(SPEC_COMMANDS).filter((id) => !PROJECT_COMMANDS[id]).slice(0, 11));
  for (const id of COMMANDS) assert.match(code["src/activate.js"], new RegExp(`"${id.replace(".", "\\.")}":`), id);
  const all = Object.values(code).join("\n");
  for (const id of Object.keys(PROJECT_COMMANDS)) assert.ok(new RegExp(`["']${id.replace(".", "\\.")}["']`).test(all), `${id} is never registered`);
  assert.match(code["src/activate.js"], /registerCommand\(id, fn\)/);
  assert.match(code["src/runs.js"], /createTreeView\("atf\.runs"/);
  // extension.js hands the real API to activate.js and imports the other owners' register functions
  assert.match(code["src/extension.js"], /import \{ registerSheets \} from "\.\/sheets\/index\.js"/);
  assert.match(code["src/extension.js"], /import \{ registerReport \} from "\.\/report\.js"/);
  assert.match(code["src/extension.js"], /export function activate\(context\)/);
});

test("New product…: in the Products view's title and the palette (with a workspace), and the no-products welcome", () => {
  const titles = c.menus["view/title"];
  const add = titles.find((e) => e.command === "atf.newProduct");
  assert.deepEqual([add?.when, add?.group], ["view == atf.runs && atf.active", "navigation@0"], "an icon, first in the title");
  assert.equal(c.commands.find((x) => x.command === "atf.newProduct").icon, "$(add)");
  const palette = Object.fromEntries(c.menus.commandPalette.map((e) => [e.command, e.when]));
  assert.equal(palette["atf.newProduct"], "atf.active");
  assert.equal(palette["atf.openConfig"], "atf.active");
  // welcome content: a line holding only a link is a button; the interview link passes its way as the argument
  const ok = c.viewsWelcome.filter((w) => w.view === "atf.runs" && w.when === "atf.workspaceState == ok");
  assert.equal(ok.length, 1);
  const lines = ok[0].contents.split("\n");
  assert.ok(lines.includes("[New product…](command:atf.newProduct)"), "the button");
  const link = /\[Let the orchestrator interview me\]\(command:atf\.newProduct\?([^)]+)\)/.exec(ok[0].contents);
  assert.ok(link, "the interview link");
  assert.deepEqual(JSON.parse(decodeURIComponent(link[1])), ["interview"]);
  // every command a welcome view links to is declared
  const declared = new Set(c.commands.map((x) => x.command));
  for (const w of c.viewsWelcome) for (const id of ids(/\(command:([\w.]+)/g, w.contents)) assert.ok(declared.has(id), `${w.view}: ${id}`);
});

test("a product's context menu: start or continue, resume, doctor and Open config, with the inline run kept", () => {
  const items = c.menus["view/item/context"];
  const matches = (when, value) => {
    const eq = /viewItem == ([\w.]+)/.exec(when);
    const re = /viewItem =~ \/(.+)\/$/.exec(when);
    return /view == atf\.runs/.test(when) && (eq ? eq[1] === value : re ? new RegExp(re[1]).test(value) : false);
  };
  const forItem = (value) => items.filter((e) => matches(e.when, value));
  const product = forItem("atf.product");
  assert.deepEqual(product.filter((e) => !e.group.startsWith("inline")).map((e) => e.command).filter((x) => ["atf.run", "atf.resume", "atf.doctor", "atf.openConfig"].includes(x)).sort(), ["atf.doctor", "atf.openConfig", "atf.resume", "atf.run"]);
  assert.ok(product.some((e) => e.command === "atf.run" && e.group.startsWith("inline")), "the inline ▷ stays");
  assert.ok(forItem("atf.environment").some((e) => e.command === "atf.openConfig"));
  assert.ok(!forItem("atf.stage").some((e) => e.command === "atf.openConfig"));
  // Sweep leftovers… and Validate config: on a product's (and an environment's) right-click menu, never inline
  for (const value of ["atf.product", "atf.environment"])
    for (const cmd of ["atf.sweep", "atf.validate"]) assert.ok(forItem(value).some((e) => e.command === cmd && !e.group.startsWith("inline")), `${cmd} on ${value}`);
  const palette = Object.fromEntries(c.menus.commandPalette.map((e) => [e.command, e.when]));
  assert.equal(palette["atf.sweep"], "atf.active");
  assert.equal(palette["atf.validate"], "atf.active");
});

test("atf.host: claude (the default), copilot-chat or copilot-cli, as the code reads it", () => {
  const host = c.configuration.properties["atf.host"];
  assert.deepEqual(host.enum, ["claude", "copilot-chat", "copilot-cli", "codex"]);
  assert.equal(host.enumDescriptions.length, host.enum.length);
  assert.equal(host.default, "claude");
  assert.match(host.markdownDescription, /`copilot` is read as `copilot-cli`/);
  assert.match(code["src/activate.js"], /HOSTS = \["claude", "copilot-chat", "copilot-cli", "codex"\]/);
});
