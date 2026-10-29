// feedback.mjs / lib/feedback.mjs: the feedback contract -- decision-aware triage and the per-finding Resolution check.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "./feedback.mjs";
import { OUTPUT_AGENT, OUTPUT_DOMAINS, outputDomainsOf } from "./lib/feedback.mjs";
import { loadConfig } from "./lib/config.mjs";
import { canWrite, resolvePermissions } from "./lib/permissions.mjs";

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
  // the maintainers' log, where the monorepo's atf.json names it (a workspace's default is atf/decisions.md)
  mkdirSync(path.join(root, "atf"), { recursive: true });
  writeFileSync(path.join(root, "atf/atf.json"), JSON.stringify({ decisions: "docs/decisions.md" }));
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

// ---- outputs mode (P-7): feedback on a run's outputs (target: <product>), resolved by feedback-implementor-agent ----
const FRONT_OUT = `---
source_agent: human
date: 2026-10-27
target: acme
related_files:
  - artifacts/acme/modules/contacts/testcases/cases.json
severity: medium
---
`;
const FINDINGS_OUT = `
## Finding 1: A case misses the empty-name boundary
**Summary:** artifacts/acme/modules/contacts/testcases/cases.json has no empty-name case
**Evidence:** x
**Suggested fix:** y

## Finding 2: The list page object waits on a spinner that no longer exists
**Summary:** playwright-tests/acme/pages/contacts/list.page.ts
**Evidence:** x
**Suggested fix:** y
`;
const outEntry = (n, status, reason, files, check, considered = "none") =>
  `### Finding ${n}\n- **Status:** ${status}\n- **Reason:** ${reason}\n- **Files changed:** ${files}\n- **Decisions considered:** ${considered}\n${check === undefined ? "" : `- **Domain check:** ${check}\n`}\n`;
const outDoc = (...entries) => FRONT_OUT + FINDINGS_OUT + res(...entries);
const CASES = "artifacts/acme/modules/contacts/testcases/cases.json";
const POM = "playwright-tests/acme/pages/contacts/list.page.ts";
const TC_CHECK = "`node {fw}/scripts/testcases.mjs check acme contacts` (exit 0)";
const UI_CHECK = "`node {fw}/scripts/ui-code.mjs check acme contacts` (exit 0)";
const scope = () => resolvePermissions(loadConfig("permissions.yaml", { workspace: mkdtempSync(path.join(tmpdir(), "atf-scope-")) })).resolved;

test("outputs mode: fixes through the domains' files, each with its domain check, pass; changed cases await re-approval", () => {
  const r = run(outDoc(
    outEntry(1, "fixed", "added the empty-name case; TC-contacts-009 awaits human re-approval", CASES, TC_CHECK),
    outEntry(2, "fixed", "waits on the table instead", POM, UI_CHECK),
  ));
  assert.equal(r.code, 0, JSON.stringify(r.out));
  assert.equal(r.out.mode, "outputs");
  assert.deepEqual(r.out.counts, { fixed: 2, deferred: 0, declined: 0 });
  // one finding across two domains names both checks
  const both = run(outDoc(
    outEntry(1, "fixed", "the case and its page object; the changed case awaits human re-approval", `${CASES}, ${POM}`, `${TC_CHECK}, ${UI_CHECK}`),
    outEntry(2, "declined", "the spinner still exists", "none"),
  ));
  assert.equal(both.code, 0, JSON.stringify(both.out));
});

test("outputs mode: a fixed finding without a domain check, or whose check is not its files' domain, fails", () => {
  const p = (...e) => problems(run(outDoc(...e))).join("\n");
  const ok2 = outEntry(2, "declined", "no", "none");
  assert.match(p(outEntry(1, "fixed", "x; awaits human re-approval", CASES), ok2), /Finding 1: 'Domain check' is missing/);
  assert.match(p(outEntry(1, "fixed", "x; awaits human re-approval", CASES, "none"), ok2), /'Domain check' is missing/);
  assert.match(p(outEntry(1, "fixed", "x; awaits human re-approval", CASES, "ran it, it passed"), ok2), /names no `<script>\.mjs check acme/);
  assert.match(p(outEntry(1, "fixed", "x", POM, TC_CHECK), ok2), /list\.page\.ts is in the playwright-ui domain, whose check \(ui-code\.mjs check\) Domain check does not name/);
  assert.match(p(outEntry(1, "fixed", "x", POM, "`node {fw}/scripts/review.mjs check acme contacts`"), ok2), /review\.mjs check is not a domain check/);
  assert.match(p(outEntry(1, "fixed", "x", POM, "`node {fw}/scripts/ui-code.mjs check other contacts`"), ok2), /on 'other', not on this feedback's product 'acme'/);
});

test("outputs mode: framework files, another product's files, managed and generated files and atf/ are refused", () => {
  const p = (files, check = UI_CHECK) => problems(run(outDoc(outEntry(1, "fixed", "x", files, check), outEntry(2, "declined", "no", "none")))).join("\n");
  for (const f of ["scripts/lib/review.mjs", "agents/pw-ui-fixer.md", "docs/conventions.md", "config/permissions.yaml", "schemas/report.schema.json",
    "templates/report/deck.html", "atf/atf.json", "atf/decisions.md", "playwright-tests/other/pages/contacts/list.page.ts",
    "artifacts/acme/knowledge/captures/x.txt", "artifacts/acme/results/r1/contacts/playwright-ui/fix-report.json", "artifacts/acme/modules/contacts/testcases/approval.csv"])
    assert.match(p(f), new RegExp(`${f.replaceAll(".", "\\.")} is in no output domain of product 'acme'`), f);
  for (const f of ["playwright-tests/acme/tests/api/contacts/contacts.spec.ts", "playwright-tests/acme/fixtures/ui/base.ts", "k6-tests/acme/scripts/contacts-load.js",
    "artifacts/acme/modules/contacts/k6/workload.json", "artifacts/acme/results/r1/report/report.json"])
    assert.match(p(f), new RegExp(`${f.replaceAll(".", "\\.")} is a managed file`), f);
  // no test file is asked for: the domain check replaces D-062's test per script change
  assert.doesNotMatch(p("scripts/lib/review.mjs"), /without a new or updated/);
});

test("outputs mode: changed test cases must say they await human re-approval", () => {
  const r = run(outDoc(outEntry(1, "fixed", "added the empty-name case", CASES, TC_CHECK), outEntry(2, "declined", "no", "none")));
  assert.equal(r.code, 1);
  assert.match(problems(r).join("\n"), /Finding 1: it changed test cases, so the Reason must say they await human re-approval/);
  const other = run(outDoc(outEntry(1, "declined", "no", "none"), outEntry(2, "fixed", "no case changed", POM, UI_CHECK)));
  assert.equal(other.code, 0, JSON.stringify(other.out));
});

test("outputs mode keeps the shared rules: governing decisions named, triage per domain, no files on a deferral", () => {
  const LOG = "### D-001 · Page objects wait on tables\n- **Status:** Accepted · 2026-10-01\n- **Affects:** `playwright-tests/acme/pages/**`\n";
  const { root, file } = setup(outDoc(outEntry(1, "declined", "no", "none"), outEntry(2, "fixed", "x", POM, UI_CHECK)));
  writeFileSync(path.join(root, "docs/decisions.md"), `# Design decisions\n\n${LOG}`);
  assert.match(main(["check", file], { root }).out.problems.join("\n"), /list\.page\.ts is governed by D-001/);
  const tri = main(["triage", file], { root });
  assert.equal(tri.out.mode, "outputs");
  assert.deepEqual(tri.out.findings[1].decisions.map((d) => d.id), ["D-001"]);
  assert.deepEqual(tri.out.findings[0].domains, [{ file: CASES, domains: ["testcases"] }]);
  assert.deepEqual(tri.out.findings[1].domains, [{ file: POM, domains: ["playwright-ui"] }]);
  const deferred = run(outDoc(outEntry(1, "deferred", "needs a change to playwright.config.ts, a shared repo file", CASES), outEntry(2, "declined", "no", "none")));
  assert.match(problems(deferred).join("\n"), /a deferred finding changed no file/);
  assert.doesNotMatch(problems(deferred).join("\n"), /Domain check/);
});

test("the target decides the mode: framework keeps D-062's checks, anything else that is no product slug is a problem", () => {
  const fw = run(doc(entry(1, "fixed", "x", "scripts/lib/review.mjs", "D-003"), entry(2, "declined", "no", "none")));
  assert.equal(fw.out.mode, "framework");
  assert.match(problems(fw).join("\n"), /without a new or updated scripts\/\*\*\/\*\.test\.mjs/);
  assert.doesNotMatch(problems(fw).join("\n"), /Domain check|output domain/);
  const bad = run(FRONT_OUT.replace("target: acme", "target: Acme Corp") + FINDINGS_OUT + res(entry(1, "declined", "n", "none"), entry(2, "declined", "n", "none")));
  assert.match(problems(bad).join("\n"), /target must be a product slug .* or 'framework'/);
});

test("every output domain is a real slice of feedback-implementor-agent's row, which writes no framework file (P-7)", () => {
  const s = scope();
  const sample = {
    knowledge: ["artifacts/acme/knowledge/overview.md", "artifacts/acme/knowledge/modules/contacts/notes.md"],
    testcases: [CASES],
    "api-discovery": ["artifacts/acme/modules/contacts/api/overlay.json"],
    "api-plan": ["artifacts/acme/modules/contacts/api/plan-overlay.json"],
    "playwright-ui": [POM, "playwright-tests/acme/tests/ui/contacts/cases.spec.ts", "playwright-tests/acme/helpers/ui/contacts.data.ts"],
    "playwright-api": ["playwright-tests/acme/helpers/api/contacts.payloads.ts", "artifacts/acme/modules/contacts/api-code/client-overlay.json"],
    "k6-workload": ["artifacts/acme/modules/contacts/k6/workload-overlay.json"],
    k6: ["k6-tests/acme/scripts/slots/contacts.js", "k6-tests/acme/lib/ext/auth.js"],
    report: ["artifacts/acme/results/acme-run-1/report/narrative.json"],
  };
  assert.deepEqual(Object.keys(sample).sort(), Object.keys(OUTPUT_DOMAINS).sort());
  for (const [dom, files] of Object.entries(sample)) for (const f of files) assert.deepEqual(outputDomainsOf(s, f, "acme"), { managed: false, domains: [dom] }, f);
  const row = s.agents[OUTPUT_AGENT];
  assert.deepEqual(row.spawns, []);
  assert.equal(row.shell, "restricted");
  for (const f of ["scripts/run.mjs", "scripts/lib/feedback.mjs", "agents/pw-ui-fixer.md", "agents/_shared/fixer.md", "docs/conventions.md", "schemas/report.schema.json",
    "config/permissions.yaml", "templates/k6/lib/x.js", "atf/atf.json", "atf/permissions.yaml", ".claude/agents/x.md", ".github/agents/x.agent.md", ".mcp.json"])
    assert.equal(canWrite(row, f, s.variables, { product: "acme" }), false, f);
  for (const c of [" approve", "endpoints.mjs probe", "knowledge.mjs snapshot", "fix.mjs"])
    assert.ok(!row.shell_allow.some((a) => a.includes(c)), `no ${c}`);
});
