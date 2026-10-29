// packages/vscode/package.json against SPEC.md: every view and command the spec lists, with its title, the menus and
// icons, the listing fields; and, both ways, the code: every command, view and setting the sources use is declared,
// and every one Basil owns is registered.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { COMMANDS } from "../src/activate.js";

const PKG = path.resolve(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(path.join(PKG, "package.json"), "utf8"));
const core = JSON.parse(readFileSync(path.join(PKG, "..", "core", "package.json"), "utf8"));
const c = manifest.contributes;

// SPEC.md "Contributions"
const SPEC_VIEWS = { "atf.runs": "Runs", "atf.clarifications": "Clarifications", "atf.approvals": "Test case approval" };
const SPEC_COMMANDS = {
  "atf.refresh": "Refresh",
  "atf.init": "Create workspace (init)",
  "atf.sync": "Sync host files",
  "atf.check": "Check host files",
  "atf.doctor": "Doctor",
  "atf.run": "Start or continue a run",
  "atf.resume": "Resume a stage",
  "atf.openClarifications": "Open clarifications",
  "atf.openApproval": "Open approval sheet",
  "atf.approveModule": "Approve module…",
  "atf.openReport": "Open report",
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
  assert.match(manifest.license, /^SEE LICENSE IN LICENSE\.md$/);
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
  assert.deepEqual(c.viewsContainers.activitybar.map((v) => [v.id, v.title]), [["atf", "atf"]]);
  assert.ok(existsSync(path.join(PKG, c.viewsContainers.activitybar[0].icon)));
  assert.deepEqual(Object.fromEntries(c.views.atf.map((v) => [v.id, v.name])), SPEC_VIEWS);
  for (const w of c.viewsWelcome) assert.ok(SPEC_VIEWS[w.view], w.view);
});

test("every command of the spec, with its title, category atf and an icon; nothing else", () => {
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

test("Basil's commands and the Runs view are registered by Basil's code", () => {
  assert.deepEqual(COMMANDS, Object.keys(SPEC_COMMANDS).slice(0, 7));
  for (const id of COMMANDS) assert.match(code["src/activate.js"], new RegExp(`"${id.replace(".", "\\.")}":`), id);
  assert.match(code["src/activate.js"], /registerCommand\(id, fn\)/);
  assert.match(code["src/runs.js"], /createTreeView\("atf\.runs"/);
  // extension.js hands the real API to activate.js and imports the other owners' register functions
  assert.match(code["src/extension.js"], /import \{ registerSheets \} from "\.\/sheets\/index\.js"/);
  assert.match(code["src/extension.js"], /import \{ registerReport \} from "\.\/report\.js"/);
  assert.match(code["src/extension.js"], /export function activate\(context\)/);
});
