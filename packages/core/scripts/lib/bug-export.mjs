// The run's product bugs as issue-ready files (D-080): for every product-bug cluster of a verified triage, the
// triager's bug draft becomes results/<run>/bugs/<BUG id>.md (title, severity, environment, steps, expected with its
// source, actual, evidence, affected tests) and one bugs.json lists them all. A cluster without a draft is listed in
// bugs.json with `draft: false` and gets no file: nobody wrote its steps. Nothing is filed anywhere: a human copies a
// file into their tracker.
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { paths } from "./contract.mjs";
import { tryReadJson, writeAtomic, writeJson } from "./files.mjs";
import { triagePaths } from "./triage.mjs";

const DOMAINS = { "playwright-ui": "ui", "playwright-api": "api", k6: "k6" };
const SEVERITY = ["critical", "major", "minor", "trivial"];
const line = (s) => String(s ?? "").replace(/\s*\r?\n\s*/g, " ").trim();

function markdown(b, run) {
  return [
    `# ${b.id}: ${line(b.title)}`,
    "",
    `- **Severity:** ${b.severity}`,
    `- **Product:** ${run.product} (${run.target.url})`,
    `- **Module:** ${b.module} · **Found by:** ${b.framework} · **Run:** ${run.runId} (${run.mode})`,
    "",
    "## Steps to reproduce",
    "",
    ...b.steps.map((s, i) => `${i + 1}. ${line(s)}`),
    "",
    "## Expected",
    "",
    `${line(b.expected.text)} (source: \`${line(b.expected.source)}\`)`,
    "",
    "## Actual",
    "",
    "```",
    String(b.actual.quote).trim(),
    "```",
    "",
    "## Evidence",
    "",
    ...b.evidence.map((e) => `- \`${e}\``),
    "",
    "## Affected tests",
    "",
    ...b.affected.map((t) => `- ${t}`),
    "",
  ].join("\n");
}

// -> {dir, bugs: [{id, module, framework, title, severity, draft, file}]}; the bugs folder holds exactly this run's drafts
export function exportBugs(product, { root }) {
  const p = paths(product, root);
  const run = tryReadJson(p.runFile);
  if (!run) throw new Error(`no run state for '${product}'`);
  const dir = path.join(p.results(run.runId), "bugs");
  const bugs = [];
  for (const module of run.modules)
    for (const [framework, domain] of Object.entries(DOMAINS)) {
      const tp = triagePaths(p.productDir, module, run.runId, domain);
      const t = tryReadJson(tp.triage);
      if (!t) continue;
      const drafts = tryReadJson(tp.overlay, {})?.bugs ?? [];
      for (const c of t.clusters ?? []) {
        if (!(t.rows ?? []).some((r) => r.cluster === c.id && r.class === "product-bug")) continue;
        const d = drafts.find((x) => x.cluster === c.id);
        bugs.push(d ? { id: c.id, module, framework, ...d, draft: true } : { id: c.id, module, framework, title: null, severity: null, affected: c.ids, draft: false });
      }
    }
  bugs.sort((a, b) => (SEVERITY.indexOf(a.severity) + 1 || 9) - (SEVERITY.indexOf(b.severity) + 1 || 9) || a.id.localeCompare(b.id));
  // a re-export after a re-triage leaves no draft of a cluster that is gone
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/^BUG-.+\.md$/.test(f)) rmSync(path.join(dir, f));
  const listed = bugs.map((b) => {
    const file = b.draft ? path.join(dir, `${b.id}.md`) : null;
    if (file) writeAtomic(file, markdown(b, run));
    const { cluster, ...rest } = b;
    return { ...rest, file: file ? path.relative(root, file).replaceAll("\\", "/") : null };
  });
  writeJson(path.join(dir, "bugs.json"), { product, runId: run.runId, bugs: listed });
  return { dir: path.relative(root, dir).replaceAll("\\", "/"), bugs: listed.map(({ id, module, framework, title, severity, draft, file }) => ({ id, module, framework, title, severity, draft, file })) };
}
