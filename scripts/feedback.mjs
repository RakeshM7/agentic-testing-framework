#!/usr/bin/env node
// CLI over scripts/lib/feedback.mjs -- the feedback-file contract (docs/conventions.md). Reads files only; never edits.
//
//   feedback.mjs triage <file> [--plan <path> ...]
//        per finding, the files it names (else the file's related_files) plus the planned paths, and the Accepted
//        decisions (docs/decisions.md Affects) governing them. Run before changing anything.
//   feedback.mjs check <file>
//        frontmatter valid; every '## Finding N' has a Resolution entry (fixed | deferred | declined) with a reason,
//        Files changed and Decisions considered; a decision-conflict deferral names the decision; a fixed finding that
//        changed scripts/ lists a *.test.mjs; a fixed finding that changed a governed file names the decision.
//   feedback.mjs paths <file>     the files the feedback concerns
// Exits: 0 ok, 1 problems, 2 usage.
import { fileURLToPath } from "node:url";
import { check, feedbackPaths, triage } from "./lib/feedback.mjs";
import { repoRoot } from "./lib/contract.mjs";

const USAGE = "usage: feedback.mjs triage <file> [--plan <path> ...] | check <file> | paths <file>";

export function main(argv, { root = repoRoot } = {}) {
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
