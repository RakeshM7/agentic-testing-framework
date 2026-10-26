#!/usr/bin/env node
// CLI over scripts/lib/framework-issues.mjs (D-083): an agent records a problem with the framework itself -- not the
// product, not the test code -- and goes on with its task; `run.mjs end` turns the run's issues into feedback files.
//   framework-issues.mjs add <product> --from <agent> --kind <prompt|script|contract|doc|config|template|other>
//                            --target <framework file> --summary <one line> --evidence <what you saw>
//                            [--fix <suggested fix>] [--severity blocking|high|medium|low]
//   framework-issues.mjs list <product>
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { loadJson, paths, workspaceRoot } from "./lib/contract.mjs";
import { addIssue, issuesPath, readIssues } from "./lib/framework-issues.mjs";

export function main(argv, { root = workspaceRoot } = {}) {
  const [cmd, product, ...rest] = argv;
  const { values: v } = parseArgs({
    args: rest,
    options: { from: { type: "string" }, kind: { type: "string" }, target: { type: "string" }, summary: { type: "string" }, evidence: { type: "string" }, fix: { type: "string" }, severity: { type: "string" } },
  });
  if (!["add", "list"].includes(cmd) || !product) return { code: 2, out: { errors: ["usage: framework-issues.mjs add <product> --from A --kind K --target F --summary S --evidence E [--fix X] [--severity S] | list <product>"] } };
  const p = paths(product, root);
  if (!existsSync(p.lockFile)) return { code: 1, out: { errors: [`no active run for product '${product}'`] } };
  const run = loadJson(p.runFile);
  const file = issuesPath(p.results(run.runId));
  if (cmd === "list") return { code: 0, out: readIssues(file) };
  const r = addIssue(file, { kind: v.kind, target: v.target, summary: v.summary, evidence: v.evidence, fix: v.fix, severity: v.severity }, { from: v.from, runId: run.runId });
  return { code: r.errors ? 1 : 0, out: r };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, out } = main(process.argv.slice(2));
  console.log(JSON.stringify(out, null, 2));
  process.exit(code);
}
