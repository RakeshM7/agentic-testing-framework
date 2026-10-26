#!/usr/bin/env node
// The atf command (D-087): every former `make` target, on macOS, Windows and Linux. The logic is in
// scripts/lib/cli.mjs; `atf help` lists the commands.
//
// The CLI is loaded with a dynamic import so that `atf sync --postinstall` (the package's npm postinstall) still exits
// 0 when even loading it fails: a postinstall must never fail the client's install (packaging §3.3). Every other
// command fails as it always did.
const argv = process.argv.slice(2);
try {
  const { main } = await import("../scripts/lib/cli.mjs");
  process.exitCode = main(argv);
} catch (e) {
  if (!(argv[0] === "sync" && argv.includes("--postinstall"))) throw e;
  console.error(`atf sync (postinstall): ${e.message}. Your install itself succeeded; run npx atf sync from your workspace.`);
  process.exitCode = 0;
}
