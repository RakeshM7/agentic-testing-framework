#!/usr/bin/env node
// CLI over scripts/lib/feedback.mjs -- the feedback-file contract (docs/conventions.md). Reads files only; never edits.
//
// The frontmatter `target` sets the mode: a product slug is feedback on a run's outputs (feedback-implementor-agent,
// P-7), `framework` is feedback on the framework (the maintainers' framework-implementor-agent, D-062).
//
//   feedback.mjs triage <file> [--plan <path> ...]
//        per finding, the files it names (else the file's related_files) plus the planned paths, and the Accepted
//        decisions (the workspace's decision log, their Affects) governing them; in outputs mode also each file's
//        output domains (or managed). Run before changing anything.
//   feedback.mjs check <file>
//        frontmatter valid; every '## Finding N' has a Resolution entry (fixed | deferred | declined) with a reason,
//        Files changed and Decisions considered; a decision-conflict deferral names the decision; a fixed finding that
//        changed a governed file names the decision. Outputs mode: a fixed finding names the passing check of each
//        domain it changed (Domain check), every file lies in a named domain's writable set and none is managed, and
//        changed test cases await human re-approval. Framework mode: a fixed finding that changed scripts/ lists a
//        *.test.mjs.
//   feedback.mjs paths <file>     the files the feedback concerns
// Exits: 0 ok, 1 problems, 2 usage.
import "./lib/node-gate.mjs"; // first: on a Node.js older than 20, runs this command again under a newer one
import { fileURLToPath } from "node:url";
import { check, feedbackPaths, triage } from "./lib/feedback.mjs";
import { workspaceRoot } from "./lib/contract.mjs";

const USAGE = "usage: feedback.mjs triage <file> [--plan <path> ...] | check <file> | paths <file>";

export function main(argv, { root = workspaceRoot } = {}) {
  const [cmd, file, ...rest] = argv;
  if (!["triage", "check", "paths"].includes(cmd) || !file) return { code: 2, out: { errors: [USAGE] } };
  if (cmd === "triage") {
    const plan = [];
    if (rest.length && rest[0] !== "--plan") return { code: 2, out: { errors: [USAGE] } };
    for (const a of rest.slice(1)) plan.push(...a.split(","));
    if (rest[0] === "--plan" && !plan.length) return { code: 2, out: { errors: [USAGE] } };
    const out = triage(file, { root, plan: plan.filter(Boolean) });
    return { code: out.problems.length ? 1 : 0, out };
  }
  if (rest.length) return { code: 2, out: { errors: [USAGE] } };
  if (cmd === "paths") return { code: 0, out: feedbackPaths(file, { root }) };
  const r = check(file, { root });
  return { code: r.complete ? 0 : 1, out: r };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const { code, out } = main(process.argv.slice(2));
    console.log(JSON.stringify(out, null, 2));
    process.exit(code);
  } catch (e) {
    console.log(JSON.stringify({ errors: [e.message] }, null, 2));
    process.exit(1);
  }
}
