// Real sheets for the sheets tests, made by the framework's own scripts in a temp workspace (never hand-written):
// clarifications.csv through scripts/lib/clarifications.mjs (append, then an agent's proposed answer through record),
// and the approval sheet through scripts/testcases.mjs build (test-helpers buildCases). Dev-only: the tests import the
// framework; the extension never does.
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildCases, startRun } from "../../core/scripts/test-helpers.mjs";
import { append, csvPath, record } from "../../core/scripts/lib/clarifications.mjs";
import { paths } from "../../core/scripts/lib/contract.mjs";

export const QUESTIONS = [
  { question: 'Is "Name" required when creating a contact?', steps: '1. Sign in.\n2. Open "Contacts", then "New contact".\n3. Leave "Name *" empty, click "Save".' },
  { question: "What format does Email accept, e.g. a+b@c.d; or x@y?", steps: "1. Sign in.\n2. Type an address in Email, then save." },
  { question: "Can a contact be deleted from the list view?", steps: "1. Sign in.\n2. Open Contacts.\n3. Look for a delete action on a row." },
];
export const PROPOSED = "Basis: observed\nContext: the New contact form\nAction: Save with Name empty\nResult: \"Name is required\" appears\nScope: create form only";

// -> { root, product, module, files: { clarifications, approval, coverage, approvals }, texts: { clarifications, approval }, ids }
export async function realSheets() {
  const { root, run } = startRun();
  const product = "acme";
  const module = "contacts";
  const productDir = paths(product, root).productDir;
  // the cases first: an answered clarification would be a coverage item these minimal cases don't cover
  const ids = await buildCases(root, { cases: [{ key: "list" }, { key: "create", mutates: true }, { key: "edit", priority: "p1" }] });
  const clar = csvPath(productDir, module);
  append(clar, module, run.runId, QUESTIONS);
  record(clar, `${module}-1`, { answer: PROPOSED, runId: run.runId }); // an agent's answer: agent-proposed
  const tc = path.join(productDir, "modules", module, "testcases");
  const files = { clarifications: clar, approval: path.join(tc, "approval.csv"), coverage: path.join(tc, "coverage.json"), approvals: path.join(tc, "approvals.json") };
  return { root, product, module, files, ids, texts: { clarifications: readFileSync(files.clarifications, "utf8"), approval: readFileSync(files.approval, "utf8") } };
}

// The framework's own approve, as a human runs it at a terminal (the slug typed), in process.
export async function coreApprove(root, product, module) {
  const { main } = await import("../../core/scripts/testcases.mjs");
  return main(["approve", product, module], { root, interactive: { isTTY: true, ask: async () => module } });
}
