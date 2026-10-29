// Runs inside VS Code's extension host, started by run.mjs (@vscode/test-electron calls run()). CommonJS, since the
// host require()s it; `vscode` is the real API here.
const assert = require("node:assert/strict");
const path = require("node:path");
const vscode = require("vscode");
const manifest = require("../../package.json");

exports.run = async function run() {
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  assert.ok(folder, "VS Code opened the workspace");
  assert.equal(path.resolve(folder), path.resolve(process.env.ATF_SMOKE_WORKSPACE), "the installed client workspace is the open folder");

  const ext = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
  assert.ok(ext, "the extension is loaded from the development path");
  await ext.activate();
  assert.equal(ext.isActive, true, "activates on workspaceContains:atf/atf.json");
  assert.equal(typeof ext.exports, "object");

  const commands = new Set(await vscode.commands.getCommands(true));
  const missing = manifest.contributes.commands.map((c) => c.command).filter((c) => !commands.has(c));
  assert.deepEqual(missing, [], "every contributed command has a handler");

  // VS Code generates <view id>.focus for every view it registered from the manifest, and the container's opener
  for (const view of manifest.contributes.views.atf) assert.ok(commands.has(`${view.id}.focus`), `the view ${view.id} is registered`);
  await vscode.commands.executeCommand("workbench.view.extension.atf");
  for (const view of manifest.contributes.views.atf) await vscode.commands.executeCommand(`${view.id}.focus`);

  await vscode.commands.executeCommand("atf.refresh");
};
