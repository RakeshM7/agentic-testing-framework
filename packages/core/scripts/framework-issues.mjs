#!/usr/bin/env node
// CLI over scripts/lib/framework-issues.mjs (D-083): an agent records a problem with the framework itself -- not the
// product, not the test code -- and goes on with its task. The issues stay in the run's results; a human exports them
// as a redacted bundle for the framework's maintainers (`atf issues export`, docs/packaging.md §3.9), and in the
// framework's own source checkout `run.mjs end` also writes them as feedback files (lib/framework-issues.mjs).
//   framework-issues.mjs add <product> --from <agent> --kind <prompt|script|contract|doc|config|template|other>
//                            --target <framework file> --summary <one line> --evidence <what you saw>
//                            [--fix <suggested fix>] [--severity blocking|high|medium|low]
// With no active run (setup, before the first run) the issue goes to artifacts/<product>/framework-issues.json, and the
// result says `noRun: true`; `atf issues export` includes that file too.
//   framework-issues.mjs list <product>
import "./lib/node-gate.mjs"; // first: on a Node.js older than 20, runs this command again under a newer one
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadJson, paths, workspaceRoot } from "./lib/contract.mjs";
import { addIssue, issuesPath, preRunIssuesPath, readIssues } from "./lib/framework-issues.mjs";

export function main(argv, { root = workspaceRoot } = {}) {
  const [cmd, product, ...rest] = argv;
  const { values: v } = parseArgs({
    args: rest,
    options: { from: { type: "string" }, kind: { type: "string" }, target: { type: "string" }, summary: { type: "string" }, evidence: { type: "string" }, fix: { type: "string" }, severity: { type: "string" } },
  });
  if (!["add", "list"].includes(cmd) || !product) return { code: 2, out: { errors: ["usage: framework-issues.mjs add <product> --from A --kind K --target F --summary S --evidence E [--fix X] [--severity S] | list <product>"] } };
  const p = paths(product, root);
  // No active run (a setup-time problem): the product-level file, which `atf issues export` includes (D-083).
  const runId = existsSync(p.lockFile) ? loadJson(p.runFile).runId : null;
  const file = runId ? issuesPath(p.results(runId)) : preRunIssuesPath(p.productDir);
  if (cmd === "list") return { code: 0, out: readIssues(file) };
  const r = addIssue(file, { kind: v.kind, target: v.target, summary: v.summary, evidence: v.evidence, fix: v.fix, severity: v.severity }, { from: v.from, runId });
  return { code: r.errors ? 1 : 0, out: r.errors || runId ? r : { ...r, noRun: true } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, out } = main(process.argv.slice(2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(code);
}
