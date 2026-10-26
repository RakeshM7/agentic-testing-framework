// feedback.mjs / lib/feedback.mjs: the feedback contract -- decision-aware triage and the per-finding Resolution check.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "./feedback.mjs";

const DECISIONS = `# Design decisions

### D-001 · Guard stays in code
- **Status:** Accepted · 2026-01-01
- **Affects:** \`scripts/lib/guard.mjs\`, \`scripts/hooks/**\`

### D-002 · Old idea
- **Status:** Superseded by D-001 (2026-01-02)
- **Affects:** \`scripts/lib/old.mjs\`

### D-003 · Reviews are per test
- **Status:** Accepted · 2026-01-03
- **Affects:** \`scripts/lib/review.mjs\`
`;
const FRONT = `---
source_agent: human
date: 2026-10-19
target: framework
related_files:
  - scripts/lib/review.mjs
severity: medium
---
`;
const FINDINGS = `
## Finding 1: Review ignores a case
**Summary:** see scripts/lib/review.mjs
**Evidence:** x
**Suggested fix:** y

## Finding 2: Prompt typo
**Summary:** agents/pw-ui-fixer.md says foo
**Evidence:** x
**Suggested fix:** y
`;
const entry = (n, status, reason, files, considered = "none") =>
  `### Finding ${n}\n- **Status:** ${status}\n- **Reason:** ${reason}\n- **Files changed:** ${files}\n- **Decisions considered:** ${considered}\n\n`;
const res = (...entries) => `\n## Resolution (2026-10-19)\n\n${entries.join("")}`;

function setup(content) {
  const root = mkdtempSync(path.join(tmpdir(), "atf-feedback-"));
  mkdirSync(path.join(root, "docs"), { recursive: true });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "docs/decisions.md"), DECISIONS);
  writeFileSync(path.join(root, "scripts/review.test.mjs"), "// test\n");
  const file = path.join(root, "feedback/human/2026-10-19-x.md");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return { root, file };
}
const run = (content, cmd = "check", extra = []) => {
  const { root, file } = setup(content);
  return main([cmd, file, ...extra], { root });
};
const doc = (...entries) => FRONT + FINDINGS + res(...entries);
const problems = (r) => r.out.problems ?? [];

test("a complete, valid resolution passes", () => {
  const r = run(doc(
    entry(1, "fixed", "added the case", "scripts/lib/review.mjs, scripts/review.test.mjs", "D-003"),
    entry(2, "declined", "the prompt is right as written", "none"),
  ));
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.deepEqual(r.out.counts, { fixed: 1, deferred: 0, declined: 1 });
});

test("an indented files list and a fixed docs-only change are accepted", () => {
  const r = run(doc(
    `### Finding 1\n- **Status:** fixed\n- **Reason:** done\n- **Files changed:**\n  - docs/conventions.md\n  - agents/pw-ui-fixer.md\n- **Decisions considered:** none\n\n`,
    entry(2, "declined", "no", "none"),
  ));
  assert.equal(r.code, 0, JSON.stringify(r.out));
});

test("a missing Resolution section fails", () => {
  const r = run(FRONT + FINDINGS);
  assert.equal(r.code, 1);
  assert.match(problems(r).join("\n"), /no '## Resolution/);
});

test("a finding without a Resolution entry fails, naming it", () => {
  const r = run(doc(entry(1, "declined", "no", "none")));
  assert.equal(r.code, 1);
  assert.match(problems(r).join("\n"), /Finding 2: no Resolution entry/);
});

test("a bad status fails", () => {
  const r = run(doc(entry(1, "Fixed (unverified)", "x", "none"), entry(2, "declined", "no", "none")));
  assert.equal(r.code, 1);
  assert.match(problems(r).join("\n"), /Finding 1: Status must be one of fixed \| deferred \| declined/);
});

test("a missing reason or files list fails", () => {
  const r = run(doc(`### Finding 1\n- **Status:** declined\n\n`, entry(2, "declined", "no", "none")));
  const p = problems(r).join("\n");
  assert.equal(r.code, 1);
  assert.match(p, /Reason is missing/);
  assert.match(p, /'Files changed' is missing/);
  assert.match(p, /'Decisions considered' is missing/);
});

test("a script change without a test file fails; with an existing test it passes", () => {
  const bad = run(doc(entry(1, "fixed", "x", "scripts/lib/review.mjs", "D-003"), entry(2, "declined", "no", "none")));
  assert.equal(bad.code, 1);
  assert.match(problems(bad).join("\n"), /without a new or updated scripts\/\*\*\/\*\.test\.mjs/);
  const missing = run(doc(entry(1, "fixed", "x", "scripts/lib/review.mjs, scripts/ghost.test.mjs", "D-003"), entry(2, "declined", "no", "none")));
  assert.match(problems(missing).join("\n"), /scripts\/ghost\.test\.mjs does not exist/);
});

test("a fixed finding on a governed file must name the decision (a superseded decision does not count)", () => {
  const bad = run(doc(entry(1, "fixed", "x", "scripts/lib/review.mjs, scripts/review.test.mjs", "none"), entry(2, "declined", "no", "none")));
  assert.equal(bad.code, 1);
  assert.match(problems(bad).join("\n"), /governed by D-003 "Reviews are per test"/);
  const old = run(doc(entry(1, "fixed", "x", "scripts/lib/old.mjs, scripts/review.test.mjs", "none"), entry(2, "declined", "no", "none")));
  assert.doesNotMatch(problems(old).join("\n"), /governed by/);
});

test("a decision-conflict deferral names the decision in the fixed phrase", () => {
  const ok = run(doc(
    entry(1, "deferred", "Deferred - needs user confirmation (D-001): would loosen the guard", "none", "D-001"),
    entry(2, "declined", "no", "none"),
  ));
  assert.equal(ok.code, 0, JSON.stringify(ok.out));
  const dash = run(doc(entry(1, "deferred", "Deferred — needs user confirmation (D-001): x", "none", "D-001"), entry(2, "declined", "no", "none")));
  assert.equal(dash.code, 0, JSON.stringify(dash.out));
  const unnamed = run(doc(entry(1, "deferred", "needs confirmation from the user", "none", "D-001"), entry(2, "declined", "no", "none")));
  assert.match(problems(unnamed).join("\n"), /needs user confirmation \(D-NNN\)/);
  const unknown = run(doc(entry(1, "deferred", "Deferred - needs user confirmation (D-099): x", "none", "D-099"), entry(2, "declined", "no", "none")));
  assert.match(problems(unknown).join("\n"), /D-099 is not a recorded decision/);
  const notConsidered = run(doc(entry(1, "deferred", "Deferred - needs user confirmation (D-001): x", "none", "none"), entry(2, "declined", "no", "none")));
  assert.match(problems(notConsidered).join("\n"), /Decisions considered must name D-001/);
});

test("a deferred or declined finding must not list changed files", () => {
  const r = run(doc(entry(1, "declined", "no", "scripts/lib/review.mjs", "D-003"), entry(2, "declined", "no", "none")));
  assert.match(problems(r).join("\n"), /changed no file/);
});

test("a fixed finding must list its files", () => {
  const r = run(doc(entry(1, "fixed", "x", "none"), entry(2, "declined", "no", "none")));
  assert.match(problems(r).join("\n"), /must list the files it changed/);
});

test("frontmatter problems are reported", () => {
  const front = `---\nsource_agent: human\ndate: 19-10-2026\nseverity: urgent\n---\n`;
  const r = run(front + FINDINGS + res(entry(1, "declined", "n", "none"), entry(2, "declined", "n", "none")));
  const p = problems(r).join("\n");
  assert.match(p, /target is missing/);
  assert.match(p, /related_files is missing/);
  assert.match(p, /date must be YYYY-MM-DD/);
  assert.match(p, /severity must be one of/);
  assert.equal(run("no frontmatter\n## Finding 1: x\n").code, 1);
});

test("a Resolution entry for an unknown finding or a duplicate fails", () => {
  const r = run(doc(entry(1, "declined", "n", "none"), entry(2, "declined", "n", "none"), entry(3, "declined", "n", "none"), entry(1, "declined", "n", "none")));
  const p = problems(r).join("\n");
  assert.match(p, /Finding 3 has no matching/);
  assert.match(p, /Finding 1 appears twice/);
});

test("triage lists the Accepted decisions governing each finding's files and the planned paths", () => {
  const r = run(FRONT + FINDINGS, "triage", ["--plan", "scripts/lib/guard.mjs,scripts/hooks/pretooluse.mjs", "scripts/lib/old.mjs"]);
  assert.equal(r.code, 0);
  const [f1, f2] = r.out.findings;
  assert.deepEqual(f1.files, ["scripts/lib/review.mjs", "scripts/lib/guard.mjs", "scripts/hooks/pretooluse.mjs", "scripts/lib/old.mjs"]);
  assert.deepEqual(f1.decisions.map((d) => d.id), ["D-003", "D-001"]);
  assert.deepEqual(f1.decisions.find((d) => d.id === "D-001").files, ["scripts/lib/guard.mjs", "scripts/hooks/pretooluse.mjs"]);
  assert.deepEqual(f2.files.slice(0, 1), ["agents/pw-ui-fixer.md"]);
  assert.deepEqual(r.out.decisions.map((d) => d.id).sort(), ["D-001", "D-003"]);
});

test("triage falls back to related_files when a finding names no path", () => {
  const r = run(FRONT + "\n## Finding 1: vague\n**Summary:** it is slow\n", "triage");
  assert.deepEqual(r.out.findings[0].files, ["scripts/lib/review.mjs"]);
  assert.deepEqual(r.out.findings[0].decisions.map((d) => d.id), ["D-003"]);
});

test("paths lists the files the feedback concerns; usage errors exit 2", () => {
  const r = run(FRONT + FINDINGS, "paths");
  assert.deepEqual(r.out.related, ["scripts/lib/review.mjs"]);
  assert.deepEqual(r.out.findings.map((f) => f.files), [["scripts/lib/review.mjs"], ["agents/pw-ui-fixer.md"]]);
  assert.equal(main([]).code, 2);
  assert.equal(main(["check"]).code, 2);
  assert.equal(main(["triage", "f.md", "--plan"]).code, 2);
  assert.equal(main(["check", "f.md", "x"]).code, 2);
});

test("check normalises Files changed: .. segments and case still name the governing decision; outside paths are problems", () => {
  const one = (files, considered = "none") => run(doc(entry(1, "fixed", "x", `${files}, scripts/review.test.mjs`, considered), entry(2, "declined", "no", "none")));
  assert.match(problems(one("scripts/x/../lib/guard.mjs")).join("\n"), /scripts\/lib\/guard\.mjs is governed by D-001/);
  assert.match(problems(one("Scripts/Lib/Guard.mjs")).join("\n"), /governed by D-001/);
  assert.match(problems(one(String.raw`scripts\lib\guard.mjs`)).join("\n"), /governed by D-001/);
  assert.doesNotMatch(problems(one("./scripts/x/../lib/guard.mjs", "D-001")).join("\n"), /governed by/);
  assert.match(problems(one("../outside/x.md")).join("\n"), /resolves outside the repository/);
  assert.match(problems(one("scripts/../../x.test.mjs")).join("\n"), /resolves outside the repository/);
  assert.match(problems(one("/etc/passwd.md")).join("\n"), /absolute path/);
  assert.match(problems(one(String.raw`C:\Windows\x.md`)).join("\n"), /absolute path/);
});

test("triage normalises finding files and --plan, and reports paths outside the repo", () => {
  const r = run(FRONT + FINDINGS, "triage", ["--plan", "scripts/x/../lib/guard.mjs,Scripts/Hooks/Pretooluse.mjs,../escape.md"]);
  assert.equal(r.code, 1);
  assert.match(r.out.problems.join("\n"), /\.\.\/escape\.md resolves outside/);
  assert.deepEqual(r.out.findings[0].decisions.find((d) => d.id === "D-001").files, ["scripts/lib/guard.mjs", "Scripts/Hooks/Pretooluse.mjs"]);
});

test("an unknown decision id in a deferral is reported once", () => {
  const r = run(doc(entry(1, "deferred", "Deferred - needs user confirmation (D-099): x", "none", "D-099"), entry(2, "declined", "no", "none")));
  assert.equal(problems(r).filter((p) => /D-099 is not a recorded decision/.test(p)).length, 1);
});
