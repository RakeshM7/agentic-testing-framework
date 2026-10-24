// Problems with the framework itself, recorded by the agents that meet them during a run (D-083): a prompt that
// contradicts a script, a script that fails on valid input, a contract or doc that is wrong. Not the product's bugs
// (triage) and not the generated test code's (review and fix). An agent adds one through
// `scripts/framework-issues.mjs add`, which assigns a stable id and dedupes; `run.mjs end` writes them, one file per
// reporting agent, in the feedback format (docs/conventions.md) to feedback/run-<run-id>/, where
// feedback-implementor-agent takes them. Agents never write feedback/ themselves.
// File: results/<run>/framework-issues.json (script-owned).
import { createHash } from "node:crypto";
import path from "node:path";
import { SLUG_RE } from "./contract.mjs";
import { readJson, withFileLock, writeAtomic, writeJson } from "./files.mjs";

export const ISSUE_KINDS = ["prompt", "script", "contract", "doc", "config", "template", "other"];
export const SEVERITIES = ["blocking", "high", "medium", "low"];
export const ISSUES_FILE = "framework-issues.json";

const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").replace(/[\s.;:!]+$/, "").trim();
export const issueId = (e) => `FI-${createHash("sha1").update([e.kind, norm(e.target), norm(e.summary)].join("|")).digest("hex").slice(0, 8)}`;
const text = (v, max) => typeof v === "string" && v.trim() && v.length <= max;

export function issueProblems(e, from) {
  const out = [];
  if (!SLUG_RE.test(from ?? "")) out.push("from must be the reporting agent's name (kebab-case)");
  if (!ISSUE_KINDS.includes(e?.kind)) out.push(`kind must be one of [${ISSUE_KINDS}]`);
  if (!text(e?.target, 300) || /^\//.test(e.target) || e.target.includes("..")) out.push("target is required: the framework file it is about, from the repo root (e.g. agents/module-explorer.md)");
  if (!text(e?.summary, 300)) out.push("summary is required (at most 300 characters)");
  if (!text(e?.evidence, 4000)) out.push("evidence is required: what you observed (error text, command and output, file:line), at most 4000 characters");
  if (e?.fix !== undefined && !text(e.fix, 2000)) out.push("fix must be text of at most 2000 characters");
  if (e?.severity !== undefined && !SEVERITIES.includes(e.severity)) out.push(`severity must be one of [${SEVERITIES}]`);
  return out;
}

export const issuesPath = (resultsDir) => path.join(resultsDir, ISSUES_FILE);
export const readIssues = (file) => readJson(file, { version: 1, issues: [] });

// -> {id, added: true} | {id, duplicate: true} | {errors}
export function addIssue(file, entry, { from, runId, now = () => new Date().toISOString() }) {
  const errors = issueProblems(entry, from);
  if (errors.length) return { errors };
  return withFileLock(file, () => {
    const d = readIssues(file);
    const id = issueId(entry);
    const seen = d.issues.find((x) => x.id === id);
    if (seen) {
      if (!seen.reporters.includes(from)) seen.reporters.push(from);
      writeJson(file, d);
      return { id, duplicate: true };
    }
    d.runId = runId;
    d.issues.push({ id, kind: entry.kind, target: entry.target.trim(), summary: entry.summary.trim(), evidence: entry.evidence.trim(), ...(entry.fix ? { fix: entry.fix.trim() } : {}), severity: entry.severity ?? "medium", from, reporters: [from], at: now() });
    writeJson(file, d);
    return { id, added: true };
  });
}

const one = (s) => String(s).replace(/\s*\r?\n\s*/g, " ").trim();

// The issues as feedback files (docs/conventions.md "Feedback file schema"), one per reporting agent, into
// feedback/run-<run-id>/<date>-<agent>.md. -> [repo-relative paths written]
export function writeFeedback(root, { issues, runId, product, date = new Date().toISOString().slice(0, 10) }) {
  const byAgent = new Map();
  for (const i of issues) byAgent.set(i.from, [...(byAgent.get(i.from) ?? []), i]);
  const written = [];
  for (const [agent, list] of [...byAgent].sort(([a], [b]) => a.localeCompare(b))) {
    const severity = SEVERITIES.find((s) => list.some((i) => i.severity === s));
    const text = [
      "---",
      `source_agent: ${agent}`,
      `date: ${date}`,
      "target: framework",
      "related_files:",
      ...[...new Set(list.map((i) => i.target))].sort().map((f) => `  - ${f}`),
      `severity: ${severity}`,
      "---",
      "",
      `<!-- Written by scripts/run.mjs end from the framework issues agents recorded during run ${runId} of ${product} (D-083). -->`,
      "",
      ...list.flatMap((i, n) => [
        `## Finding ${n + 1}: ${one(i.summary)}`,
        `**Summary:** ${one(i.summary)} (${i.kind}, \`${i.target}\`, ${i.id}${i.reporters.length > 1 ? `; also reported by ${i.reporters.filter((r) => r !== agent).join(", ")}` : ""})`,
        `**Evidence:** ${one(i.evidence)}`,
        `**Suggested fix:** ${i.fix ? one(i.fix) : "none proposed by the agent"}`,
        "",
      ]),
    ].join("\n");
    const file = path.join(root, "feedback", `run-${runId}`, `${date}-${agent}.md`);
    writeAtomic(file, text);
    written.push(path.relative(root, file).replaceAll("\\", "/"));
  }
  return written;
}
