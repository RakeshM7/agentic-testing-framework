#!/usr/bin/env node
// The atf command (D-087): every former `make` target, on macOS, Windows and Linux. The logic is in
// scripts/lib/cli.mjs; `atf help` lists the commands.
//
// The CLI is loaded with a dynamic import so that `atf sync --postinstall` (the package's npm postinstall) still exits
// 0 when even loading it fails: a postinstall must never fail the client's install (packaging §3.3). Every other
// command fails as it always did.
//
// Started on a Node.js older than 20 (`npx atf …` with Homebrew's node@18 first in PATH, D-109), it runs itself again
// under the Node.js 20 or later that atf sync pinned for the workspace (atf/machine.json), else the one findNode prefers
// (the workspace's .nvmrc major, then the newest LTS line, then the newest; scripts/lib/node-version.mjs reexecPlan),
// with that Node's folder first in the PATH, so what it starts (npm, npx, the agent session) runs on it too, and says so
// in one line. With none installed: one error line with the command that installs one (the postinstall says it and
// carries on, never failing the install). So this file loads only node-version.mjs, roots.mjs and Node built-ins before
// that, and keeps to syntax such a Node reads.
const argv = process.argv.slice(2);
const postinstall = argv[0] === "sync" && argv.includes("--postinstall");

let plan = null;
let rerun = null;
try {
  const nodeVersion = await import("../scripts/lib/node-version.mjs");
  const { workspaceRoot } = await import("../scripts/lib/roots.mjs");
  rerun = nodeVersion.rerun;
  plan = nodeVersion.reexecPlan({ local: nodeVersion.readLocalNode(workspaceRoot) });
} catch (e) {
  if (!postinstall) throw e;
}

if (plan && plan.run) {
  // the child's exit code (1 when a signal ended it); 0 for the postinstall, whatever happens
  console.error(plan.line);
  const { code } = await rerun(plan.run);
  process.exitCode = postinstall ? 0 : code === null ? 1 : code;
} else if (plan && plan.error && !postinstall) {
  console.error(plan.error);
  process.exitCode = 1;
} else {
  if (plan && plan.error) console.error(plan.error);
  try {
    const { main } = await import("../scripts/lib/cli.mjs");
    process.exitCode = main(argv);
  } catch (e) {
    if (!postinstall) throw e;
    console.error(`atf sync (postinstall): ${e.message}. Your install itself succeeded; run npx atf sync from your workspace.`);
    process.exitCode = 0;
  }
}
