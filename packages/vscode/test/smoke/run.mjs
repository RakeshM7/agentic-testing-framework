#!/usr/bin/env node
// The optional smoke test (P-12): a real VS Code, through @vscode/test-electron, opens an installed client workspace
// (packages/core/scripts/test-helpers.mjs installedWorkspace: atf/atf.json and the framework in
// node_modules/@testagentic/atf), and suite.cjs checks inside it that the extension activates, registers its views
// and commands, and that atf.refresh runs.
//
// It is opt-in and never part of `npm test` (its name is not *.test.mjs): it launches VS Code, and by default
// downloads one (the network, ~100 MB, cached under the OS temp folder).
//   ATF_VSCODE_SMOKE=1 npm run test:smoke --workspace atf-vscode        download a stable VS Code and run
//   ATF_VSCODE_SMOKE=1 ATF_VSCODE_EXECUTABLE=<path> npm run test:smoke …  use an installed VS Code (its executable,
//                                                                        e.g. …/Visual Studio Code.app/Contents/MacOS/Electron
//                                                                        on macOS, Code.exe on Windows), no download
//   ATF_VSCODE_VERSION=<version|stable|insiders>                         which VS Code to download (default stable)
// Without ATF_VSCODE_SMOKE=1 it prints why it is skipped and exits 0. CI does not set it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExtension, PKG } from "../../scripts/build.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export async function main(env = process.env) {
  if (env.ATF_VSCODE_SMOKE !== "1") {
    console.log("smoke: skipped. It launches VS Code (and downloads one unless ATF_VSCODE_EXECUTABLE names an installed one): set ATF_VSCODE_SMOKE=1 to run it.");
    return 0;
  }
  const built = await buildExtension();
  if (built.errors.length) {
    for (const e of built.errors) console.error(`smoke: build: ${e}`);
    return 1;
  }
  // loaded only now: the smoke test's own dependencies are dev-only, and a skipped run needs none of them
  const { installedWorkspace } = await import("../../../core/scripts/test-helpers.mjs");
  const { runTests } = await import("@vscode/test-electron");
  const { root } = installedWorkspace();
  const profile = mkdtempSync(path.join(tmpdir(), "atf-vscode-profile-"));
  try {
    await runTests({
      extensionDevelopmentPath: PKG,
      extensionTestsPath: path.join(HERE, "suite.cjs"),
      extensionTestsEnv: { ATF_SMOKE_WORKSPACE: root },
      ...(env.ATF_VSCODE_EXECUTABLE ? { vscodeExecutablePath: env.ATF_VSCODE_EXECUTABLE } : { version: env.ATF_VSCODE_VERSION || "stable", cachePath: path.join(tmpdir(), "atf-vscode-test") }),
      // a fresh profile with no other extensions; trust off, since the manifest requires a trusted workspace
      launchArgs: [root, "--disable-extensions", "--disable-workspace-trust", "--skip-welcome", "--skip-release-notes", `--user-data-dir=${profile}`],
    });
    console.log("smoke: passed");
    return 0;
  } catch (e) {
    console.error(`smoke: failed: ${e?.message ?? e}`);
    return 1;
  } finally {
    rmSync(profile, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main();
